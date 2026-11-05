// The Testing pages' charts (owner, 5 Nov 2026): /admin/testing/e2e, /integrations and /pr-checks. Every chart keeps the table it replaces behind "Show table".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filesChart, prCostChart, qualityChart, scoreChart, speedFigure, suiteCostFigure, swapTable} from '../../../admin/testing-charts.js';
import {page as e2ePage} from '../../../admin/e2e-page.js';
import {page as integrationPage} from '../../../admin/integration-page.js';
import {page as checksPage} from '../../../admin/pr-checks.js';

const TABLE = '<div class="scroll"><table><tr><th>Suite</th></tr><tr><td>the old table</td></tr></table></div>';

test('swapTable puts the chart in front of the public table and keeps the table behind the toggle; a table it cannot find is left as the public repo draws it', () => {
  const html = `<section>before${TABLE}after</section>`;
  const out = swapTable(html, '<div class="scroll"><table><tr><th>Suite</th>', '<svg>chart</svg>', [['a chip']]);
  assert.match(out, /^<section>before<div class="vz">[\s\S]*<svg>chart<\/svg><details class="vz-more"><summary>Show table<\/summary><div class="scroll"><table>[\s\S]*the old table[\s\S]*<\/details><\/div>after<\/section>$/);
  assert.equal(swapTable(html, '<th>Nope</th>', '<svg/>'), html, 'public markup changed: nothing breaks');
  assert.equal(swapTable(html, '<div class="scroll"><table><tr><th>Suite</th>', ''), html, 'nothing to draw: the table stays');
});

test('How steady the AI is: a stacked bar per night, within / in between / big jumps', () => {
  const html = qualityChart([{day: '2026-11-04', pairs: 24, within8: 20, over20: 2, factsExact: 38, factsTotal: 40, invented: 1, judged: 48}]);
  assert.match(html, /11\/04/); assert.match(html, /20 of 24 within 8/); assert.match(html, /2 big jumps/); assert.match(html, /24 score pairs · 20 within 8 · 2 over 20 apart · facts exact 38\/40 · invented 1\/48/); assert.match(html, /over 20 apart/);
});

test('Speed: a range per suite against the PR job budget; suites without a median stay in the table; verdict chips say how many are over', () => {
  const rows = [{suite: 'apply', median: 600, p25: 500, p95: 700, n: 5}, {suite: 'jobs', median: 120, p25: 100, p95: 150, n: 4}, {suite: 'new', median: null, p25: null, p95: null, n: 1}];
  const html = speedFigure(rows, TABLE, {budgetSeconds: 480});
  assert.match(html, /2 suites timed/); assert.match(html, /1 median over the budget/); assert.match(html, /PR job budget 8 min/); assert.doesNotMatch(html, /new · median/); assert.match(html, /the old table/);
  assert.match(speedFigure([rows[1]], TABLE, {budgetSeconds: 480}), /all medians within the budget/);
});

test('Which suites cost the most: ten bars of job time, the causes in the tooltip, the total in the lead; no suites is the table alone', () => {
  const rows = Array.from({length: 12}, (_, i) => ({suite: `s${i}`, platform: i ? 'mac' : 'windows', n: 2, min: 600 - i * 10, causes: {flake: 1, test: 1}}));
  const html = suiteCostFigure(rows, TABLE, id => id.toUpperCase());
  assert.equal((html.match(/class="vz-row"/g) || []).length, 10); assert.match(html, /s0 \(Windows\) · 2 red · 10 h · FLAKE 1, TEST 1/); assert.match(html, /12 suites/);
  assert.equal(suiteCostFigure([], TABLE, id => id), TABLE);
});

test('Scorecard: a stacked bar per suite with the five outcomes; the legend names each by word', () => {
  const html = scoreChart([{suite: 'apply', caught: 2, missed: 1, noise: 3, ours: 0, unnamed: 1, min: 90}]);
  assert.match(html, /apply · caught a bug 2 · missed 1 · test noise 3 · our CI and AI 0 · not named 1 · 1\.5 h job time/); assert.match(html, /missed \(escaped\)/); assert.equal(scoreChart([]), '');
});

test('PR e2e cost vs catch: a line of main\'s green share, then columns of PR minutes (two charts, no second axis)', () => {
  const html = prCostChart([{day: '2026-11-03', full: [2, 2], merge: [3, 3], prMin: 60}, {day: '2026-11-02', full: [1, 2], merge: [3, 3], prMin: 80}, {day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 0}]);
  assert.match(html, /<polyline/); assert.match(html, /vz-cols/); assert.match(html, /full runs green 50% \(1\/2\) · after-merge steps green 100% \(3\/3\)/); assert.match(html, /PR e2e 80 min/); assert.match(html, /none ran/);
  assert.equal(prCostChart([{day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 0}]), '');
});

test('Changed most this week: bars of commits per file', () => {
  assert.match(filesChart([{file: 'tools/ship.sh', commits: 4}]), /tools\/ship\.sh[\s\S]*4 commits/);
});

