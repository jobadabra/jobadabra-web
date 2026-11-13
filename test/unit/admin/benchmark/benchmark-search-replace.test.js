// PUT /benchmark-search/data with `replace: true` (owner, 13 Nov 2026: "a full round's publish replaces its round's rows, so old rows can't linger again; side checks keep adding").
// Incident: ten stale "ours with every source" rows of round 2026-11-13 (00:07Z) stayed beside the new rows, because the ingest only upserts by id.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => { db.exec('BEGIN'); try { const out = list.map(item => db.prepare(item._sql).run(...item._args)); db.exec('COMMIT'); return out; } catch (error) { db.exec('ROLLBACK'); throw error; } }};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('x')}});
const put = (e, body) => worker.fetch(new Request('https://www.jobpilotto.top/benchmark-search/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(body)}), e, {});
const run = (round, tool, persona, extra = {}) => ({id: `${round}/${persona}/${tool}`, at: '2026-11-13T10:00:00Z', round, persona, kind: 'tech', country: 'Land', tool, ours: false, build: '', found: 10, place: 5, role: 5, relevant: 3, employers: 2, seconds: 60, cents: 0, ...extra});
const ids = e => e.STATS.db.prepare('SELECT id FROM benchmark_search_runs ORDER BY id').all().map(row => row.id);

test('a full round with replace:true removes that round\'s older rows; other rounds stay', async () => {
  const e = env();
  await put(e, {runs: [run('2026-11-13', 'Ours', 'p1', {ours: true}), run('2026-11-13', 'Ours (side line)', 'p1'), run('2026-11-13', 'Ours (side line)', 'p2'), run('2026-11-12', 'Ours', 'p1', {ours: true})]});
  const reply = await (await put(e, {replace: true, runs: [run('2026-11-13', 'Ours', 'p1', {ours: true}), run('2026-11-13', 'Ours + all', 'p1')]})).json();
  assert.deepEqual(ids(e), ['2026-11-12/p1/Ours', '2026-11-13/p1/Ours', '2026-11-13/p1/Ours + all'], 'the two old side-line rows are gone');
  assert.equal(reply.stored, 2);
  const snapshot = JSON.parse(e.STATS.db.prepare('SELECT body FROM benchmark_search_snapshot WHERE id = 1').get().body);
  assert.deepEqual(snapshot.rounds['2026-11-13'].tools.map(tool => tool.tool).sort(), ['Ours', 'Ours + all']);
});

test('without the flag (a side check) the rows keep adding; only a literal true replaces', async () => {
  const e = env();
  await put(e, {runs: [run('2026-11-13', 'Ours', 'p1', {ours: true}), run('2026-11-13', 'Other', 'p1')]});
  await put(e, {runs: [run('2026-11-13', 'Ours', 'p2', {ours: true})]});
  await put(e, {replace: 'yes', runs: [run('2026-11-13', 'Third', 'p1')]});
  assert.equal(ids(e).length, 4);
});

test('replace deletes only rounds that have a valid run in the body: bad rows and an empty list delete nothing', async () => {
  const e = env();
  await put(e, {runs: [run('2026-11-13', 'Ours', 'p1', {ours: true})]});
  await put(e, {replace: true, runs: []});
  await put(e, {replace: true, runs: [{...run('2026-11-13', 'Ours', 'p9'), kind: 'other'}]});
  assert.deepEqual(ids(e), ['2026-11-13/p1/Ours']);
});
