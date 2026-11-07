// The Night search tab's day-by-day trend: the nights' own numbers and verdicts, one chart pair per candidate count, a gap for a day with no night.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {nightSection} from '../../../../admin/search-night-page.js';
import {groupHtml, groups, trendSection} from '../../../../admin/search-night-trend.js';

// A stored night: `total` candidates, the first `measured` measured, employer sites out of time for the first `out`, `local` right local jobs per measured candidate.
const night = (day, total, measured, out, local = 3) => ({night: day, run: '1', head: '', rows: Array.from({length: total}, (_, i) => ({persona: i + 1, label: `p${i + 1} Test`, kind: i < measured ? 'measured' : 'unmeasured', local: i < measured ? local : 0, found: 5, seconds: 60, ranOut: i < out ? ['employer sites'] : []}))});
const stored = [night('2026-11-07', 18, 8, 13), night('2026-11-06', 18, 16, 0), night('2026-11-05', 18, 15, 0), night('2026-11-03', 18, 16, 0), night('2026-11-02', 6, 5, 0), night('2026-11-01', 6, 5, 0)];   // 11/04 has no night
const judged = judgeAll(stored);

test('nights are grouped by candidate count, newest count first, each group continuous from its first to its last night', () => {
  const all = groups(judged);
  assert.deepEqual(all.map(item => [item.total, item.current, item.days.length]), [[18, true, 5], [6, false, 2]]);
  assert.equal(all[0].days.find(item => item.day === '2026-11-04').night, null);   // a day with no stored night: a gap
  assert.equal(all[0].days.find(item => item.day === '2026-11-07').night.measured, 8);
});

test('a night with a different candidate count is never drawn in the current set', () => {
  const [current, earlier] = groups(judged);
  assert.ok(current.days.every(item => !item.night || item.night.total === 18));
  assert.ok(earlier.days.every(item => !item.night || item.night.total === 6));
  const html = trendSection(judged);
  assert.match(html, /18 candidates/);
  assert.match(html, /6 candidates/);
  assert.match(html, /an earlier set/);
});

test('the numbers on a point are the night\'s own: found, right local jobs, employer sites in time', () => {
  const html = groupHtml(groups(judged)[0]);
  assert.match(html, /2026-11-07 · found 8 of 18 · right local jobs 24 · employer sites in time 5 of 18/);
  assert.match(html, /2026-11-04 · no night stored/);
});

test('a dropped night is the judge\'s verdict, listed with its reasons; a clean stretch says nothing dropped', () => {
  assert.equal(judged[0].dropped, true);   // 8 of 18 measured is under two thirds
  const html = groupHtml(groups(judged)[0]);
  assert.match(html, /✕ dropped/);
  assert.match(html, /DROPPED: only 8 of 18 measured/);
  assert.match(html, /11\/07/);
  const calm = trendSection(judgeAll([night('2026-11-02', 6, 5, 0), night('2026-11-01', 6, 5, 0)]));
  assert.match(calm, /no night dropped/);
});

test('the tab carries the chart under the band; no night, no chart', () => {
  assert.match(nightSection(judged), /id="night-trend"/);
  assert.match(nightSection(judged), /<svg class="vz-cols"/);
  assert.equal(trendSection([]), '');
  assert.equal(trendSection(null), '');
  assert.doesNotMatch(nightSection([]), /night-trend/);
});

test('a night with no right-jobs count leaves a gap in the jobs line, never a zero', () => {
  const missing = night('2026-11-07', 6, 5, 0); missing.rows.forEach(row => { delete row.local; });
  const html = groupHtml(groups(judgeAll([missing, night('2026-11-06', 6, 5, 0)]))[0]);
  assert.match(html, /right local jobs not counted/);
});

test('the tooltip script is on the tab once, so a point shows its numbers', () => {
  const html = nightSection(judged);
  assert.equal((html.match(/data-tip="2026-11-07 · found 8 of 18/g) || []).length, 2);   // the columns and the line carry the same words
  assert.match(html, /<script>[^<]*data-tip/);
  assert.equal((trendSection(judged).match(/<script>/g) || []).length, 1);
});

test('a count that comes back after another is not drawn as a missing night, and a small jobs axis has whole numbers only', () => {
  const back = judgeAll([night('2026-11-05', 18, 15, 0), night('2026-11-04', 6, 1, 0, 1), night('2026-11-03', 18, 15, 0)]);
  const html = trendSection(back);
  assert.match(html, /2026-11-04 · no night with 18 candidates/);
  assert.doesNotMatch(html, /2026-11-04 · no night stored/);
  const small = groupHtml(groups(judgeAll([night('2026-11-02', 6, 1, 0, 1), night('2026-11-01', 6, 1, 0, 1)]))[0]);
  assert.doesNotMatch(small, />0\.5</);
});

test('a day with no night says so in the legend, never "not reported yet"', () => {
  const html = trendSection(judged);
  assert.match(html, /no night with this number of candidates/);
  assert.doesNotMatch(html, /not reported yet/);
});
