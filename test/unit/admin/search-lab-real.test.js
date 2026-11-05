// The Lab's "Real installs" tab (admin/search-lab-real.js), on seeded rows of the exact shape /report/telemetry stores for a 'search' report: medians per role
// family, the lab's median beside them, a city only when 3+ installs share it, the empty state, and the tab in the page.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {judge} from '../../../admin/search-lab-judge.js';
import {page} from '../../../admin/search-lab-page.js';
import {byDay, canSend, realRows, realSection, summarize} from '../../../admin/search-lab-real.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const report = (install, more = {}) => ({kind: 'search', install, version: '0.9.0', platform: 'darwin', at: '2026-10-19T10:00:00Z', family: 'hospitality', country: 'CH', city: 'zurich',
  in_places: 40, scored: 12, fit70: 3, first_s: 9, tenth_s: 41, first_fit70_s: 77, nth: 1, runs_to_fit70: 1, engine: 'api', trigger: 'first', ...more});
const send = (env, events) => worker.fetch(new Request('https://www.jobpilotto.top/report/telemetry', {method: 'POST', body: JSON.stringify({events})}), env, {});
const lab = (candidate, more = {}) => ({candidate, label: candidate, run_at: '2026-10-18T10:00:00Z', build: 'abc1234', state: 'ok', first_s: 40, tenth_s: 184, fit_s: 557, in_places: 77, scored: 44, fit70: 2, ...more});

test('reports sent as the app sends them come back as medians per family, next to the lab\'s', async () => {
  const env = {STATS: d1(), ASSETS: {fetch: () => new Response('asset')}};
  assert.equal((await send(env, [report('install-aaaa'), report('install-bbbb', {first_s: 21, first_fit70_s: null, fit70: 0}), report('install-cccc', {family: 'software', city: 'berlin', country: 'DE'})])).status, 200);
  const rows = await realRows(env.STATS, new Date('2026-10-20T00:00:00Z'));
  assert.equal(rows.length, 3);
  const s = summarize(rows);
  assert.deepEqual(s.families.map(f => [f.family, f.installs, f.searches, f.first_s, f.reached]), [['hospitality', 2, 2, 9, 1], ['software', 1, 1, 9, 1]]);
  const html = realSection(rows, judge([lab('a')]));
  assert.match(html, /Time to first job/);
  assert.match(html, /lab median 40 s/);
  assert.match(html, /Hospitality/);
});

test('a city is shown only when 3+ installs share it', () => {
  const two = ['a', 'b'].map(i => ({...report(`install-${i}`)}));
  assert.deepEqual(summarize(two).cities, []);
  assert.ok(!realSection(two).includes('zurich'));
  const three = ['a', 'b', 'c'].map(i => ({...report(`install-${i}`)}));
  assert.equal(summarize(three).cities[0].installs, 3);
  assert.match(realSection(three), /zurich, CH/);
  assert.equal(summarize([...two, ...two]).cities.length, 0, 'two installs searching twice are still two installs');
});

test('the tab is in the page, empty it says nothing arrived yet, and it holds no free text', () => {
  const html = page([], [], 'real', []);
  assert.match(html, /href="\?tab=real"[^>]*>Real installs/);
  assert.deepEqual([...html.matchAll(/<nav class="tabs">([\s\S]*?)<\/nav>/g)][0][1].match(/>[^<]+<\/a>/g), ['>Real installs</a>', '>Random draws</a>', '>Session checks</a>', '>Experiments</a>', '>Replays</a>', '>Needs a fix</a>', '>Fixed</a>', '>History</a>']);
  assert.match(html, /No real search reported yet/);
  const full = page([lab('a')], [], 'real', [report('install-aaaa')]);
  assert.match(full, /Hospitality/);
  assert.ok(!/Acme|https?:\/\/(?!www\.jobadabra)/.test(full.replace(/<style>[\s\S]*?<\/style>/, '')));
});

test('failed and stopped searches are kept apart from finished ones and never count as a time', async () => {
  const env = {STATS: d1(), ASSETS: {fetch: () => new Response('asset')}};
  await send(env, [report('install-aaaa'), {kind: 'search', install: 'install-bbbb', version: '0.8.3', platform: 'win32', at: '2026-10-19T11:00:00Z', result: 'failed', engine: 'cli', trigger: 'you'},
    {kind: 'search', install: 'install-cccc', version: '0.8.3', platform: 'win32', at: '2026-10-19T12:00:00Z', result: 'stopped', engine: 'cli', trigger: 'you', title: 'Barista'}]);
  const rows = await realRows(env.STATS, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(rows.map(r => r.result).sort(), ['failed', 'stopped', undefined]);
  const all = summarize(rows).all;
  assert.deepEqual([all.searches, all.failed, all.stopped, all.first_s], [3, 1, 1, 9]);
  assert.ok(!JSON.stringify(rows).includes('Barista'));
});

test('one row per day, newest first, with the day\'s searches, installs, failures and median first job', () => {
  const rows = [report('install-a', {first_s: 10}), report('install-b', {first_s: 30}), {kind: 'search', install: 'install-a', result: 'failed'}].map((r, i) => ({...r, day: i < 2 ? '2026-10-19' : '2026-10-20'}));
  const days = byDay(rows);
  assert.deepEqual(days.map(d => [d.day, d.searches, d.installs, d.failed, d.first_s]), [['2026-10-20', 1, 1, 1, null], ['2026-10-19', 2, 2, 0, 10]]);
  const html = realSection(rows);
  assert.match(html, /Day by day/);
  assert.match(html, /2026-10-19/);
});

test('zero reports says how many installs run a build that can send one, so an empty tab is not read as broken', async () => {
  const env = {STATS: d1(), ASSETS: {fetch: () => new Response('asset')}};
  const health = (install, version) => ({kind: 'health', install, version, platform: 'win32', at: '2026-10-19T09:00:00Z'});
  await send(env, [health('install-old1', '0.7.37'), health('install-old2', '0.7.12'), health('install-new1', '0.8.3'), health('install-dev1', '0.9.580')]);
  const sending = await canSend(env.STATS, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(sending, {installs: 4, canSend: 2});
  assert.match(realSection([], [], sending), /2 of 4 installs/);
  assert.match(page([], [], 'real', [], sending), /2 of 4 installs/);
});
