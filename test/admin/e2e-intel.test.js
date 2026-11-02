// /e2e/data: CI sends each finished e2e run and its red suites once; a red whose cause was "open" is rewritten when the fix lands; one snapshot row, no table scan per page load.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../workers/www/index.js';
import {buildSnapshot} from '../../admin/e2e-intel.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const call = (e, init = {}, path = '/e2e/data') => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, body, key = 'pub') => call(e, {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
const run = (runId, conclusion = 'failure', extra = {}) => ({runId, createdAt: '2026-10-17T20:01:00Z', kind: 'beta', conclusion, minutes: 26, ...extra});
const fail = (runId, suite, platform, cause, extra = {}) => ({runId, suite, platform, cause, minutes: 12, day: '2026-10-17', ...extra});
const now = new Date('2026-10-18T12:00:00Z');

test('the publish key is needed; without it the address does not exist', async () => {
  const e = env();
  assert.equal((await put(e, {rules: 1, runs: [], fails: []}, 'wrong')).status, 404);
  assert.equal((await call(e, {method: 'GET'})).status, 404);
});

test('a run and its red suites are stored once; a later cause for the same red replaces "open"', async () => {
  const e = env();
  const first = await put(e, {rules: 1, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'open'), fail(1, 'apply', 'windows', 'ai')]});
  assert.equal(first.status, 200);
  await put(e, {rules: 1, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'test'), fail(1, 'apply', 'windows', 'open')]});
  const causes = Object.fromEntries(e.STATS.db.prepare('SELECT platform, cause FROM e2e_fails').all().map(row => [row.platform, row.cause]));
  assert.deepEqual(causes, {mac: 'test', windows: 'ai'}, 'open becomes test; a settled cause is not overwritten by open');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM e2e_runs').get().n, 1);
});

test('GET lists the settled runs and the pending ones (a red still open or unknown)', async () => {
  const e = env();
  await put(e, {rules: 1, runs: [run(1), run(2), run(3, 'success')], fails: [fail(1, 'apply', 'mac', 'test'), fail(2, 'quality', 'mac', 'open'), fail(2, 'quality', 'windows', 'unknown')]});
  const body = await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}}, '/e2e/data?v=1')).json();
  assert.deepEqual(body.have.sort(), [1, 3]);
  assert.deepEqual(body.pending, [2]);
});

test('a cancelled run is stored and counted as a cancelled try, not as a finished run', async () => {
  const e = env();
  await put(e, {rules: 1, runs: [run(1), run(2, 'success'), run(3, 'cancelled')], fails: []});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.deepEqual(snapshot.days.map(d => [d.runs, d.cancelled, d.reds, d.greens]), [[2, 1, 1, 1]]);
  assert.equal(snapshot.latest.filter(r => r.conclusion === 'cancelled').length, 1);
});

test('bad rows are dropped: an unknown cause, a run without a number, too many rows', async () => {
  const e = env();
  const response = await put(e, {rules: 1, runs: [run(1), {...run(2), runId: 'x'}], fails: [fail(1, 'apply', 'mac', 'because'), fail(1, 'apply', 'mac', 'flake')]});
  assert.equal((await response.json()).stored, 2);
  assert.equal(e.STATS.db.prepare('SELECT cause FROM e2e_fails').all().length, 1);
  assert.equal((await put(e, {rules: 1, runs: Array.from({length: 600}, (_, i) => run(i + 1)), fails: []})).status, 400);
});

test('the snapshot holds the last 30 days per day and per suite, and the page reads one row', async () => {
  const e = env();
  await put(e, {rules: 1, runs: [run(1), run(2, 'success'), run(3, 'failure', {createdAt: '2026-08-01T10:00:00Z'})], fails: [fail(1, 'apply', 'mac', 'test'), fail(1, 'apply', 'windows', 'test'), fail(3, 'old', 'mac', 'flake', {day: '2026-08-01'})]});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.deepEqual(snapshot.days.map(d => [d.day, d.runs, d.reds, d.greens, d.redMin]), [['2026-10-17', 2, 1, 1, 26]]);
  assert.deepEqual(snapshot.days.map(d => d.wallMin), [52], 'wall minutes are the start-to-end minutes of every finished run of the day (the nightly trends divide them by runs)');
  assert.deepEqual(snapshot.fails.map(f => [f.suite, f.platform, f.cause, f.n]).sort(), [['apply', 'mac', 'test', 1], ['apply', 'windows', 'test', 1]]);
  const stored = e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get();
  assert.equal(JSON.parse(stored.body).schema, snapshot.schema);
});

