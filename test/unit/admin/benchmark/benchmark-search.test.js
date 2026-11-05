// /admin/job-search/benchmark: the shares, the rounds and kinds, the missed-by-job-system table, the ingest (key, bad rows, one row per run, one snapshot) and that a page load reads one snapshot row.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {PAGES} from '../../../../admin/admin.js';
import {summarize, totals} from '../../../../admin/benchmark-search-data.js';
import {page} from '../../../../admin/benchmark-search-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const reads = {rows: 0, queries: 0};
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => { reads.queries++; const results = db.prepare(sql).all(...args); reads.rows += results.length; return {results}; },
    first: async () => { reads.queries++; const row = db.prepare(sql).get(...args); reads.rows += row ? 1 : 0; return row; }, _sql: sql, _args: args});
  return {db, reads, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('x')}});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, '/benchmark-search/data', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});

// Made-up names: the real ones only ever arrive as data.
const run = (tool, persona, kind, found, place, role, relevant, extra = {}) => ({id: `${extra.round || 'r1'}/${persona}/${tool}`, at: '2026-10-20T10:00:00Z', round: 'r1', persona, kind, country: 'Land', tool, ours: false, build: '', found, place, role, relevant,
  employers: 3, seconds: 60, cents: 0, ...extra});
const FIXTURE = [
  run('Ours', 'Nurse · Town', 'non-tech', 100, 40, 80, 30, {ours: true, build: 'abc1234', seconds: 600}), run('Ours', 'Coder · City', 'tech', 50, 10, 20, 0, {ours: true, build: 'abc1234', seconds: 800}),
  run('Other', 'Nurse · Town', 'non-tech', 10, 8, 9, 8, {missed: {'system-a': 5, 'system-b': 3}}), run('Other', 'Coder · City', 'tech', 0, 0, 0, 0, {missed: {'system-a': 2}}),
  run('Ours', 'Nurse · Town', 'non-tech', 10, 5, 5, 4, {ours: true, build: 'def5678', round: 'r2', at: '2026-10-27T10:00:00Z'}),
];

test('shares are of the jobs shown; no jobs shown gives no share, not 0%', () => {
  const t = totals([{persona: 'a', found: 100, place: 40, role: 80, relevant: 30, employers: 3, seconds: 600, cents: 5}, {persona: 'b', found: 0, place: 0, role: 0, relevant: 0, employers: 0, seconds: 60, cents: 0}]);
  assert.deepEqual([t.placeShare, t.roleShare, t.relevantShare, t.empty, t.avgSeconds], [40, 80, 30, 1, 330]);
  assert.equal(totals([{persona: 'b', found: 0, place: 0, role: 0, relevant: 0, employers: 0, seconds: 0, cents: 0}]).relevantShare, null);
});

test('a search with no recorded time is left out of the average; none timed shows a dash, not 0 s', () => {
  const row = seconds => ({persona: String(seconds), found: 1, place: 1, role: 1, relevant: 1, employers: 1, seconds, cents: 0});
  assert.equal(totals([row(600), row(0), row(200)]).avgSeconds, 400);
  assert.equal(totals([row(0), row(0)]).avgSeconds, null);
  assert.match(page({...summarize([{...row(0), id: 'r/p/T', at: '2026-10-27T10:00:00Z', round: 'r', persona: 'p', kind: 'tech', country: 'Land', tool: 'Theirs', ours: false, build: ''}]), at: '2026-10-27T10:00:00Z'}), /<td class="num">–<\/td>/);
});

test('rounds are separate; ours comes first; the kinds split; the missed job systems add up over personas, largest first', () => {
  const s = summarize(FIXTURE.map(row => ({...row, ours: row.ours ? 1 : 0}))).rounds;
  assert.deepEqual(Object.keys(s), ['r1', 'r2']);
  const r1 = s.r1;
  assert.deepEqual(r1.tools.map(tool => tool.tool), ['Ours', 'Other']);
  assert.equal(r1.tools[0].build, 'abc1234');
  assert.deepEqual([r1.tools[0].relevant, r1.tools[0].empty], [30, 1]);
  assert.equal(r1.kinds['non-tech'].Ours.relevant, 30);
  assert.equal(r1.kinds.tech.Ours.relevant, 0);
  assert.deepEqual(r1.missed, [['system-a', 7], ['system-b', 3]]);
  assert.equal(s.r2.tools.length, 1);
});

