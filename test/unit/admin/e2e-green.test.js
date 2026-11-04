// The green share per day on /admin/testing/e2e (owner, 31 Oct 2026): pure numbers from the snapshot's day rows, kinds grouped, cancelled runs out, empty days a gap.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {greenCard, greenPerDay, greenTrend, seriesFor, shareOf} from '../../../admin/e2e-green.js';
import {page} from '../../../admin/e2e-page.js';

const now = new Date('2026-10-31T12:00:00Z');
const row = (day, kind, greens, reds, cancelled = 0) => ({day, kind, runs: greens + reds, greens, reds, cancelled, redMin: 0});
const snapshot = {schema: 2, at: '2026-10-31T11:41:00Z', days: [
  row('2026-10-31', 'after-merge', 5, 1), row('2026-10-30', 'after-merge', 7, 2),            // last 2 days: 12 of 15 = 80%
  row('2026-10-29', 'after-merge', 6, 2), row('2026-10-28', 'after-merge', 1, 7, 4),          // before: 7 of 16 = 44% (4 cancelled are not runs)
  row('2026-10-31', 'nightly', 1, 1), row('2026-10-31', 'scheduled', 1, 0), row('2026-10-30', 'pr', 0, 3),
  row('2026-10-29', 'beta', 0, 0, 5)],                                                         // only cancelled: no finished run
  fails: [], latest: []};

test('a day\'s share counts finished runs only: cancelled runs are in neither side', () => {
  assert.deepEqual(shareOf(snapshot.days, ['after-merge'], new Set(['2026-10-28'])), {runs: 8, greens: 1, share: 1 / 8});
  assert.deepEqual(shareOf(snapshot.days, ['beta'], new Set(['2026-10-29'])), {runs: 0, greens: 0, share: null}, 'five cancelled betas and nothing else = no share, not 0%');
});

test('nightly and scheduled are one line; each kind keeps its own; a day with no run is a gap, not 0%', () => {
  const data = greenPerDay(snapshot, {days: 7, now});
  assert.deepEqual(data.keys, ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  assert.deepEqual(data.series.map(series => series.id), ['after-merge', 'beta', 'pr', 'nightly']);
  const byId = Object.fromEntries(data.series.map(series => [series.id, series.points]));
  assert.deepEqual([byId.nightly[6].runs, byId.nightly[6].greens, byId.nightly[6].share], [3, 2, 2 / 3], 'nightly 1/2 + scheduled 1/1');
  assert.equal(byId.pr[5].share, 0, 'three red PR runs = 0% (a real zero)');
  assert.equal(byId.pr[4].share, null, 'no PR run that day = a gap');
  assert.equal(byId['after-merge'][0].share, null, 'a day before any row');
});

test('the filter keeps one line for that kind', () => {
  assert.deepEqual(greenPerDay(snapshot, {kind: 'after-merge', now}).series.map(series => series.id), ['after-merge']);
  assert.deepEqual(seriesFor('scheduled', id => `Name ${id}`).map(series => [series.id, series.label, series.kinds]), [['scheduled', 'Name scheduled', ['scheduled']]]);
  assert.deepEqual(seriesFor('nightly').map(series => series.kinds), [['nightly']], 'the nightly filter shows nightly alone');
});

test('last 2 days against the 7 days before: up, down, flat and no comparison', () => {
  const up = greenTrend(snapshot, {now});
  assert.deepEqual([up.series.id, up.recent.greens, up.recent.runs, up.before.greens, up.before.runs, up.delta, up.trend], ['after-merge', 12, 15, 7, 16, 36, 'up'], '80% vs 43.75%');
  assert.equal(greenTrend({days: [row('2026-10-31', 'pr', 1, 1), row('2026-10-25', 'pr', 5, 5)]}, {kind: 'pr', now}).trend, 'flat');
  assert.equal(greenTrend({days: [row('2026-10-31', 'pr', 0, 4), row('2026-10-25', 'pr', 5, 5)]}, {kind: 'pr', now}).trend, 'down');
  assert.equal(greenTrend({days: [row('2026-10-25', 'pr', 5, 5)]}, {kind: 'pr', now}).trend, null, 'nothing in the last 2 days: no arrow');
  assert.equal(greenTrend(null, {now}).trend, null);
});

test('the card: tiles with the chip, a dot per day with its run count on hover, the numbers table; empty says so', () => {
  const html = greenCard(snapshot, {days: 7, now, scopeName: 'Last 7 days'});
  assert.match(html, /Green runs per day · Last 7 days/);
  assert.match(html, /Main after merge · last 2 days green<\/span><b>80%<span class="chip good">▲ \+36 pts/);
  assert.match(html, /<title>Main after merge · 31 Oct: 83% green \(5 of 6 runs\)<\/title>/);
  assert.match(html, /Nightly \/ scheduled/);
  assert.match(html, /<details class="gnum">/);
  assert.match(greenCard({days: []}, {now, scopeName: 'Last 7 days'}), /No finished run in this range/);
});

test('the page puts the card above the red-run tiles and honours the kind filter', () => {
  const all = page(snapshot, {range: '7d', now}), pr = page(snapshot, {range: '7d', kind: 'pr', now});
  assert.ok(all.indexOf('Green runs per day') > 0 && all.indexOf('Green runs per day') < all.indexOf('class="tiles"'), 'the card sits before the first tiles');
  assert.match(all, /Green runs per day · Last 7 days<\/h2>/);
  assert.match(pr, /Green runs per day · Last 7 days · PR<\/h2>/);
  assert.doesNotMatch(pr.slice(pr.indexOf('Green runs per day'), pr.indexOf('Green runs per day') + 6000), /Main after merge · 31 Oct/, 'a PR filter draws the PR line only');
});
