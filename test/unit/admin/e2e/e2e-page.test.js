// /admin/testing/e2e: the snapshot drawn in each state, owner only, in the menu under Testing, and the old /admin/e2e address going there.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {PAGES} from '../../../../admin/admin.js';
import {bars, page, rangeOf, suiteRows, windowOf} from '../../../../admin/e2e-page.js';

const now = new Date('2026-10-18T12:00:00Z');
const snapshot = {schema: 1, at: '2026-10-18T11:41:00Z',
  days: [{day: '2026-10-17', runs: 4, cancelled: 3, reds: 3, greens: 1, redMin: 80}, {day: '2026-10-12', runs: 2, reds: 1, greens: 1, redMin: 30}, {day: '2026-09-30', runs: 1, reds: 1, greens: 0, redMin: 20}],
  fails: [{day: '2026-10-17', suite: 'apply', platform: 'mac', cause: 'test', n: 2, min: 24}, {day: '2026-10-17', suite: 'apply', platform: 'windows', cause: 'test', n: 2, min: 28}, {day: '2026-10-17', suite: 'strategy', platform: 'mac', cause: 'credit', n: 1, min: 6},
    {day: '2026-10-12', suite: 'quality', platform: 'mac', cause: 'flake', n: 1, min: 9}, {day: '2026-09-30', suite: 'old', platform: 'mac', cause: 'product', n: 1, min: 5}],
  latest: [{runId: 39074977525, day: '2026-10-17', kind: 'beta', conclusion: 'failure', minutes: 26}, {runId: 39072072784, day: '2026-10-17', kind: 'beta', conclusion: 'success', minutes: 16}]};
const env = () => ({STATS_KEY: 'k3y', STATS_SALT: 's', STATS: {prepare: () => ({first: async () => ({body: JSON.stringify(snapshot)}), bind() { return this; }, all: async () => ({results: []})})}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env(), {});

test('an unknown range is 7 days; the range counts only its own days', () => {
  assert.equal(rangeOf('nope'), '7d');
  const week = windowOf(snapshot, '7d', now), month = windowOf(snapshot, '30d', now);
  assert.deepEqual([week.runs, week.redRuns, week.greenRuns, week.redMin, week.reds], [6, 4, 2, 110, 6]);
  assert.deepEqual(week.byCause, {ai: 1, ci: 0, picker: 0, runner: 0, flake: 1, timing: 0, drift: 0, test: 4, product: 0, open: 0, unknown: 0}, 'rules 1-2 rows read under today\'s ids: credit is ai');
  assert.deepEqual([month.runs, month.redRuns, month.redMin, month.reds], [7, 5, 130, 7]);
});

test('suites are listed by the time their reds cost, with their causes', () => {
  const rows = suiteRows(windowOf(snapshot, '7d', now));
  assert.deepEqual(rows.map(row => `${row.suite}/${row.platform}`), ['apply/windows', 'apply/mac', 'quality/mac', 'strategy/mac']);
  assert.deepEqual(rows[0].causes, {test: 2});
});

test('the page: numbers, suites with chips, a bar per day, the run list; "no data yet" and "no reds" are said in words', () => {
  const html = page(snapshot, {range: '7d', now});
  assert.match(html, /67%/, 'red runs: 4 of 6');
  assert.match(html, /1\.8 h/, '110 minutes of red runs');
  assert.match(html, /17%/, 'flakes: 1 of 6 red suites');
  assert.match(html, /Betas per green<\/span><b>4\.5<\/b>[^]*?9 betas started \(3 cancelled\) for 2 green/, 'cancelled betas count as tries: (6 finished + 3 cancelled) / 2 green');
  assert.match(html, /Top cause<\/span><b>Test bug/);
  assert.match(html, /<code>apply<\/code><\/td><td>Windows<\/td>/);
  assert.match(html, /actions\/runs\/39074977525/);
  assert.equal((html.match(/class="night"/g) || []).length, 2, 'one bar row per day that had a run (17 and 12 Oct); days with no run are left out');
  assert.match(page(null, {now}), /No data yet/);
  assert.match(page({...snapshot, days: [], fails: [], latest: []}, {now}), /No red suites in this range/);
  assert.equal(bars(windowOf(snapshot, '7d', now)).includes('3 red suites') || bars(windowOf(snapshot, '7d', now)).includes('5 red suites'), true);
});

test('owner only; the menu lists E2E under Testing; the old runs address goes to the tab', async () => {
  assert.equal((await get('/admin/testing/e2e')).status, 404);
  const response = await get('/admin/testing/e2e', {Cookie: 'jp_stats=k3y'});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Why e2e goes red/);
  assert.equal(PAGES.find(item => item.path === '/admin/testing/e2e').group, 'Testing');
  const old = await get('/admin/e2e', {Cookie: 'jp_stats=k3y'});
  assert.equal(old.headers.get('Location'), '/admin/testing/e2e');
});

