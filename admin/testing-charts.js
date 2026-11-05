// The charts of /admin/testing/e2e (owner, 5 Nov 2026: "transform [the tables] into a more visual representation. Preferably graphs"; lookups stay): the AI's steadiness per night, the speed
// range per suite, the costliest suites, the scorecard, PR e2e's cost against its catch, the files that take the commits. Each returns a figure: the chart with the table it replaces behind "Show table".
// Some cards are drawn by the public repo's tools/ci-intel/lib (admin/e2e-top.js, e2e-scorecard.js re-export them; "private reads public, never the reverse"): for those, `swapTable` finds the
// public table in the card's HTML and puts it behind the chart; if the public markup ever changes, the card stays exactly as the public repo draws it (a test here fails, nothing breaks on the page).
// Pure; guard: test/unit/admin/testing-charts.test.js. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md.
import {bars, columns, figure, line, ranges, stacks} from './viz.js';
import {speedTime} from './e2e-speed.js';

const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const hours = minutes => `${((Number(minutes) || 0) / 60).toLocaleString('en-US', {maximumFractionDigits: 1})} h`;

/**
 * Put `chart` in front of the public table that starts with `start` (up to its `</table></div>`), the table behind "Show table". Not found: `html` unchanged.
 * Why (owner, 5 Nov 2026): the public cards cannot change from here, so this wraps what they draw instead of copying their data code.
 */
export function swapTable(html, start, chart, lead = []) {
  const at = html.indexOf(start), end = at < 0 ? -1 : html.indexOf('</table></div>', at);
  if (end < 0 || !chart) return html;
  const stop = end + '</table></div>'.length;
  return html.slice(0, at) + figure({lead, chart, table: html.slice(at, stop)}) + html.slice(stop);
}

/** How steady the AI is: one stacked bar per night of its score pairs, same score twice (within the bar) · in between · big jumps. `nights` newest first; the page puts the table (run links, facts) behind it. */
export function qualityChart(nights, {within = 8, jump = 20} = {}) {
  const rows = nights.slice(0, 14).map(night => {
    const pairs = Number(night.pairs) || 0, steady = Number(night.within8) || 0, big = Number(night.over20) || 0;
    return {label: night.day.slice(5).replace('-', '/'), text: `${steady} of ${pairs} within ${within}`, sub: night.over20 ? `${big} big ${big === 1 ? 'jump' : 'jumps'}` : undefined,
      parts: [{value: steady, tone: 'good'}, {value: Math.max(0, pairs - steady - big), tone: 'warn'}, {value: big, tone: 'bad'}],
      tip: `${night.day} · ${pairs} score pairs · ${steady} within ${within} · ${big} over ${jump} apart · facts exact ${night.factsExact}/${night.factsTotal} · invented ${night.invented}/${night.judged}`};
  });
  return stacks(rows, [['good', `within ${within}`], ['warn', 'in between'], ['bad', `over ${jump} apart`]]);
}

/** Speed of the suites on main: a whisker from the 25th to the 95th percentile, a dot at the median, one tick at the PR job budget. `rows` = speedSummary().main; those without a median stay in the table. */
export function speedFigure(rows, table, {budgetSeconds}) {
  const items = rows.filter(row => row.median !== null).map(row => ({label: row.suite, hint: `${row.n} runs`, low: row.p25, mid: row.median, high: row.p95, text: speedTime(row.median),
    tip: `${row.suite} · median ${speedTime(row.median)} · p25 ${speedTime(row.p25)} to p95 ${speedTime(row.p95)} · ${row.n} runs`}));
  const over = items.filter(item => item.mid > budgetSeconds).length;
  return figure({lead: items.length ? [[`${items.length} suites timed`], over ? [`${over} median over the budget`, 'warn'] : ['all medians within the budget', 'good']] : [],
    chart: ranges(items, {limit: {value: budgetSeconds, words: `PR job budget ${budgetSeconds / 60} min`}}), table});
}

/** Which suites cost the most: bars of red job time, the causes in the tooltip. `rows` = suiteRows(w) (already costliest first), `label(id)` names a cause. Ten bars; the table holds every suite. */
export function suiteCostFigure(rows, table, label) {
  const shown = rows.slice(0, 10), total = rows.reduce((sum, row) => sum + row.min, 0);
  return figure({lead: rows.length ? [[`${hours(total)} in red suites`], [`${rows.length} suites`]] : [],
    chart: bars(shown.map(row => ({label: row.suite, hint: `${row.platform === 'windows' ? 'Windows' : 'Mac + Linux'} · ${num(row.n)} red`, value: row.min, text: hours(row.min),
      tip: `${row.suite} (${row.platform === 'windows' ? 'Windows' : 'Mac + Linux'}) · ${num(row.n)} red · ${hours(row.min)} · ${Object.entries(row.causes).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${label(id)} ${n}`).join(', ')}`}))), table});
}

/** The scorecard: one stacked bar per suite, caught a bug · missed · test noise · our CI and AI · not named. `rows` = scoreRows(); the public card's table goes behind the toggle. */
export function scoreChart(rows) {
  if (!rows.length) return '';
  return stacks(rows.slice(0, 12).map(row => ({label: row.suite, text: `${row.caught} caught`, sub: row.missed ? `${row.missed} missed` : undefined,
    parts: [{value: row.caught, tone: 'good'}, {value: row.missed, tone: 'bad'}, {value: row.noise, tone: 'warn'}, {value: row.ours, tone: 's6'}, {value: row.unnamed, tone: 'off'}],
    tip: `${row.suite} · caught a bug ${row.caught} · missed ${row.missed} · test noise ${row.noise} · our CI and AI ${row.ours} · not named ${row.unnamed} · ${hours(row.min)} job time`})),
  [['good', 'caught a bug'], ['bad', 'missed (escaped)'], ['warn', 'test noise'], ['s6', 'our CI and AI'], ['off', 'not named']]);
}

/** PR e2e's cost against its catch: the green share of main per day (a line) above PR e2e's waiting and running minutes per day (columns): two scales, two charts. `green` = summary(w).green, newest first. */
export function prCostChart(green) {
  const days = green.slice().reverse(), share = ([greens, runs]) => (runs ? Math.round((100 * greens) / runs) : null);
  const points = days.map(row => ({day: row.day, value: share(row.full), tip: `${row.day} · full runs green ${row.full[1] ? `${share(row.full)}% (${row.full[0]}/${row.full[1]})` : 'none ran'} · after-merge steps green ${row.merge[1] ? `${share(row.merge)}% (${row.merge[0]}/${row.merge[1]})` : 'none ran'}`}));
  const minutes = days.map(row => ({day: row.day, values: [row.prMin || 0], tip: `${row.day} · PR e2e ${num(row.prMin)} min (waiting for a runner + running)`}));
  if (!points.some(point => point.value !== null) && !minutes.some(day => day.values[0])) return '';
  return `<p class="muted vz-cap2">Main's full runs that ended green, per day</p>${line(points, {tone: 's1', name: "Main's green share"})}`
    + `<p class="muted vz-cap2">PR e2e minutes per day</p>${columns(minutes, [{name: 'PR e2e minutes', tone: 's2'}])}`;
}

/** The e2e and CI files that changed most this week as bars of commits. `files` = [{file, commits}]. */
export function filesChart(files) {
  return bars(files.map(row => ({label: row.file, value: Number(row.commits) || 0, text: `${Number(row.commits) || 0} commits`})));
}