const now = new Date('2026-10-18T12:00:00Z');
test('the E2E page: every converted card still holds its table behind the toggle, and carries the style and one tooltip', () => {
  const snapshot = {schema: 2, at: '2026-10-18T11:41:00Z', days: [{day: '2026-10-17', kind: 'pr', runs: 4, greens: 3, reds: 1, queueMin: 20, runMin: 40}, {day: '2026-10-17', kind: 'nightly', runs: 1, greens: 1, reds: 0}],
    fails: [{day: '2026-10-17', kind: 'nightly', suite: 'apply', platform: 'mac', cause: 'product', n: 2, min: 24}], caught: [], escapes: [{week: '2026-10-12', sha: 'abc', journey: 'j', suites: ['jobs'], none: false}],
    work: [{day: '2026-10-17', kind: 'plumbing', commits: 3}], workFiles: [{week: '2026-10-12', file: 'tools/ship.sh', commits: 3}], latest: [],
    quality: [{day: '2026-10-17', runId: 1, pairs: 24, within8: 22, over20: 0, factsExact: 39, factsTotal: 40, invented: 0, judged: 48}],
    speedRuns: [1, 2, 3].map(runId => ({runId, createdAt: '2026-10-16T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'apply', seconds: 100 * runId}]}))};
  const html = e2ePage(snapshot, {now});
  for (const title of ['How steady the AI is', 'Speed · last 30 days', 'Which suites cost the most', 'Scorecard: which suites catch bugs', 'PR e2e: cost vs catch']) {
    const at = html.indexOf(title), next = html.indexOf('<h2', at + 1), end = next < 0 ? html.length : next; assert.ok(at > 0, title);   // a card holds tiles with their own </section>: its end is the next card's title
    assert.match(html.slice(at, end), /class="vz"/, `${title} is a chart`); assert.match(html.slice(at, end), /<details class="vz-more">[\s\S]*<table>/, `${title} keeps its table`);
  }
  assert.equal(html.split('id="tip"').length - 1, 1, 'one tooltip'); assert.match(html, /\.vz\{/);
});

test('The three layers, Slowest 10 and the PR checks card are charts that keep their tables', () => {
  const snapshot = {schema: 1, at: '2026-10-18T11:41:00Z', counts: {app: {tests: 118, files: 16}, store: {tests: 41, files: 6}, extension: {tests: 64, files: 9}}, flaky: [], runs: [{runId: 1, layer: 'app', platform: 'linux', day: '2026-10-17', on: 'main', sha: 'abc1234', conclusion: 'success', tests: 118, failed: 0, ms: 4000}],
    slowest: [{layer: 'app', test: 'slow one', file: 'integration/app/s.test.js', ms: 9400}, {layer: 'store', test: 'fast one', file: 'integration/store/f.test.mjs', ms: 90}], move: {days: []}};
  const html = integrationPage(snapshot, {now});
  for (const title of ['The three layers', 'Slowest 10 tests']) { const at = html.indexOf(title), end = html.indexOf('</section>', at); assert.match(html.slice(at, end), /class="vz"/, title); assert.match(html.slice(at, end), /<details class="vz-more">[\s\S]*<table>/, title); }
  assert.match(html, /App 100% green/); assert.match(html, /1 over 5 s/); assert.equal(html.split('id="tip"').length - 1, 1);
  const card = JSON.stringify({days: 30, checks: [{name: 'CI · Unit', runs: 80, reds: 5, realCatches: 3, falseReds: 1, medianMin: 5, p90Min: 9, addedMin: 2, verdict: 'proven'}, {name: 'CI · Audit', runs: 40, reds: 2, realCatches: 0, falseReds: 2, medianMin: 6, p90Min: 14, addedMin: 5, verdict: 'review'}]});
  const checks = checksPage([{month: '2026-10', card}]);
  assert.match(checks, /🟢 1 proven/); assert.match(checks, /🟡 1 to review/); assert.match(checks, /3 catches · 1 false/); assert.match(checks, /p90 14 min/); assert.match(checks, /<details class="vz-more">[\s\S]*<table>/); assert.equal(checks.split('id="tip"').length - 1, 1);
});

test('code review of 5 Nov 2026: a caption never sits over a chart that was not drawn', async () => {
  assert.equal(prCostChart([{day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 30}]).includes("Main's full runs"), false, 'no main run: no green-share caption');
  assert.match(prCostChart([{day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 30}]), /PR e2e minutes per day/);
  const shares = prCostChart([{day: '2026-11-02', full: [1, 2], merge: [0, 0], prMin: 0}, {day: '2026-11-01', full: [2, 2], merge: [0, 0], prMin: 0}]);
  assert.match(shares, /full runs that ended green/); assert.doesNotMatch(shares, /PR e2e minutes per day/, 'no PR minutes: no empty 0 / 0.5 / 1 axis');
  assert.doesNotMatch(checksPage([{month: '2026-10', card: JSON.stringify({days: 30, checks: []})}]), /How long each check/);
});
