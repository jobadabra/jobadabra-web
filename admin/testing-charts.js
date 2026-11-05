// The charts of /admin/testing/e2e (owner, 5 Nov 2026: "transform [the tables] into a more visual representation. Preferably graphs"; lookups stay): the AI's steadiness per night, the costliest
// suites, PR e2e's cost against its catch, the files that take the commits. Each returns a figure: the chart with the table it replaces behind "Show table".
// Some cards are drawn by the public repo's tools/ci-intel/lib (admin/e2e-top.js, e2e-scorecard.js re-export them; "private reads public, never the reverse"): for those, `swapTable` finds the
// public table in the card's HTML and puts it behind the chart; if the public markup ever changes, the card stays exactly as the public repo draws it (a test here fails, nothing breaks on the page).
// Pure; guard: test/unit/admin/testing-charts.test.js. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md.
import {bars, columns, figure, line} from './viz.js';

const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});

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

/** PR e2e's cost against its catch: the green share of main per day (a line) above PR e2e's waiting and running minutes per day (columns): two scales, two charts. `green` = summary(w).green, newest first. */
export function prCostChart(green) {
  const days = green.slice().reverse(), share = ([greens, runs]) => (runs ? Math.round((100 * greens) / runs) : null);
  const points = days.map(row => ({day: row.day, value: share(row.full), tip: `${row.day} · full runs green ${row.full[1] ? `${share(row.full)}% (${row.full[0]}/${row.full[1]})` : 'none ran'} · after-merge steps green ${row.merge[1] ? `${share(row.merge)}% (${row.merge[0]}/${row.merge[1]})` : 'none ran'}`}));
  const minutes = days.map(row => ({day: row.day, values: [row.prMin || 0], tip: `${row.day} · PR e2e ${num(row.prMin)} min (waiting for a runner + running)`}));
  // Why (code review, 5 Nov 2026): a caption only goes with a chart that was drawn; days with no main run, or none with PR minutes, leave that half out.
  const share_ = line(points, {tone: 's1', name: "Main's green share"}), cost = minutes.some(day => day.values[0]) ? columns(minutes, [{name: 'PR e2e minutes', tone: 's2'}]) : '';
  return (share_ ? `<p class="muted vz-cap2">Main's full runs that ended green, per day</p>${share_}` : '') + (cost ? `<p class="muted vz-cap2">PR e2e minutes per day</p>${cost}` : '');
}

/** The e2e and CI files that changed most this week as bars of commits. `files` = [{file, commits}]. */
export function filesChart(files) {
  return bars(files.map(row => ({label: row.file, value: Number(row.commits) || 0, text: `${Number(row.commits) || 0} commits`})));
}
