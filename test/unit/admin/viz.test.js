// admin/viz*.js: the admin's one chart module (owner, 5 Nov 2026: tables that are summaries become charts). Every form: rows in, marks out; empty, one row, zero, a hostile label.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {moneyTicks} from '../../../admin/viz-time.js';
import {VIZ_STYLE, bars, columns, figure, meter, meters, split, stacks} from '../../../admin/viz.js';

const count = (html, needle) => html.split(needle).length - 1;

test('bars: one row per item with its exact numbers in the tooltip, scaled to the largest; no items draws nothing', () => {
  const html = bars([{label: 'UI fixer', hint: 'Self-heal', value: 40, text: '$40.00', tip: 'UI fixer · $40.00 · 30 runs'}, {label: 'Scout', value: 10, text: '$10.00'}]);
  assert.equal(count(html, 'class="vz-row"'), 2);
  assert.match(html, /width:100\.0%/); assert.match(html, /width:25\.0%/);
  assert.match(html, /data-tip="UI fixer · \$40\.00 · 30 runs"/, 'a given tooltip is kept');
  assert.match(html, /data-tip="Scout · \$10\.00"/, 'the default tooltip is label and text');
  assert.match(html, /<small>Self-heal<\/small>/);
  assert.equal(bars([]), '');
  assert.match(bars([{label: 'Idle', value: 0, text: '$0.00'}]), /width:0\.0%/, 'all zeros: no division by zero');
});

test('bars: a label with markup is escaped in the text and in the tooltip', () => {
  const html = bars([{label: '<img src=x onerror=alert(1)>', value: 1, text: '"1"'}]);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/); assert.match(html, /&quot;1&quot;/);
});

test('meter: blue under 70%, amber from 70%, red from 90% (the subscription rings\' thresholds), clamped to the track', () => {
  assert.match(meter(69), /background:var\(--s1\)/);
  assert.match(meter(70), /background:var\(--warn\)/);
  assert.match(meter(90), /background:var\(--bad\)/);
  assert.match(meter(250), /width:100\.0%/); assert.match(meter(-5), /width:0\.0%/);
});

test('meters: each row carries every meter with its caption, and its tooltip', () => {
  const html = meters([{label: 'amber0ak', text: '$0.23 today', sub: '$0.99 this month', meters: [{caption: 'Day $', pct: 76}, {caption: 'Month', pct: 33}], tip: 'amber0ak · 76%'}]);
  assert.equal(count(html, 'vz-track thin'), 2); assert.match(html, /Day \$/); assert.match(html, /\$0\.99 this month/); assert.match(html, /data-tip="amber0ak · 76%"/);
  assert.equal(meters([]), '');
});

test('stacks: parts of zero are left out, the legend carries an icon and a word per tone', () => {
  const html = stacks([{label: 'Codex', text: '⛔ used up', sub: '0 ✓ · 436 ⏳ · 0 ✕', parts: [{value: 0, tone: 'good'}, {value: 436, tone: 'warn'}, {value: 0, tone: 'bad'}], tip: 'Codex'}], [['good', '✓ answered'], ['warn', '⏳ ran out']]);
  assert.equal(count(html, 'class="vz-part"'), 1); assert.match(html, /flex:436/); assert.match(html, /✓ answered/); assert.match(html, /⏳ ran out/);
  assert.equal(stacks([]), '');
});

test('split: segments in the order given with fixed colours s1, s2…; the name and amount print only where a segment has room; empty or all-zero draws nothing', () => {
  const html = split([{label: 'Self-heal', value: 70, text: '$70'}, {label: 'Discovery', value: 25, text: '$25'}, {label: 'Tiny', value: 5, text: '$5'}, {label: 'None', value: 0, text: '$0'}]);
  assert.match(html, /background:var\(--s1\)/); assert.match(html, /background:var\(--s2\)/); assert.match(html, /background:var\(--s3\)/); assert.doesNotMatch(html, /--s4/, 'a zero part gets no colour');
  assert.match(html, /<span class="vz-seg"[^>]*><b>Self-heal<\/b><i>\$70<\/i>/); assert.doesNotMatch(html, /<b>Tiny<\/b><i>/);
  assert.match(html, /data-tip="Discovery · \$25 · 25%"/);
  assert.match(split([{label: 'A', value: 1, text: '1'}], {tall: false}), /class="vz-split"/, 'the thin form');
  assert.equal(split([]), ''); assert.equal(split([{label: 'A', value: 0, text: '0'}]), '');
});

