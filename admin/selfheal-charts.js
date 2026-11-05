// The charts of /admin/testing/self-healing (owner, 5 Nov 2026: tables that are summaries become charts): what each detector found and why issues were closed.
// Each takes the table the page drew before and returns one figure (admin/viz.js): the chart, the table behind "Show table". Pure; guard: test/unit/admin/selfheal-charts.test.js.
import {figure, split, stacks} from './viz.js';

const num = value => (Number(value) || 0).toLocaleString('en-US');

/** What the Finder found, one stacked bar per detector: real (fixed, queued) · false or a test mistake · duplicate or stale · unclear. `rows` = a period's byDetector, `totals` its totals; open and unjudged issues are in the tooltip, not in the bar. */
export function finderFigure(rows, totals, table) {
  const items = rows.map(row => {
    const wrong = (row.falsePositive || 0) + (row.harness || 0), old = (row.duplicate || 0) + (row.stale || 0), real = (row.fixed || 0) + (row.queued || 0);
    return {label: row.detector, text: `${num(row.filed)} filed`, sub: `${num(real)} real`,
      parts: [{value: row.fixed || 0, tone: 'good'}, {value: row.queued || 0, tone: 's1'}, {value: wrong, tone: 'bad'}, {value: old, tone: 'warn'}, {value: row.unclear || 0, tone: 'off'}],
      tip: `${row.detector} · filed ${num(row.filed)} · real fixed ${num(row.fixed)} · real queued ${num(row.queued)} · false positives ${num(row.falsePositive)} · test mistakes ${num(row.harness)} · duplicates ${num(row.duplicate)} · stale ${num(row.stale)} · unclear ${num(row.unclear)} · open, unjudged ${num(row.open)}`};
  });
  const real = (totals.fixed || 0) + (totals.queued || 0), wrong = (totals.falsePositive || 0) + (totals.harness || 0);
  return figure({lead: rows.length ? [[`${num(real)} real`, real ? 'good' : 'off'], [`${num(wrong)} wrong`, wrong ? 'bad' : 'off']] : [],
    chart: stacks(items, [['good', 'real, fixed'], ['s1', 'real, queued'], ['bad', 'false or test mistake'], ['warn', 'duplicate or stale'], ['off', 'unclear']]), table});
}

/** Why issues were closed: one segmented bar of the resolution labels, the tail past 5 folded into "Other". `causes` = [[name, count]] biggest first, `words` the label meanings. */
export function resolutionFigure(causes, words, table) {
  const head = causes.slice(0, 5), tail = causes.slice(5).reduce((sum, [, n]) => sum + n, 0), total = causes.reduce((sum, [, n]) => sum + n, 0);
  const parts = [...head.map(([name, n]) => ({label: words[name] || name, value: n, text: num(n)})), ...(tail ? [{label: 'Other', value: tail, text: num(tail)}] : [])];
  return figure({lead: total ? [[`${num(total)} closed with a label`], [`${words[causes[0][0]] || causes[0][0]} is ${Math.round(100 * causes[0][1] / total)}%`]] : [], chart: split(parts, {tall: false}), table});
}