test('the top answers "why red?" in seconds: who caused it, top causes with test drift always named, top suites, the biggest breaks, PR e2e cost vs catch, main green per day', () => {
  const line = 'tar: D\\:\\a\\_temp/free-ai-tree: Cannot open';
  const snap = {schema: 2, at: '2026-10-27T11:41:00Z',
    days: [{day: '2026-10-26', kind: 'nightly', runs: 1, reds: 1, greens: 0}, {day: '2026-10-26', kind: 'after-merge', runs: 10, reds: 1, greens: 9}, {day: '2026-10-26', kind: 'pr', runs: 20, reds: 3, greens: 17, queueMin: 300, runMin: 300, prs: 12},
      {day: '2026-10-24', kind: 'beta', runs: 2, reds: 2, greens: 0}],
    fails: [{day: '2026-10-26', kind: 'nightly', suite: 'apply', platform: 'windows', cause: 'ci', n: 32, min: 64}, {day: '2026-10-26', kind: 'pr', suite: 'settings', platform: 'mac', cause: 'picker', n: 10, min: 20},
      {day: '2026-10-26', kind: 'pr', suite: 'wander', platform: 'mac', cause: 'product', n: 2, min: 8}, {day: '2026-10-24', kind: 'beta', suite: 'quality', platform: 'mac', cause: 'product', n: 6, min: 30}],
    breaks: [{day: '2026-10-26', kind: 'nightly', runId: 40261885119, cause: 'ci', line, n: 32}, {day: '2026-10-26', kind: 'pr', runId: 5, cause: 'picker', line: '✗ steps picked', n: 1}],
    caught: [{day: '2026-10-26', kind: 'pr', runId: 6, suite: 'wander', line: '✗ [wander] error-shown', pr: 2123}, {day: '2026-10-26', kind: 'pr', runId: 7, suite: 'wander', line: '✗ x', pr: 2150},
      {day: '2026-10-26', kind: 'nightly', runId: 8, suite: 'apply', line: '✗ a night catch'}], latest: []};
  const at = new Date('2026-10-27T12:00:00Z'), html = page(snap, {range: '7d', now: at});
  assert.match(html, /50 red suites from 2 breaks:<\/b> Our CI and AI 84% · the tests 0% · the app 16%/);
  assert.match(html, /<b><span class="sw"[^>]*><\/span>Test drift<\/b>/, 'test drift is named even at 0');
  assert.match(html, /<code>apply<\/code><\/td><td class="num">32<\/td><td><span class="chip">CI setup broke 32/);
  assert.match(html, /free-ai-tree/);
  assert.ok(!html.includes('✗ steps picked</td>'), 'a break of one suite is not listed among the biggest');
  assert.match(html, /300 runner-minutes per caught bug:<\/b> 20 PR e2e runs, 300 min waiting for a runner \+ 300 min running; caught 2 bugs/, 'the PR card counts PR catches only; a night\'s catch is the Testing page\'s');
  assert.ok(!html.includes('a night catch'));
  assert.match(html, /pull\/2123/);
  assert.match(html, /2026-10-24 · PR e2e starts/);
  assert.match(html, /2026-10-26<\/td><td class="num">0% <span class="muted">\(0\/1\)<\/span><\/td><td class="num">90%/);
  const pr = page(snap, {range: '7d', kind: 'pr', now: at});
  assert.match(pr, /12 red suites from 1 break:/, 'the kind filter narrows the causes; the PR box still reads every PR run');
  assert.match(pr, /Last 7 days · PR/);
});

