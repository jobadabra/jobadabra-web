// The agent coding page (admin/agent-coding.js, admin/agent-coding-page.js): the two uploads (key, shape, clamps, one row per kind and day), the owner's page with its weeks, circles and honest empty states.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {PAGES} from '../../../admin/admin.js';
import {OPERATIONS} from '../../../admin/headlines-ops.js';
import {cleanCi, cleanGate} from '../../../admin/agent-coding.js';
import {page, weeksOf} from '../../../admin/agent-coding-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, '/agent-coding/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const today = new Date().toISOString().slice(0, 10);
const gateDay = (day, extra = {}) => ({day, pushes: 10, secs: 700, stopped: {form: 4, real: 1, other: 0}, stoppedSecs: {form: 220, real: 190, other: 0}, steps: {'file size': {runs: 10, fails: 3, secs: 90, cls: 'form'}, 'desktop (clean checkout)': {runs: 10, fails: 1, secs: 400, cls: 'real'}}, ...extra});
const ciDay = (day, extra = {}) => ({day, prs: {merged: 6, ci: 4}, reds: {product: 3, test: 2, ci: 1, form: 2, nofix: 1}, fixPrs: {'desktop/renderer': 3, extension: 1}, wall: [10, 12, 30], queue: [1, 2, 0.5], cancelledMin: 4, ...extra});

test('the ingest needs the key, a known kind and well-formed days', async () => {
  const e = env();
  assert.equal((await put(e, {kind: 'gate', days: [gateDay(today)]}, 'wrong')).status, 404);
  assert.equal((await put(e, {kind: 'other', days: [gateDay(today)]})).status, 400);
  assert.equal((await put(e, {kind: 'gate', days: []})).status, 400);
  assert.equal((await put(e, {kind: 'gate', days: [gateDay('not-a-day')]})).status, 400);
  assert.equal((await put(e, {kind: 'gate', days: [gateDay(today)]})).status, 200);
  assert.equal((await put(e, {kind: 'ci', days: [ciDay(today)]})).status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM agent_coding_days').get().n, 2);
});

test('a repeat upload of a day replaces it, one row per kind and day', async () => {
  const e = env();
  await put(e, {kind: 'gate', days: [gateDay(today)]});
  await put(e, {kind: 'gate', days: [gateDay(today, {pushes: 99})]});
  await put(e, {kind: 'ci', days: [ciDay(today)]});
  const rows = e.STATS.db.prepare('SELECT kind, card FROM agent_coding_days ORDER BY kind').all();
  assert.deepEqual(rows.map(row => row.kind), ['ci', 'gate']);
  assert.equal(JSON.parse(rows[1].card).pushes, 99);
});

test('every number is clamped and every label cut to a safe set: nothing but counts, seconds and short labels is kept', () => {
  const gate = cleanGate({pushes: '12', secs: -5, stopped: {form: 'x', real: 2.6}, steps: {'<script>file size</script> /Users/me/secret-branch': {runs: 1, fails: 1, secs: 2, cls: 'bogus'}, ['x'.repeat(200)]: {runs: 1}}, branch: 'secret'});
  assert.equal(gate.pushes, 12);
  assert.equal(gate.secs, 0);
  assert.deepEqual(gate.stopped, {form: 0, real: 3, other: 0});
  assert.ok(Object.keys(gate.steps).every(name => name.length <= 60 && !/[<>]/.test(name)));
  assert.equal(Object.values(gate.steps)[0].cls, 'other');
  assert.ok(!JSON.stringify(gate).includes('secret-branch-x'));
  assert.ok(!('branch' in gate));
  const ci = cleanCi({prs: {merged: 5, ci: 9e9}, fixPrs: {'src/ai': 2, '': 4, 'src/x': 0}, wall: new Array(900).fill(3)});
  assert.equal(ci.wall.length, 500);
  assert.deepEqual(ci.fixPrs, {'src/ai': 2});
});

test('weeks start on Monday (UTC), newest first, eight of them, and a day lands in its own week', () => {
  const weeks = weeksOf([{kind: 'gate', day: '2026-11-01', card: JSON.stringify(gateDay('2026-11-01'))}, {kind: 'gate', day: '2026-11-02', card: JSON.stringify(gateDay('2026-11-02'))}], new Date('2026-11-04T12:00:00Z'));
  assert.equal(weeks.length, 8);
  assert.equal(weeks[0].start, '2026-11-02');
  assert.equal(weeks[0].gate.length, 1);
  assert.equal(weeks[1].start, '2026-10-26');
  assert.equal(weeks[1].gate.length, 1);
});

test('the page is the owner\'s: 404 without the key, honest empty states, then the five cards with a circle flagged at 3 fix PRs in a week', async () => {
  const e = env();
  assert.equal((await call(e, '/admin/agents/agent-coding')).status, 404);
  const empty = await (await call(e, '/admin/agents/agent-coding', owner)).text();
  assert.match(empty, /No push-gate upload yet/);
  assert.match(empty, /No CI upload yet/);
  assert.ok(!/0% /.test(empty), 'no invented zeros');
  await put(e, {kind: 'gate', days: [gateDay(today)]});
  await put(e, {kind: 'ci', days: [ciDay(today)]});
  const html = await (await call(e, '/admin/agents/agent-coding', owner)).text();
  for (const id of ['gate', 'fixed', 'share', 'circles', 'minutes']) assert.match(html, new RegExp(`<section class="card" id="${id}"`));
  assert.match(html, /80% of stopped pushes were form/);
  assert.match(html, /<td>file size<\/td>.*<td>desktop \(clean checkout\)<\/td>/s, 'every push check is listed, the one that stopped most first');
  assert.match(html, /🌀 3/);
  assert.match(html, /1 area with 3\+ fixes/);
  assert.match(html, /href="\/admin\/testing\/pr-checks"/);
});

test('a name from an upload is escaped on the page', () => {
  const now = new Date();
  const html = page([{kind: 'ci', day: today, card: JSON.stringify(ciDay(today, {fixPrs: {'<img src=x onerror=1>': 3}})), updated_at: now.toISOString()}], now);
  assert.ok(!html.includes('<img src=x'));
});

test('the menu lists Agent coding under Agents and the overview headline counts the circling areas', async () => {
  assert.equal(PAGES.find(item => item.path === '/admin/agents/agent-coding').group, 'Agent Coding');
  const e = env();
  const [empty] = await OPERATIONS['/admin/agents/agent-coding'](e, new Date());
  assert.equal(empty.value, 'No data');
  await put(e, {kind: 'ci', days: [ciDay(today)]});
  const [circling] = await OPERATIONS['/admin/agents/agent-coding'](e, new Date());
  assert.equal(circling.value, '1');
  assert.equal(circling.status, 'bad');
});

test('CI minutes per push: the weeks are columns (median, slowest 1 in 10) with the table behind "Show table"; the tooltip script is on the page once', () => {
  const now = new Date();
  const html = page([{kind: 'ci', day: today, card: JSON.stringify(ciDay(today)), updated_at: now.toISOString()}], now);
  assert.match(html, /id="minutes"[\s\S]*class="vz"[\s\S]*Median[\s\S]*Slowest 1 in 10[\s\S]*<summary>Show table<\/summary>[\s\S]*<th class="num">Pushes<\/th>/);
  assert.match(html, /data-tip="week of [A-Z][a-z]{2} \d+ · 3 pushes · median 12 min/);
  assert.equal((html.match(/id="tip"/g) || []).length, 1);
});