test('every run kind is kept with its runner minutes and PR; a red keeps its kind, failure line, fix and whether it caught a bug (a product cause); breaks group one run\'s same-cause reds', async () => {
  const e = env();
  const line = 'tar: D\\:\\a\\_temp/free-ai-tree: Cannot open';
  await put(e, {rules: 3, runs: [run(1, 'failure', {kind: 'nightly'}), run(2, 'failure', {kind: 'pr', queueMin: 8.5, runMin: 2.2, pr: 2123}), run(3, 'success', {kind: 'after-merge'})],
    fails: [fail(1, 'apply', 'windows', 'ci', {kind: 'nightly', line}), fail(1, 'jobs', 'windows', 'ci', {kind: 'nightly', line}), fail(1, 'quality', 'mac', 'drift', {kind: 'nightly', line: '✗ x', fix: 'f1'}),
      fail(2, 'wander', 'mac', 'product', {kind: 'pr', line: '✗ [wander] error-shown', caught: 1})]});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.equal(snapshot.schema, 2);
  assert.deepEqual(snapshot.days.map(d => [d.kind, d.runs, d.reds, d.queueMin, d.runMin, d.prs]).sort(), [['after-merge', 1, 0, 0, 0, 0], ['nightly', 1, 1, 0, 0, 0], ['pr', 1, 1, 8.5, 2.2, 1]]);
  assert.deepEqual(snapshot.breaks[0], {day: '2026-10-17', kind: 'nightly', runId: 1, cause: 'ci', line, n: 2}, 'one relay break on two suites is one break');
  assert.deepEqual(snapshot.caught, [{day: '2026-10-17', kind: 'pr', runId: 2, suite: 'wander', line: '✗ [wander] error-shown', pr: 2123}]);
  assert.equal(e.STATS.db.prepare("SELECT fix FROM e2e_fails WHERE suite = 'quality'").get().fix, 'f1');
});

test('a newer rules version rewrites a settled red and its run (rules 3 re-read every run of rules 1-2)', async () => {
  const e = env();
  await put(e, {rules: 2, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'product')]});
  await put(e, {rules: 3, runs: [run(1, 'failure', {kind: 'nightly', queueMin: 3})], fails: [fail(1, 'apply', 'mac', 'drift', {kind: 'nightly'})]});
  assert.deepEqual({...e.STATS.db.prepare('SELECT cause, kind FROM e2e_fails').get()}, {cause: 'drift', kind: 'nightly'});
  assert.deepEqual({...e.STATS.db.prepare('SELECT kind, queue_min FROM e2e_runs').get()}, {kind: 'nightly', queue_min: 3});
});

test('where e2e work goes: commits per day and kind are upserted, a week\'s files are replaced when sent again, bad rows dropped, the snapshot carries both', async () => {
  const e = env(), work = (day, kind, commits) => ({day, kind, commits}), file = (week, name, commits) => ({week, file: name, commits});
  await put(e, {rules: 3, runs: [], fails: [], work: [work('2026-10-17', 'plumbing', 4), work('2026-10-17', 'product', 6), work('2026-10-17', 'chores', 1), work('17 Oct', 'tests', 1)],
    workFiles: [file('2026-10-12', '.github/workflows/e2e.yml', 3), file('2026-10-12', 'desktop/e2e/lib/x.mjs', 2), file('2026-10-12', 'a b;c', 1)]});
  await put(e, {rules: 3, runs: [], fails: [], work: [work('2026-10-17', 'plumbing', 5)], workFiles: [file('2026-10-12', 'tools/ship.sh', 4)]});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.deepEqual(snapshot.work.map(row => [row.day, row.kind, row.commits]).sort(), [['2026-10-17', 'plumbing', 5], ['2026-10-17', 'product', 6]], 'an unknown kind and a bad day are dropped; a re-sent day replaces its count');
  assert.deepEqual(snapshot.workFiles.map(row => [row.week, row.file, row.commits]), [['2026-10-12', 'tools/ship.sh', 4]], 'the week sent again keeps only its newest files');
});

test('GET ?snapshot=1 hands the weekly summary the row the page draws; none yet is a 404; the publish key is needed', async () => {
  const e = env(), get = key => call(e, {method: 'GET', headers: {Authorization: `Bearer ${key}`}}, '/e2e/data?snapshot=1');
  assert.equal((await get('pub')).status, 404);
  await put(e, {rules: 1, runs: [run(1)], fails: [fail(1, 'apply', 'mac', 'test')]});
  const response = await get('pub'), stored = e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), stored);
  assert.equal((await get('wrong')).status, 404);
});