test('the ingest needs the publish key, drops bad rows, stores a run once, and rebuilds one snapshot row', async () => {
  const e = env();
  assert.equal((await put(e, {runs: FIXTURE}, 'wrong')).status, 404);
  assert.equal((await put(e, {nope: 1})).status, 400);
  const reply = await (await put(e, {runs: [...FIXTURE, {id: 'bad', at: 'nope', tool: 'T', persona: 'P', kind: 'tech'}, {...FIXTURE[0], id: 'odd-kind', kind: 'other'}, {...FIXTURE[0], id: 'too-many', relevant: 999}]})).json();
  assert.deepEqual([reply.stored, reply.ignored], [FIXTURE.length, 3]);
  await put(e, {runs: FIXTURE});   // the same runs again: no new rows
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM benchmark_search_runs').get().n, FIXTURE.length);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM benchmark_search_snapshot').get().n, 1);
});

test('the page reads ONE snapshot row, never the runs table; closed to anyone but the owner; has an entry in the admin menu', async () => {
  const e = env();
  await put(e, {runs: FIXTURE});
  e.STATS.reads.queries = e.STATS.reads.rows = 0;
  assert.equal((await call(e, '/admin/job-search/benchmark')).status, 404);
  const html = await (await call(e, '/admin/job-search/benchmark?round=r1', owner)).text();
  assert.deepEqual([e.STATS.reads.queries, e.STATS.reads.rows], [1, 1]);
  assert.match(html, /Benchmark Job Search/);
  assert.match(html, /system-a/);
  assert.ok(PAGES.some(entry => entry.path === '/admin/job-search/benchmark' && entry.group === 'Job search'));
});

test('the page says so when there is no data, and shows an older round when asked', () => {
  assert.match(page(null), /No data yet/);
  const snapshot = {...summarize(FIXTURE.map(row => ({...row, ours: row.ours ? 1 : 0}))), at: '2026-10-27T10:00:00Z'};
  assert.match(page(snapshot, {round: 'r1'}), /round r1/);
  assert.match(page(snapshot), /round r2/);
});

test('a row with `beyond` is stored and the page shows the jobs "ours with every source" adds beyond each rival, without counting that line as a rival', async () => {
  const e = env();
  const runs = [...FIXTURE.filter(row => row.round === 'r1'),
    run('Ours + all', 'Nurse · Town', 'non-tech', 120, 50, 90, 33, {beyond: {Other: 25, Third: 33}}), run('Ours + all', 'Coder · City', 'tech', 60, 12, 24, 1, {beyond: {Other: 1}})];
  await put(e, {runs});
  assert.deepEqual(JSON.parse(e.STATS.db.prepare("SELECT beyond FROM benchmark_search_runs WHERE tool = 'Ours + all' AND persona = 'Coder · City'").get().beyond), {Other: 1});
  const r1 = summarize(e.STATS.db.prepare('SELECT * FROM benchmark_search_runs').all().map(row => ({...row}))).rounds.r1;
  assert.deepEqual(r1.beyond, [['Third', 33, 1], ['Other', 26, 0]], 'Third has no number for the second search: it is counted as missing, not as a smaller total');
  assert.equal(r1.tools.find(tool => tool.tool === 'Ours + all').withAll, true);
  assert.deepEqual(r1.missed, [['system-a', 7], ['system-b', 3]], 'the with-everything line adds nothing to the jobs we miss');
  const html = await (await call(e, '/admin/job-search/benchmark?round=r1', owner)).text();
  assert.match(html, /Relevant jobs we add beyond each rival/);
  assert.match(html, /<td>Third<\/td><td class="num">33<\/td><td class="num warn">1 of 2<\/td>/);
  assert.match(html, /<td>Other<\/td><td class="num">26<\/td><td class="num muted">–<\/td>/);
  assert.doesNotMatch(await (await call(env(), '/admin/job-search/benchmark', owner)).text(), /we add beyond each rival/, 'no card without the data');
});

test('a rival that failed for EVERY search (sent as null) still shows on the card as failed, never vanishes', async () => {
  const e = env();
  const runs = [run('Ours + all', 'Nurse · Town', 'non-tech', 120, 50, 90, 33, {beyond: {Other: 25, Dead: null}}), run('Ours + all', 'Coder · City', 'tech', 60, 12, 24, 1, {beyond: {Other: 1, Dead: null}})];
  await put(e, {runs});
  assert.deepEqual(JSON.parse(e.STATS.db.prepare("SELECT beyond FROM benchmark_search_runs WHERE persona = 'Coder · City'").get().beyond), {Other: 1, Dead: null}, 'null is kept, not turned into 0');
  const r1 = summarize(e.STATS.db.prepare('SELECT * FROM benchmark_search_runs').all().map(row => ({...row}))).rounds.r1;
  assert.deepEqual(r1.beyond, [['Other', 26, 0], ['Dead', 0, 2]]);
  const html = await (await call(e, '/admin/job-search/benchmark?round=r1', owner)).text();
  assert.match(html, /<td>Dead<\/td><td class="num">–<\/td><td class="num warn">2 of 2<\/td>/);
});