test('Grey shows tolerant and suspended rows, seven observed nights, rates only with a main band, and old snapshot fallback', () => {
  const at = new Date('2026-10-30T12:00:00Z');
  const lanes = {suites: {quality: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: '<unkeyed>'}, paused: {lane: 'suspended', input: 'clock', since: '2026-10-28', why: 'Flip', returns: 'Steady nights'}, gone: {lane: 'retired'}}};
  const suiteNights = Array.from({length: 8}, (_, i) => ({day: `2026-10-${30 - i}`, runId: i + 1, suite: 'quality', platform: 'mac', kind: 'nightly', green: i !== 1, rates: {agree: 0.6}}));
  const html = page({...snapshot, lanes, suiteNights, mainBands: {quality: {agree: {lower: 0.8, upper: 0.95}}}}, {now: at});
  const grey = html.split('<h2>Grey</h2>')[1].split('</section>')[0];
  assert.match(grey, /tolerant.*ai/);
  assert.match(grey, /suspended.*clock/);
  assert.match(grey, /&lt;unkeyed&gt;/);
  assert.match(grey, /2026-10-29.*1 day/);
  assert.match(grey, /no exit condition yet/);
  assert.match(grey, /Steady nights/);
  assert.match(grey, /2026-10-29.*red/);
  assert.match(grey, /2026-10-30.*green/);
  assert.doesNotMatch(grey, /2026-10-23/);
  assert.match(grey, /60%.*main.*80%.*95%/);
  assert.doesNotMatch(grey, /gone/);
  assert.match(grey, /red or green: its one try is the verdict/);
  assert.match(page(snapshot, {now}), /lane registry not read yet/);
  assert.doesNotMatch(page({...snapshot, lanes, suiteNights}, {now: at}).split('<h2>Grey</h2>')[1].split('</section>')[0], /60%/);
});

test('Grey does not add a page scan: the view reads one snapshot row and one collector-start row (both single-row lookups, no table scan)', async () => {
  const {view} = await import('../../../../admin/e2e-page.js');
  const e = env(), reads = [];
  e.STATS.prepare = sql => { reads.push(sql); return {bind: () => ({first: async () => null}), first: async () => ({body: JSON.stringify(snapshot)})}; };
  const response = await view(new Request('https://test/admin/testing/e2e', {headers: {Cookie: 'jp_stats=k3y'}}), e);
  assert.equal(response.status, 200);
  assert.deepEqual(reads, ['SELECT body FROM e2e_snapshot WHERE id = 1', 'SELECT at, ok, reason FROM intel_start WHERE workflow = ?'], 'the second is the red line\'s (1 Nov 2026, admin/intel-start-line.js): one row by its key');
});

test('Speed follows Grey, shows main medians and counts independently of filters, and warns about PR jobs without red', () => {
  const speedRuns = [1, 2, 3].flatMap(runId => [
    {runId, createdAt: '2026-10-17T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'jobs', seconds: 307}]},
    {runId: runId + 10, createdAt: '2026-10-17T12:00:00Z', kind: 'pr', suiteJobs: [{suite: 'interactions', seconds: 481}]}]);
  speedRuns.push({runId: 50, createdAt: '2026-10-17T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'updates', seconds: 7}]});
  const html = page({...snapshot, speedRuns}, {now, kind: 'beta'});
  const speed = html.split('<h2>Speed')[1]?.split('</section>')[0] || '';
  assert.ok(html.indexOf('<h2>Speed') > html.indexOf('<h2>Grey'));
  assert.match(speed, /jobs[^]*5m07s[^]*3 runs/);
  assert.match(speed, /updates[^]*Not enough runs[^]*1 run/);
  assert.match(speed, /PR job budget[^]*10 min/);
  assert.match(speed, /interactions[^]*8m01s[^]*3 runs[^]*class="chip warn">split it/);
  assert.doesNotMatch(speed, /chip bad/);
  assert.match(page(snapshot, {now}), /No suite job timings stored yet/);
});