test('public main lanes and observed suite nights live in the same snapshot, survive an hourly update, and replace an empty registry', async () => {
  const {ingest} = await import('../../admin/e2e-intel.js');
  const e = env(), at = new Date('2026-10-30T12:00:00Z');
  const send = body => ingest(new Request('https://test/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({runs: [], fails: [], ...body})}), e, at);
  const lanes = {suites: {quality: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: 'Unkeyed question'}, old: {lane: 'retired', since: '2026-10-01'}}};
  await send({lanes, mainBands: {quality: {agree: {lower: 0.8, upper: 0.95}}}, suiteNights: [{runId: 9, day: '2026-10-29', kind: 'nightly', suite: 'quality', platform: 'mac', green: true}, {runId: 10, day: '2026-10-30', kind: 'pr', suite: 'quality', platform: 'mac', green: true}]});
  await send({suiteNights: [{runId: 9, day: '2026-10-29', kind: 'nightly', suite: 'quality', platform: 'mac', green: false, rates: {agree: 0.6}}]});
  const s = JSON.parse(e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body);
  assert.equal(s.lanes.suites.quality.since, '2026-10-29');
  assert.equal(s.lanes.suites.quality.returns, undefined);
  assert.equal(s.suiteNights.length, 1, 'PR runs are not nights; re-reading a run replaces its observation');
  assert.equal(s.suiteNights[0].green, false);
  assert.deepEqual(s.suiteNights[0].rates, {agree: 0.6});
  assert.deepEqual(s.mainBands, {quality: {agree: {lower: 0.8, upper: 0.95}}});
  assert.equal(s.greyJobs, undefined, 'the retired grey ledger is not kept');
  const known = await (await call(e, {headers: {Authorization: 'Bearer pub'}})).json();
  assert.deepEqual(known.suiteNights, [9], 'settled runs still missing suite history can be backfilled');
  await send({lanes: {suites: {}}});
  assert.deepEqual(JSON.parse(e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body).lanes, {suites: {}});
});

test('suite timings survive snapshot refresh, deduplicate re-reads, expire after thirty days and drop unbounded fields', async () => {
  const {ingest} = await import('../../admin/e2e-intel.js');
  const e = env(), at = new Date('2026-10-30T12:00:00Z');
  const send = runs => ingest(new Request('https://test/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({runs, fails: []})}), e, at);
  const timed = (id, extra = {}) => run(id, 'success', {createdAt: '2026-10-29T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'jobs', seconds: 307, log: 'never stored'}], ...extra});
  await send([timed(1), timed(2, {createdAt: '2026-09-30T11:59:59Z'}), timed(3, {suiteJobs: [{suite: 'invalid', seconds: -1}, {suite: 'too-long', seconds: 86401}]})]);
  await send([timed(1, {suiteJobs: [{suite: 'jobs', seconds: 308}]})]);
  await send([]);
  const s = await buildSnapshot(e.STATS, at);
  assert.deepEqual(s.speedRuns, [{runId: 1, createdAt: '2026-10-29T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'jobs', seconds: 308}]}]);
  const later = await buildSnapshot(e.STATS, new Date('2026-12-01T12:00:00Z'));
  assert.deepEqual(later.speedRuns, []);
});

test('beta runs\' suite counts are validated, kept in the snapshot, replaced on a re-read, expire after thirty days, and listed back so the collector reads only the missing ones', async () => {
  const {ingest} = await import('../../admin/e2e-intel.js');
  const e = env(), at = new Date('2026-11-01T12:00:00Z');
  const send = betaRuns => ingest(new Request('https://test/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({runs: [], fails: [], betaRuns})}), e, at);
  const beta = (runId, extra = {}) => ({runId, createdAt: '2026-10-31T10:01:00Z', sha: 'abcdef1234', conclusion: 'failure', green: 60, red: 2, grey: 0, released: false, redSuites: ['Windows · foryou', 'Mac + Linux · apply'], ...extra});
  await send([beta(1), beta(2, {green: -3}), beta(3, {createdAt: '2026-09-01T10:00:00Z'}), beta(4, {sha: 'zz', note: 'never stored'}), beta(5, {released: true, red: 0, conclusion: 'success', redSuites: []})]);
  await send([beta(1, {green: 62, red: 0, conclusion: 'success', redSuites: [], released: true})]);
  const s = await buildSnapshot(e.STATS, at);
  assert.deepEqual(s.betaRuns.map(row => [row.runId, row.green, row.red, row.released]), [[5, 60, 0, true], [1, 62, 0, true]],
    'bad shapes are dropped (negative count, 30 days old, bad commit); a re-read run replaces its row; the second PUT keeps the first one\'s rows');
  assert.equal(s.betaRuns.every(row => row.note === undefined), true);
  const known = await (await call(e, {headers: {Authorization: 'Bearer pub'}})).json();
  assert.deepEqual(known.betaRuns.sort(), [1, 5], 'the collector is told which beta runs the site already has');
  assert.deepEqual((await buildSnapshot(e.STATS, new Date('2026-12-05T12:00:00Z'))).betaRuns, [], 'thirty days later the rows are gone');
});

// 2 Nov 2026 (owner: "has this caught bug been counted?"): apply-1of3 stored as runner (#2986's window answer); #2988 names the run id and says product.
test('a red a fix names by run id is rewritten once to that fix, though it was settled; the same word again changes nothing; GET lists the stored reds', async () => {
  const e = env();
  await put(e, {rules: 3, runs: [run(41412195017, 'failure', {kind: 'scheduled'})], fails: [fail(41412195017, 'apply-1of3', 'mac', 'runner', {kind: 'scheduled', fix: '0f360260'})]});
  await put(e, {rules: 3, runs: [run(41412195017, 'failure', {kind: 'scheduled'})], fails: [fail(41412195017, 'apply-1of3', 'mac', 'test', {kind: 'scheduled', fix: 'zzz'})]});
  const stored = () => e.STATS.db.prepare('SELECT cause, fix, caught FROM e2e_fails').get();
  assert.deepEqual({...stored()}, {cause: 'runner', fix: '0f360260', caught: 0}, 'a settled red at the same rules is not rewritten by a window answer');
  await put(e, {rules: 3, runs: [], fails: [fail(41412195017, 'apply-1of3', 'mac', 'product', {kind: 'scheduled', fix: '9d511a1c', caught: 1, named: 1})]});
  assert.deepEqual({...stored()}, {cause: 'product', fix: '9d511a1c', caught: 1}, 'a named fix rewrites it');
  await put(e, {rules: 3, runs: [], fails: [fail(41412195017, 'apply-1of3', 'mac', 'runner', {kind: 'scheduled', fix: '0f360260'})]});
  assert.equal(stored().cause, 'product', 'and a later window answer does not undo it');
  const body = await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}}, '/e2e/data?v=3')).json();
  assert.deepEqual(body.reds, [[41412195017, 'apply-1of3', 'product', '9d511a1c', 'scheduled']], 'each stored red with its cause and fix: the collector decides which a trailer would change');
  await put(e, {rules: 3, runs: [run(7, 'failure', {kind: 'pr', pr: 5})], fails: [fail(7, 'apply', 'mac', 'test', {kind: 'pr'})]});
  assert.equal((await (await call(e, {method: 'GET', headers: {Authorization: 'Bearer pub'}}, '/e2e/data?v=3')).json()).reds.length, 1, 'a pull-request red is left out: a main commit never names it');
});

test('"caught" is every red whose cause is the product, on any run kind, with the kind it was caught in; the stored flag does not decide', async () => {
  const e = env();
  await put(e, {rules: 3, runs: [run(1, 'failure', {kind: 'scheduled'}), run(2, 'failure', {kind: 'pr', pr: 2123}), run(3, 'failure', {kind: 'nightly'}), run(4, 'failure', {kind: 'beta'})],
    fails: [fail(1, 'apply', 'mac', 'product', {kind: 'scheduled', line: '✗ a'}), fail(2, 'wander', 'mac', 'product', {kind: 'pr', line: '✗ b', caught: 1}),
      fail(3, 'jobs', 'mac', 'product', {kind: 'nightly', line: '✗ c'}), fail(4, 'jobs', 'mac', 'flake', {kind: 'beta', line: '✗ d', caught: 1})]});
  const snapshot = await buildSnapshot(e.STATS, now);
  assert.deepEqual(snapshot.caught.map(row => [row.runId, row.kind, row.pr ?? null]).sort((a, b) => a[0] - b[0]), [[1, 'scheduled', null], [2, 'pr', 2123], [3, 'nightly', null]]);
});
