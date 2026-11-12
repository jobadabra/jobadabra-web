// /changelog/data and /changelog.json (admin/changelog-store.js): CI publishes a checked entry once, the site checks it again, the page reads D1 and falls back to the file.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: async () => new Response('[{"version":"0.7.16","fallback":true}]', {headers: {'Content-Type': 'application/json'}})}});
const call = (e, init = {}, path = '/changelog/data') => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const entry = (version, extra = {}) => ({version, date: '2026-10-18', channel: 'beta', groups: [{kind: 'features', items: [{emoji: '🔎', lead: 'Better search', text: 'Search shows more jobs.'}]}], ...extra});

test('the publish key is needed; without it the address does not exist', async () => {
  const e = env();
  assert.equal((await put(e, {entries: []}, 'wrong')).status, 404);
  assert.equal((await call(e, {method: 'GET'})).status, 404);
});

test('a checked entry is stored once; a rule-breaker is refused whole and nothing of it is stored', async () => {
  const e = env();
  assert.equal((await put(e, {entries: [entry('0.7.17')]})).status, 200);
  await put(e, {entries: [entry('0.7.17', {groups: [{kind: 'fixes', items: [{lead: 'Other', text: 'Replaced.'}]}]})]});
  assert.equal(JSON.parse(e.STATS.db.prepare('SELECT body FROM changelog_entries').get().body)[0].kind, 'features', 'a stored body is never replaced');
  const bad = await put(e, {entries: [entry('0.7.18'), entry('0.7.19', {groups: [{kind: 'features', items: [{lead: 'Pro', text: 'Pro costs $29.'}]}]})]});
  assert.equal(bad.status, 422);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM changelog_entries').get().n, 1);
});

test('GET says what is stored (hidden versions too); a beta becomes stable, never the other way', async () => {
  const e = env();
  await put(e, {entries: [entry('0.7.17'), entry('0.7.18', {channel: 'stable'})], hidden: [{version: '0.7.19', date: '2026-10-18', channel: 'beta'}]});
  await put(e, {channels: {'0.7.17': 'stable'}});
  await put(e, {entries: [entry('0.7.18', {channel: 'beta'})], channels: {}});
  const have = (await (await call(e, {headers: {Authorization: 'Bearer pub'}})).json()).have;
  assert.deepEqual(have, {'0.7.17': 'stable', '0.7.18': 'stable', '0.7.19': 'beta'});
});

test('the page reads the stored versions newest first, hidden ones left out; with nothing stored it reads the file', async () => {
  const e = env();
  const none = await (await call(e, {}, '/changelog.json')).json();
  assert.equal(none[0].fallback, true);
  await put(e, {entries: [entry('0.7.2'), entry('0.7.16', {channel: 'stable'})], hidden: [{version: '0.7.30', date: '2026-10-18', channel: 'beta'}]});
  const list = await (await call(e, {}, '/changelog.json')).json();
  assert.deepEqual(list.map(item => item.version), ['0.7.16', '0.7.2']);
  assert.equal(list[0].groups[0].items[0].emoji, '🔎');
});

test('/changelog.json asks Google not to index it (Search Console, 12 Nov 2026: crawled, not indexed): a data file, never a result', async () => {
  const e = env();
  await put(e, {entries: [entry('0.7.2')]});
  assert.equal((await call(e, {}, '/changelog.json')).headers.get('X-Robots-Tag'), 'noindex');
});

test('the 0.0.1 project-start entry is stored and listed last, under every real version', async () => {
  const e = env();
  await put(e, {entries: [entry('0.0.1', {channel: 'start', date: '2026-09-24'}), entry('0.4.0', {channel: 'stable'}), entry('0.7.2')]});
  assert.deepEqual((await (await call(e, {}, '/changelog.json')).json()).map(item => item.version), ['0.7.2', '0.4.0', '0.0.1']);
});

test('a plain entry is stored marked; GET lists it; a redraft replaces a plain body once and never an AI one', async () => {
  const e = env();
  await put(e, {entries: [entry('0.8.20', {plain: true}), entry('0.8.21')]});
  assert.deepEqual((await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}})).json()).plain, ['0.8.20']);
  const words = [{kind: 'fixes', items: [{emoji: '🐛', lead: 'Redrafted', text: 'Written by the AI.'}]}];
  assert.equal((await put(e, {redraft: [entry('0.8.20', {groups: words}), entry('0.8.21', {groups: words})]})).status, 200);
  const body = version => JSON.parse(e.STATS.db.prepare('SELECT body FROM changelog_entries WHERE version = ?').get(version).body)[0].kind;
  assert.equal(body('0.8.20'), 'fixes');
  assert.equal(body('0.8.21'), 'features', 'an AI entry is never replaced');
  assert.deepEqual((await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}})).json()).plain, []);
  assert.equal((await put(e, {redraft: [entry('0.8.20', {groups: [{kind: 'fixes', items: [{lead: 'Pro', text: 'Pro costs $29.'}]}]})]})).status, 422);
});
