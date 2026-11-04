// "How sources were read" on /admin/job-search/scouting (owner, 24 Oct 2026): per day and per read method, the sources read, the jobs found in the user's places,
// the seconds and the AI cost, for the central scout (each run's record, shared/scouting.js) and for real installs (their search reports, shared/search-report.js).
// Counts under five fixed method names only; never a host, URL or company. The engine names the methods (src/read_methods.py). Tests: test/unit/shared/readmethods.test.js.
import {C, bars, esc, n, tile} from './scoutingcharts.js';

export const METHODS = ['feed_api', 'plain_page', 'ai_board', 'browser', 'extension_tab'];
export const MEASURES = ['sources', 'jobs', 's', 'ai_cents'];
export const NAME = {feed_api: 'Job-feed API', plain_page: 'Plain page', ai_board: 'AI-suggested board', browser: 'Background browser', extension_tab: 'Extension tab'};
const COLOR = {feed_api: C.accent, plain_page: '#2bb3a6', ai_board: C.warn, browser: '#9a7fe0', extension_tab: '#e07a5f'};
const DAYS = 14;
const count = v => Number.isInteger(v) && v >= 0 && v < 1e7;

// The flat fields an install's search report may carry: read_<method>_<measure>, each a count.
export const READ_FIELDS = Object.fromEntries(METHODS.flatMap(method => MEASURES.map(measure => [`read_${method}_${measure}`, count])));

// {method: {sources, jobs, s, ai_cents}} from a scout run's record, whole numbers only; null when it carries none.
export function cleanReads(reads) {
  if (!reads || typeof reads !== 'object') return null;
  const out = Object.fromEntries(METHODS.map(method => [method, Object.fromEntries(MEASURES.map(measure => {
    const value = Math.round(Number(reads[method]?.[measure]));
    return [measure, count(value) ? value : 0];
  }))]));
  return METHODS.some(method => out[method].sources) ? out : null;
}

// The same shape from one install report's flat fields; null for a report from a build that does not send them.
export const fromReport = report => cleanReads(Object.fromEntries(METHODS.map(method => [method, Object.fromEntries(MEASURES.map(measure => [measure, report[`read_${method}_${measure}`]]))])));

// One row per day, newest first: [{day, reads: {method: {...}}, runs}] summed over the records of that day.
export function perDay(records) {
  const days = new Map();
  for (const {day, reads} of records) {
    if (!reads) continue;
    const row = days.get(day) || {day, runs: 0, reads: Object.fromEntries(METHODS.map(method => [method, Object.fromEntries(MEASURES.map(measure => [measure, 0]))]))};
    row.runs += 1;
    for (const method of METHODS) for (const measure of MEASURES) row.reads[method][measure] += reads[method][measure];
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

const total = (rows, method, measure) => rows.reduce((sum, row) => sum + row.reads[method][measure], 0);
const clock = seconds => (seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${n(seconds)} s`);
const usd = cents => `$${(cents / 100).toFixed(2)}`;

function panel(title, who, rows, empty) {
  if (!rows.length) return `<div><b>${title}</b><p class="muted empty">${esc(empty)}</p></div>`;
  const shown = rows.slice(0, DAYS), all = METHODS.reduce((sum, method) => sum + total(shown, method, 'sources'), 0);
  const tiles = METHODS.map(method => tile(NAME[method], n(total(shown, method, 'sources')), {spark: [...shown].reverse().map(row => row.reads[method].sources),
    note: `${all ? Math.round((100 * total(shown, method, 'sources')) / all) : 0}% · ${clock(total(shown, method, 's'))} · ${usd(total(shown, method, 'ai_cents'))}`})).join('');
  const rowBars = shown.map(row => ({label: row.day.slice(5), parts: METHODS.map(method => [row.reads[method].sources, COLOR[method], NAME[method]]),
    tip: `${row.day} · ${who}: ${METHODS.map(method => `${NAME[method]} ${n(row.reads[method].sources)} sources, ${n(row.reads[method].jobs)} jobs, ${clock(row.reads[method].s)}, ${usd(row.reads[method].ai_cents)}`).join(' · ')}`}));
  return `<div><b>${title}</b><div class="tiles">${tiles}</div><small class="muted">Sources read per day, by method</small>${bars(rowBars)}</div>`;
}

const fold = (rows, who) => `<details class="fold"><summary>The numbers behind it · ${who}</summary><section class="card"><div class="scroll"><table><tr><th>Day</th><th>Method</th><th>Sources</th><th>Jobs in places</th><th>Time</th><th>AI cost</th></tr>`
  + `${rows.slice(0, DAYS).flatMap(row => METHODS.filter(method => row.reads[method].sources).map(method => `<tr><td>${esc(row.day)}</td><td>${esc(NAME[method])}</td><td>${n(row.reads[method].sources)}</td><td>${n(row.reads[method].jobs)}</td><td>${clock(row.reads[method].s)}</td><td>${usd(row.reads[method].ai_cents)}</td></tr>`)).join('')}</table></div></section></details>`;

// reads = {central: [{day, reads}], installs: [{day, reads, install}]}, from gather().
export function section(reads) {
  const central = perDay(reads?.central || []), installs = perDay(reads?.installs || []), senders = new Set((reads?.installs || []).filter(r => r.reads).map(r => r.install)).size;
  return `<section class="card"><h2>📖 How sources were read</h2><small class="muted">Each source counts once per run, under the last step that gave its jobs. Jobs are those in the user's places. AI cost: API-billed calls only. Installs: only those with Technical reports on, counts only.</small>
<div class="grid2">${panel('🛰️ Central scout', 'central scout', central, 'Comes with the central scout\'s next run.')}${panel(`💻 Real installs${senders ? ` · ${n(senders)} reporting` : ''}`, 'real installs', installs, 'Comes with the next report.')}</div>
${central.length ? fold(central, 'central scout') : ''}${installs.length ? fold(installs, 'real installs') : ''}</section>`;
}

// The kept 'search' reports of the last 90 days that carry reads: [{install, day, reads}] (telemetry table, shared/search-report.js).
export async function gather(db, central = [], now = new Date()) {
  const from = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const rows = ((await db.prepare("SELECT install, day, data FROM telemetry WHERE kind = 'search' AND day >= ?").bind(from).all().catch(() => ({results: []}))).results) || [];
  const installs = rows.flatMap(row => { try { return [{install: row.install, day: row.day, reads: fromReport(JSON.parse(row.data))}]; } catch { return []; } });
  return {central: central.map(run => ({day: run.at.slice(0, 10), reads: run.reads || null})), installs};
}
