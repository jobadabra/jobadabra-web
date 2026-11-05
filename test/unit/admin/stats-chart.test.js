import assert from 'node:assert/strict';
import {test} from 'node:test';
import {niceTicks, perDayChart, dayWords, fillDays} from '../../../admin/stats-chart.js';
import {page} from '../../../admin/stats.js';

// The owner's screenshot (1 Nov 2026): 7 days, 26 Oct to 1 Nov, visitors and downloaders, across a month change.
const WEEK = [[26, 8, 6], [27, 6, 9], [28, 8, 6], [29, 17, 1], [30, 5, 2], [31, 7, 4], [1, 8, 3]]
  .map(([d, visitors, downloads]) => ({day: d === 1 ? '2026-11-01' : `2026-10-${d}`, visitors, downloads}));

test('the Y axis starts at 0 and reaches the tallest column, with round steps', () => {
  assert.deepEqual(niceTicks(17), [0, 5, 10, 15, 20]);
  assert.deepEqual(niceTicks(1), [0, 1]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(130), [0, 50, 100, 150]);
  const svg = perDayChart(WEEK);
  for (const label of ['>0<', '>5<', '>10<', '>15<', '>20<']) assert.ok(svg.includes(label), `axis label ${label}`);
});

test('every day has a tooltip naming the weekday, the visitors and the downloaders', () => {
  const svg = perDayChart(WEEK);
  assert.equal([...svg.matchAll(/data-tip="/g)].length, 7);
  assert.ok(svg.includes('data-tip="Thu 29 Oct · 17 visitors · 1 downloader"'));
  assert.ok(svg.includes('data-tip="Sun 1 Nov · 8 visitors · 3 downloaders"'));
  assert.equal(dayWords('2026-10-26'), 'Mon 26 Oct');
});

test('a week shows the count above each column; the month shows on its first day', () => {
  const svg = perDayChart(WEEK);
  assert.match(svg, />17<\/text>/, 'the busiest day is labelled');
  assert.match(svg, />1 Nov<\/text>/);
  assert.match(svg, />26 Oct<\/text>/);
});

test('90 days stay readable: no per-column counts, at most ~14 day labels, still a tooltip for every day', () => {
  const days = Array.from({length: 90}, (_, i) => ({day: new Date(Date.UTC(2026, 7, 4 + i)).toISOString().slice(0, 10), visitors: i % 7, downloads: i % 3}));
  const svg = perDayChart(days);
  assert.equal([...svg.matchAll(/data-tip="/g)].length, 90);
  const dayLabels = [...svg.matchAll(/y="222" text-anchor="middle"/g)].length;
  assert.ok(dayLabels <= 16, `${dayLabels} day labels`);
});

test('no day: nothing drawn; the page carries the tooltip box and script', () => {
  assert.equal(perDayChart([]), '');
  const html = page({visits: {}, downloads: {}, perDay: WEEK, buttons: [], platforms: [], dlSources: [], sources: [], countries: [], pages: [], devices: [], days: 7, from: '2026-10-26'}, []);
  assert.match(html, /<svg class="perday"/);
  assert.match(html, /id="tip" role="tooltip"/);
  assert.ok(!html.includes('class="col"'), 'the old title-only columns are gone');
});

test('a day with no traffic is a zero column, so the spacing and the month label stay true', () => {
  const quiet = [{day: '2026-10-30', visitors: 3, downloads: 1}, {day: '2026-11-02', visitors: 4, downloads: 0}];   // 31 Oct and 1 Nov had no traffic at all
  const days = fillDays(quiet, '2026-10-30', '2026-11-02');
  assert.deepEqual(days.map(day => day.day), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(days[1], {day: '2026-10-31', visitors: 0, downloads: 0});
  const svg = perDayChart(days);
  assert.equal([...svg.matchAll(/data-tip="/g)].length, 4);
  assert.ok(svg.includes('data-tip="Sat 31 Oct · 0 visitors · 0 downloaders"'));
  assert.match(svg, />1 Nov<\/text>/, 'the month shows on the 1st even though it had no traffic');
});
