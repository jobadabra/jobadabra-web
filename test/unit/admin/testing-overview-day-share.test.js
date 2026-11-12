// Testing → Overview's day cell: green only above 98% green runs, amber from 80% to 98%, red below 80%; one run keeps green/red; cancelled runs do not count
// (owner, 12 Nov 2026: "why is always red in Admin" → "Share of green runs", "Let it be green only if bigger than 98%"; amber bounds 80/98 are the coordinator's proposal).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dayShare, historyOf} from '../../../admin/testing-overview-history.js';
import {cellHtml, healthMap} from '../../../admin/testing-overview-map.js';

const now = new Date('2026-11-01T12:00:00Z'), repo = 'GarryOne/jobadabra';
const e2e = (...days) => ({repo, now, e2e: {at: '2026-11-01T08:00:00Z', days: days.map(([day, greens, reds]) => ({day, kind: 'after-merge', runs: greens + reds, greens, reds}))}});
const line = [{label: 'E2E', last: {e2e: ['after-merge']}}];
const cellOf = (greens, reds) => historyOf(e2e(['2026-10-31', greens, reds]), line).at(-2);

test('one rule for every row: >98% green, 80–98% amber, below 80% red', () => {
  assert.equal(dayShare(39, 2).state, 'amber');   // 95%
  assert.equal(dayShare(99, 1).state, 'green');   // 99%
  assert.equal(dayShare(98, 2).state, 'amber', '98% exactly is not "bigger than 98%"');
  assert.equal(dayShare(80, 20).state, 'amber', '80% exactly is amber');
  assert.equal(dayShare(30, 10).state, 'red');    // 75%
  assert.equal(dayShare(5, 5).state, 'red');
  assert.equal(dayShare(40, 0).state, 'green');
  assert.equal(dayShare(0, 3).state, 'red');
});

test('a day with one run keeps green or red; no run stays none', () => {
  assert.equal(dayShare(1, 0).state, 'green');
  assert.equal(dayShare(0, 1).state, 'red');
  assert.equal(dayShare(0, 0).state, 'none');
});

test('the map cell: 39 green + 2 red reads amber with its share in the tooltip', () => {
  const cell = cellOf(39, 2);
  assert.equal(cell.state, 'amber');
  const html = cellHtml(cell);
  assert.match(html, /c-amber/);
  assert.match(html, /title="Sat 31 Oct · 39 green · 2 red \(95%\)"/);
  assert.match(html, /aria-label="Sat 31 Oct · 39 green · 2 red \(95%\)"/);
  assert.match(html, />!</, 'amber has a glyph, never colour alone');
  assert.equal(cellOf(99, 1).state, 'green');
  assert.equal(cellOf(30, 10).state, 'red');
  assert.match(cellHtml(cellOf(30, 10)), /30 green · 10 red \(75%\)/);
  assert.match(cellHtml(cellOf(1, 0)), /title="Sat 31 Oct · 1 green run"/);
  assert.match(cellHtml(cellOf(0, 1)), /title="Sat 31 Oct · 1 red run"/);
});

test('the share is shown with a decimal only where a whole number would blur the 98% / 80% line', () => {
  assert.match(cellHtml(cellOf(197, 4)), /\(98\.0%\)/);   // 97.99 → would read "98%" and be amber
  assert.match(cellHtml(cellOf(100, 1)), /\(99%\)/);
});

test('a cancelled run is not a run: it changes neither state nor share', () => {
  const job = recent => ({repo, file: 'mutation.yml', name: 'x', about: '', crons: [], source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
  const run = (conclusion, h) => ({at: `2026-11-01T0${h}:00:00Z`, conclusion, mins: 1, url: `https://github.com/${repo}/actions/runs/${h}`});
  const cells = historyOf({repo, now, schedules: {at: '2026-11-01T10:00:00Z', jobs: [job([run('cancelled', 5), run('success', 4), run('cancelled', 3), run('success', 2)])]}}, [{label: 'x', wf: 'mutation.yml'}]);
  assert.equal(cells.at(-1).state, 'green');
  assert.equal(cells.at(-1).greens, 2);
  assert.equal(cells.at(-1).reds, 0);
});

test('click a cell: the newest red run of the day, else the newest run', () => {
  const job = recent => ({repo, file: 'mutation.yml', name: 'x', about: '', crons: [], source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
  const run = (conclusion, h) => ({at: `2026-11-01T0${h}:00:00Z`, conclusion, mins: 1, url: `https://github.com/${repo}/actions/runs/${h}`});
  const of = recent => historyOf({repo, now, schedules: {at: '2026-11-01T10:00:00Z', jobs: [job(recent)]}}, [{label: 'x', wf: 'mutation.yml'}]).at(-1);
  const amber = of([run('success', 9), run('failure', 8), run('failure', 7), ...Array.from({length: 40}, (_, i) => run('success', 1))]);
  assert.equal(amber.state, 'amber');
  assert.ok(amber.url.endsWith('/runs/8'), 'newest red run');
  assert.ok(of([run('success', 9), run('success', 8)]).url.endsWith('/runs/9'), 'no red: the newest run');
});

test('the legend states the rule and has an amber key with icon + word', () => {
  const html = healthMap({rings: []}, ['2026-10-31', '2026-11-01']);
  assert.doesNotMatch(html, /counts red/);
  assert.match(html, /<i class="c c-amber">!<\/i>some red/);
  assert.match(html, /green above 98%/);
  assert.match(html, /red below 80%/);
});
