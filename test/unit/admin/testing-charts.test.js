// The Testing pages' charts (owner, 5 Nov 2026): /admin/testing/e2e, /integrations and /pr-checks. Every chart keeps the table it replaces behind "Show table".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filesChart, prCostChart, swapTable} from '../../../admin/testing-charts.js';
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

test('PR e2e cost vs catch: a line of main\'s green share, then columns of PR minutes (two charts, no second axis)', () => {
  const html = prCostChart([{day: '2026-11-03', full: [2, 2], merge: [3, 3], prMin: 60}, {day: '2026-11-02', full: [1, 2], merge: [3, 3], prMin: 80}, {day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 0}]);
  assert.match(html, /<polyline/); assert.match(html, /vz-cols/); assert.match(html, /full runs green 50% \(1\/2\) · after-merge steps green 100% \(3\/3\)/); assert.match(html, /PR e2e 80 min/); assert.match(html, /none ran/);
  assert.equal(prCostChart([{day: '2026-11-01', full: [0, 0], merge: [0, 0], prMin: 0}]), '');
});

test('Changed most this week: bars of commits per file', () => {
  assert.match(filesChart([{file: 'tools/ship.sh', commits: 4}]), /tools\/ship\.sh[\s\S]*4 commits/);
});

const now = new Date('2026-10-18T12:00:00Z');
test('the E2E page: PR cost vs catch is a chart that keeps its table; the colour-coded cards are untouched; one tooltip', () => {
  const snapshot = {schema: 2, at: '2026-10-18T11:41:00Z', days: [{day: '2026-10-17', kind: 'pr', runs: 4, greens: 3, reds: 1, queueMin: 20, runMin: 40}, {day: '2026-10-17', kind: 'nightly', runs: 1, greens: 1, reds: 0}],
    fails: [{day: '2026-10-17', kind: 'nightly', suite: 'apply', platform: 'mac', cause: 'product', n: 2, min: 24}], caught: [], escapes: [{week: '2026-10-12', sha: 'abc', journey: 'j', suites: ['jobs'], none: false}],
    work: [{day: '2026-10-17', kind: 'plumbing', commits: 3}], workFiles: [{week: '2026-10-12', file: 'tools/ship.sh', commits: 3}], latest: [],
    quality: [{day: '2026-10-17', runId: 1, pairs: 24, within8: 22, over20: 0, factsExact: 39, factsTotal: 40, invented: 0, judged: 48}],
    speedRuns: [1, 2, 3].map(runId => ({runId, createdAt: '2026-10-16T12:00:00Z', kind: 'scheduled', suiteJobs: [{suite: 'apply', seconds: 100 * runId}]}))};
  const html = e2ePage(snapshot, {now});
  for (const title of ['PR e2e: cost vs catch']) {
    const at = html.indexOf(title), next = html.indexOf('<h2', at + 1), end = next < 0 ? html.length : next; assert.ok(at > 0, title);   // a card holds tiles with their own </section>: its end is the next card's title
    assert.match(html.slice(at, end), /class="vz"/, `${title} is a chart`); assert.match(html.slice(at, end), /<details class="vz-more">[\s\S]*<table>/, `${title} keeps its table`);
  }
  assert.equal(html.split('id="tip"').length - 1, 1, 'one tooltip'); assert.match(html, /\.vz\{/);
});

test('Slowest 10 and the PR checks card are charts that keep their tables', () => {
  const snapshot = {schema: 1, at: '2026-10-18T11:41:00Z', counts: {app: {tests: 118, files: 16}, store: {tests: 41, files: 6}, extension: {tests: 64, files: 9}}, flaky: [], runs: [{runId: 1, layer: 'app', platform: 'linux', day: '2026-10-17', on: 'main', sha: 'abc1234', conclusion: 'success', tests: 118, failed: 0, ms: 4000}],
    slowest: [{layer: 'app', test: 'slow one', file: 'integration/app/s.test.js', ms: 9400}, {layer: 'store', test: 'fast one', file: 'integration/store/f.test.mjs', ms: 90}], move: {days: []}};
  const html = integrationPage(snapshot, {now});
  for (const title of ['Slowest 10 tests']) { const at = html.indexOf(title), end = html.indexOf('</section>', at); assert.match(html.slice(at, end), /class="vz"/, title); assert.match(html.slice(at, end), /<details class="vz-more">[\s\S]*<table>/, title); }
  assert.match(html, /1 over 5 s/); assert.equal(html.split('id="tip"').length - 1, 1);
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
