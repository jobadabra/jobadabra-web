// The charts of /admin/job-search/benchmark (Tech and non-tech) and /admin/job-search/scouting (owner, 5 Nov 2026: "transform [the tables] into a more visual representation. Preferably graphs";
// only plain tables of numbers become charts; the heat tables, lookups and logs stay). Each returns the chart only; the page puts the table it replaces behind "Show table" with `figure`.
// Pure; guard: test/unit/admin/jobsearch-charts.test.js. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md.
import {bars} from './viz.js';

const num = value => (Number(value) || 0).toLocaleString('en-US');
const group = (title, chart) => (chart ? `<p class="muted vz-cap2">${title}</p>${chart}` : '');

/** Tech and non-tech: relevant jobs per tool as the share of what it showed, one bar chart per kind of role. view = {tools: [{tool, ours}], kinds: {tech: {tool: {relevant, relevantShare}}, 'non-tech': {…}}}. */
export function kindsChart(view) {
  const of = kind => bars(view.tools.filter(tool => view.kinds?.[kind]?.[tool.tool]).map(tool => { const x = view.kinds[kind][tool.tool], share = Number(x.relevantShare);
    return {label: tool.tool, hint: tool.ours && !/ours/i.test(tool.tool) ? 'ours' : '', value: share || 0, text: x.relevantShare == null ? '–' : `${share}%`, tip: `${tool.tool} · ${kind} · ${num(x.relevant)} relevant jobs${x.relevantShare == null ? '' : ` · ${share}% of the jobs shown`}`}; }), {max: 100});
  return group('Tech roles: relevant share of the jobs shown', of('tech')) + group('Non-tech roles: relevant share of the jobs shown', of('non-tech'));
}

/** Employers per kind of role (the "All" column), the split by region in the tooltip. kinds = {kind: count}, grid = {'kind|region': count}. */
export function employerKindChart(kinds, grid, regions) {
  return bars(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({label: kind, value: count, text: num(count),
    tip: `${kind} · ${num(count)} employers${regions.filter(region => grid[`${kind}|${region}`]).map(region => ` · ${region} ${num(grid[`${kind}|${region}`])}`).join('')}`})));
}

/** Shared by installs, per AI family: one small bar chart per measure (the measures have different scales), a bar per family. families = {claude|openai|unknown: {sharing7, shared, dead, boardsMatched}}. */
export function familyChart(families) {
  const names = [['claude', 'Claude'], ['openai', 'OpenAI'], ['unknown', 'Unknown']];
  const of = key => bars(names.filter(([id]) => families?.[id]).map(([id, label]) => ({label, value: Number(families[id][key]) || 0, text: num(families[id][key])})));
  return [['sharing7', 'Installs sharing (7 d)'], ['shared', 'Employer job sites shared'], ['dead', 'Dead ends reported'], ['boardsMatched', 'Board reads with matches']].map(([key, title]) => group(title, of(key))).join('');
}

/** Freshness of the central list: employers growing, shrinking, with no open job, failing. counts = [[label, count]]. */
export const freshnessChart = counts => bars(counts.map(([label, count]) => ({label, value: Number(count) || 0, text: num(count)})));

/** Most useful employers: interviews (or, when nobody got one, jobs matched) as the bar, the other counts under the name. rows = [{company, interviews, applied, hits, installs, jobs}]. */
export function usefulChart(rows) {
  const byInterviews = rows.some(row => row.interviews > 0);
  return bars(rows.map(row => ({label: row.company, hint: `${num(row.applied)} applied · ${num(row.hits)} matched · ${num(row.installs)} installs`, value: Number(byInterviews ? row.interviews : row.hits) || 0,
    text: byInterviews ? `${num(row.interviews)} interviews` : `${num(row.hits)} matched`,
    tip: `${row.company} · ${num(row.interviews)} interviews · ${num(row.applied)} applied · ${num(row.hits)} matched · ${num(row.installs)} installs · ${num(row.jobs)} jobs`})));
}
