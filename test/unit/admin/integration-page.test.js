// /admin/testing/integrations (owner, 1 Nov 2026): the snapshot drawn per layer, flaky tests, the slowest 10, the move; owner only; in the Testing menu; the collector's PUT validated.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {PAGES} from '../../../admin/admin.js';
import {cleanSnapshot, ingest} from '../../../admin/integration-intel.js';
import {greenRows, layerStats, moveStats, page, seconds} from '../../../admin/integration-page.js';

const now = new Date('2026-11-01T12:00:00Z');
const run = (runId, layer, day, conclusion = 'success', extra = {}) => ({runId, layer, day, on: 'main', platform: 'linux', sha: 'abcdef1', conclusion, tests: 10, failed: conclusion === 'success' ? 0 : 1, ms: 4000, ...extra});
const snapshot = cleanSnapshot({
  runs: [run(1, 'app', '2026-10-31'), run(1, 'app', '2026-10-31', 'failure', {platform: 'windows', ms: 9000}), run(2, 'app', '2026-11-01'), run(3, 'store', '2026-11-01', 'success', {ms: 1000}), run(4, 'extension', '2026-10-01'), run(5, 'store', '2026-11-01', 'failure', {on: 'pr'})],
  counts: {app: {tests: 118, files: 16}, store: {tests: 41, files: 6}, extension: {tests: 64, files: 9}},
  flaky: [{layer: 'app', test: 'focus keeps state', file: 'integration/app/f.test.js', kind: 'same-commit', day: '2026-10-31', red: {runId: 1, sha: 'abcdef1'}, green: {runId: 2, sha: 'abcdef1'}}],
  slowest: [{layer: 'app', test: 'slow one', file: 'integration/app/s.test.js', ms: 9400}, {layer: 'store', test: 'fast one', file: 'integration/store/f.test.mjs', ms: 90}],
  move: {days: [{day: '2026-10-30', e2eSteps: 200, e2eSuites: 29, integration: {extension: 0, app: 50, store: 0}}, {day: '2026-11-01', e2eSteps: 150, e2eSuites: 27, integration: {extension: 20, app: 80, store: 10}}], e2eSteps: 150, lanes: 28}}, now);

test('a run is green only when every platform was green; a PR run and a run outside the range do not count', () => {
  const stats = Object.fromEntries(layerStats(snapshot, '7d', now).map(row => [row.layer, row]));
  assert.deepEqual([stats.app.runs, stats.app.greens, stats.app.median, stats.app.tests], [2, 1, 4000, 118], 'run 1: Windows red makes the run red; run times 9000 (its slowest platform) and 4000 give the lower median');
  assert.deepEqual([stats.store.runs, stats.store.greens], [1, 1], 'the PR run is not main');
  assert.equal(stats.extension.runs, 0, '1 Oct is outside 7 days');
  assert.deepEqual(greenRows(snapshot, now).days.filter(row => row.kind === 'app').map(row => `${row.day} ${row.greens}/${row.reds}`).sort(), ['2026-10-31 0/1', '2026-11-01 1/0']);
});

test('the page: green share per layer, the shared green chart, the flaky test with both runs, the slowest flagged, the move', () => {
  const html = page(snapshot, {now});
  assert.match(html, /Integration tests/);
  assert.match(html, /App · main green<\/span><b>50%/);
  assert.match(html, /Green runs per day · Last 7 days/, 'the e2e green chart');
  assert.match(html, /focus keeps state[^]*same commit[^]*runs\/1">#1<\/a>[^]*runs\/2">#2<\/a>/);
  assert.match(html, /slow one[^]*9\.4 s/);
  assert.match(html, /chip warn">9\.4 s/, 'over 5 s is flagged');
  assert.doesNotMatch(html, /chip warn">90 ms/);
  assert.match(html, /42% of the checks now run as integration tests[^]*110 integration tests, 150 e2e steps left; 50 e2e steps gone since 30 Oct/);
  assert.match(page(null, {now}), /No data yet/);
  assert.match(page({...snapshot, flaky: []}, {now}), /No flaky test in this range/);
});

test('move and time words', () => {
  assert.equal(moveStats(null), null);
  assert.deepEqual([seconds(900), seconds(9400), seconds(87000)], ['900 ms', '9.4 s', '1 min 27 s']);
  assert.deepEqual([seconds(59960), seconds(119600), seconds(60000)], ['1 min 0 s', '2 min 0 s', '1 min 0 s'], 'Gitar #245: rounding never shows 60 s or 1 min 60 s');
});

test('the collector body is validated: unknown layers, bad days and long texts are dropped', () => {
  assert.equal(cleanSnapshot({runs: 'x'}, now), null);
  const clean = cleanSnapshot({runs: [run(1, 'nope', '2026-11-01'), run(2, 'app', 'yesterday'), run(3, 'app', '2026-11-01')], slowest: [{layer: 'app', test: 'x'.repeat(500), ms: 5}]}, now);
  assert.equal(clean.runs.length, 1);
  assert.equal(clean.slowest[0].test.length, 200);
});

const env = (stored = null) => ({STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', STATS: {prepare: () => ({first: async () => (stored ? {body: JSON.stringify(stored)} : null), bind() { return this; }, run: async () => ({}), all: async () => ({results: []})})}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env(snapshot), {});

test('a long list is cut to its newest rows, never refused; the ids of runs read are kept (Gitar #245)', () => {
  const runs = Array.from({length: 3500}, (_, i) => run(1000 + i, 'app', '2026-11-01'));
  const clean = cleanSnapshot({runs, read: [5, 'x', 7]}, now);
  assert.deepEqual([clean.runs.length, clean.runs[0].runId, clean.runs.at(-1).runId, clean.read], [3000, 1500, 4499, [5, 7]]);
});

test('owner only, in the Testing menu; the PUT needs the publish key and a snapshot-shaped body', async () => {
  assert.equal((await get('/admin/testing/integrations')).status, 404);
  const response = await get('/admin/testing/integrations', {Cookie: 'jp_stats=k3y'});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Integration tests/);
  assert.equal(PAGES.find(item => item.path === '/admin/testing/integrations').group, 'Testing');
  const put = (key, body) => ingest(new Request('https://x/integration/data', {method: 'PUT', headers: key ? {Authorization: `Bearer ${key}`} : {}, body}), env(), now);
  assert.equal((await put(null, '{}')).status, 404);
  assert.equal((await put('wrong', '{}')).status, 404);
  assert.equal((await put('pub', 'nope')).status, 400);
  assert.equal((await put('pub', '{"runs":"x"}')).status, 400);
  assert.equal((await put('pub', JSON.stringify({runs: [run(1, 'app', '2026-11-01')]}))).status, 200);
});