test('columns: a Y axis from 0, a column per value per day, a hollow dashed one for a null, a tooltip per day, no days draws nothing', () => {
  const days = [{day: '2026-11-03', values: [5, 6], tip: '3 Nov'}, {day: '2026-11-04', values: [4, null], tip: '4 Nov'}];
  const html = columns(days, [{name: 'Jobs', tone: 's1'}, {name: 'Billed', tone: 's2'}], {unit: '$'});
  assert.match(html, />\$0</); assert.match(html, /vz-grid/);
  assert.equal(count(html, 'fill="var(--s1)"'), 2); assert.equal(count(html, 'fill="var(--s2)"'), 1, 'one billed column; the other is hollow');
  assert.match(html, /stroke-dasharray/); assert.match(html, /data-tip="4 Nov"/); assert.match(html, /not reported yet/);
  assert.doesNotMatch(columns([{day: '2026-11-03', values: [1]}], [{name: 'Jobs', tone: 's1'}], {}), /not reported yet/, 'no hollow column, no legend line for it');
  assert.equal(columns([], [{name: 'Jobs', tone: 's1'}]), '');
  assert.doesNotMatch(columns([{day: '2026-11-03', values: [0, 0], tip: ''}], [{name: 'a', tone: 's1'}, {name: 'b', tone: 's2'}]), /NaN|Infinity/, 'an all-zero day still draws');
});

test('figure: the chart with the original table behind "Show table"; with no chart the table stands alone, never an empty frame; lead chips are escaped', () => {
  const table = '<div class="wrap"><table><tr><td>row</td></tr></table></div>';
  const html = figure({lead: [['<b>x</b>', 'warn'], ['plain']], chart: '<svg></svg>', table});
  assert.match(html, /<details class="vz-more"><summary>Show table<\/summary><div class="wrap"><table>/); assert.doesNotMatch(html, /<details[^>]*open/, 'closed by default');
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/); assert.match(html, /chip warn/);
  assert.equal(figure({chart: '', table}), table);
  assert.doesNotMatch(figure({chart: '<svg></svg>'}), /<details/, 'nothing to open when there is no table');
});

test('the phone rule moves only a row\'s own children: the meters inside a row keep their grid (5 Nov 2026: the three Free AI bars collapsed on a 390 px phone)', () => {
  assert.match(VIZ_STYLE, /\.vz-row>\.vz-two/); assert.doesNotMatch(VIZ_STYLE, /\.vz-row \.vz-track/);
});

test('code review of 5 Nov 2026: cents get a fractional axis, an idle engine draws its empty track, a missing figure is 0 not NaN, zero runs or calls never print Infinity', async () => {
  assert.deepEqual(moneyTicks(0.3), [0, 0.1, 0.2, 0.3], 'a $0.30 day: 10-cent steps, not 0 and 1');
  assert.deepEqual(moneyTicks(8), [0, 2, 4, 6, 8]); assert.deepEqual(moneyTicks(0), [0, 0.5, 1], 'nothing to draw still has a scale');
  assert.match(columns([{day: '2026-11-03', values: [0.3], tip: ''}], [{name: 'Jobs', tone: 's1'}], {unit: '$'}), />\$0\.1</);
  assert.match(stacks([{label: 'Free AI', text: '✅ ready', parts: [{value: 0, tone: 'good'}], tip: 'x'}]), /<span class="vz-track"><\/span>/, 'a row with no calls still has its track');
  assert.doesNotMatch(meter(NaN), /NaN/); assert.match(meter(undefined), /width:0\.0%/);
  const {jobFigure, proFigure} = await import('../../../admin/jobcost-charts.js');
  assert.doesNotMatch(jobFigure({total: 1, jobs: [{job: 'x', usd: 1, runs: 0, calls: 0, last: '2026-11-05T01:00'}]}, {}, ''), /Infinity|NaN/);
  assert.doesNotMatch(proFigure([{action: 'refund', calls: 0, creditEur: 0.1, estimatedUsd: 0.05}], ''), /Infinity|NaN/);
});

test('line: dots on a 0-100% axis, a day with no value breaks the line and has no dot, nothing to draw is empty (owner, 5 Nov 2026: PR e2e cost vs catch)', async () => {
  const {line} = await import('../../../admin/viz.js');
  const html = line([{day: '2026-10-01', value: 100, tip: 'a'}, {day: '2026-10-02', value: null, tip: 'b'}, {day: '2026-10-03', value: 50, tip: 'c'}, {day: '2026-10-04', value: 75, tip: 'd'}], {name: 'Green'});
  assert.match(html, /100%/); assert.equal((html.match(/<circle/g) || []).length, 3, 'a dot for each day with a value'); assert.equal((html.match(/<polyline/g) || []).length, 1, 'the lone first day draws no segment; the gap splits the line');
  assert.match(html, /data-tip="b"/, 'the empty day still has its tooltip');
  assert.equal(line([{day: '2026-10-01', value: null, tip: 'x'}]), '');
});

test('the rows share one set of columns, so every track has the same length (Speed shot, 5 Nov 2026: the budget tick sat 4 px apart)', async () => {
  const {VIZ_STYLE} = await import('../../../admin/viz.js');
  assert.match(VIZ_STYLE, /\.vz-row\{display:grid;grid-template-columns:subgrid/); assert.match(VIZ_STYLE, /\.vz-bars\{display:grid;grid-template-columns:minmax\(110px,200px\) 1fr auto/);
});
