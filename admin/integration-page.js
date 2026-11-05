// /admin/testing/integrations: the integration tests' own page (owner, 1 Nov 2026: "I'd like to keep the separate tbh"), built like /admin/testing/e2e but a page of its own.
// Draws the ONE snapshot row admin/integration-intel.js keeps: main's green share per layer, the tests per layer and how long they take, flaky tests (red then green on the same
// commit or on unchanged files), the 10 slowest tests, the move (e2e steps left against integration tests) and the nightly test coverage (admin/coverage-card.js). No table scan. Guard: test/unit/admin/integration-page.test.js.
import {viewer, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {filterLinks} from './admin.js';
import {BARS_CSS} from './day-bars.js';
import {CHIP_STYLE, chip} from './chip.js';
import {GREEN_CSS, greenCard} from './e2e-green.js';
import {LAYERS, readSnapshot} from './integration-intel.js';
import {CLOCK_CSS, clockMovedCard} from './clock-moved-card.js';
import {COVERAGE_CSS, coverageCard} from './coverage-card.js';
import {readStartProblem} from '../shared/intel-start.js';
import {startLine} from './intel-start-line.js';
import {PUBLIC_REPO} from '../shared/repos.js';
import {VIZ_STYLE, VIZ_TOOLTIP, bars, figure} from './viz.js';

const DAY = 86400000;
export const RANGES = {'7d': {name: 'Last 7 days', days: 7}, '30d': {name: 'Last 30 days', days: 30}};
export const rangeOf = value => (RANGES[value] ? value : '7d');
const LAYER_NAMES = {extension: 'Extension', app: 'App', store: 'Store'};
const LAYER_HINTS = {extension: 'the extension on recorded pages, one headless browser', app: 'screens, wording and states, a fake browser and a seeded store (Linux + Windows)', store: 'store, strategy, scoring and dedupe logic on a real SQLite in a temp folder'};
const SLOW_MS = 5000;   // "integration tests are meant to be seconds" (owner, 1 Nov 2026): a test over 5 s is flagged
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const seconds = value => { if (value < 1000) return `${num(value)} ms`; if (value < 59950) return `${(value / 1000).toLocaleString('en-US', {maximumFractionDigits: 1})} s`; const total = Math.round(value / 1000); return `${Math.floor(total / 60)} min ${total % 60} s`; };   // one rounding, then split: never "60 s" or "1 min 60 s"
const median = list => { const sorted = list.slice().sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
const runLink = (repo, runId) => `<a href="https://github.com/${esc(repo)}/actions/runs/${Number(runId)}">#${Number(runId)}</a>`;
const tone = (green, runs) => (!runs ? 'off' : green === runs ? 'good' : green / runs >= 0.9 ? 'warn' : 'bad');

/** One entry per main run and layer: green when every platform's job was green; its time is the slowest platform's. */
export function mainRuns(snapshot, range = '7d', now = new Date()) {
  const keys = new Set(Array.from({length: RANGES[rangeOf(range)].days}, (_, i) => new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)));
  const byRun = new Map();
  for (const run of (snapshot?.runs || []).filter(item => item.on === 'main' && keys.has(item.day))) {
    const key = `${run.layer}|${run.runId}`, one = byRun.get(key) || {layer: run.layer, runId: run.runId, day: run.day, green: true, ms: 0, tests: 0};
    one.green = one.green && run.conclusion === 'success'; one.ms = Math.max(one.ms, run.ms); one.tests = Math.max(one.tests, run.tests); byRun.set(key, one);
  }
  return {keys: [...keys], runs: [...byRun.values()]};
}

/** Per layer: runs, greens, the median time, the tests of the newest run, and a green/red count per day. */
export function layerStats(snapshot, range = '7d', now = new Date()) {
  const {runs, keys} = mainRuns(snapshot, range, now);
  return LAYERS.map(layer => {
    const own = runs.filter(run => run.layer === layer), days = keys.slice().sort().reverse().filter(day => own.some(run => run.day === day)).map(day => ({day, green: own.filter(run => run.day === day && run.green).length, red: own.filter(run => run.day === day && !run.green).length}));
    return {layer, runs: own.length, greens: own.filter(run => run.green).length, median: median(own.map(run => run.ms)), tests: snapshot?.counts?.[layer]?.tests ?? 0, files: snapshot?.counts?.[layer]?.files ?? 0, days};
  });
}

function bandCard(stats) {
  const all = stats.reduce((sum, row) => [sum[0] + row.greens, sum[1] + row.runs], [0, 0]);
  return `<div class="tiles">${stats.map(row => `<section class="card tile"><span class="muted">${esc(LAYER_NAMES[row.layer])} · main green</span><b>${pct(row.greens, row.runs)}</b>${chip(row.runs ? `${num(row.greens)} of ${num(row.runs)} runs` : 'no run', tone(row.greens, row.runs))}</section>`).join('')}
<section class="card tile"><span class="muted">All layers · main green</span><b>${pct(all[0], all[1])}</b>${chip(all[1] ? `${num(all[0])} of ${num(all[1])} runs` : 'no run', tone(all[0], all[1]))}</section></div>`;
}

const LAYER_COLORS = {extension: '#3987e5', app: '#199e70', store: '#c98500'};   // categorical slots of the e2e green chart (admin/e2e-green.js)
const LINES = LAYERS.map(layer => ({id: layer, label: LAYER_NAMES[layer], kinds: [layer], color: LAYER_COLORS[layer]}));
const ALL = {id: 'all', label: 'All layers', kinds: LAYERS, color: '#3987e5'};

/** Per layer and day the main runs that ended green and red, in the rows admin/e2e-green.js reads (kind = the layer). */
export function greenRows(snapshot, now = new Date()) {
  const {runs} = mainRuns(snapshot, '30d', now), rows = new Map();
  for (const run of runs) { const key = `${run.day}|${run.layer}`, row = rows.get(key) || {day: run.day, kind: run.layer, greens: 0, reds: 0}; row[run.green ? 'greens' : 'reds'] += 1; rows.set(key, row); }
  return {days: [...rows.values()]};
}

function layersCard(stats, name) {
  const rows = stats.map(row => `<tr><td><span class="sw" style="background:${LAYER_COLORS[row.layer]}"></span><b>${esc(LAYER_NAMES[row.layer])}</b><div class="muted">${esc(LAYER_HINTS[row.layer])}</div></td><td class="num">${num(row.tests)}<div class="muted">in ${num(row.files)} files</div></td>
<td class="num">${row.median === null ? '–' : seconds(row.median)}</td><td class="num">${pct(row.greens, row.runs)}</td><td>${chip(row.runs ? `${num(row.greens)} of ${num(row.runs)} runs` : 'no run', tone(row.greens, row.runs))}</td></tr>`).join('');
  const table = `<div class="scroll"><table><tr><th>Layer</th><th class="num">Tests</th><th class="num">Median run time</th><th class="num">Main green</th><th>Runs</th></tr>${rows}</table></div>`;
  // Why (owner, 5 Nov 2026, sketch): bars of the tests per layer, with each layer's median time and main green as chips.
  const lead = stats.filter(row => row.runs).map(row => [`${LAYER_NAMES[row.layer]} ${pct(row.greens, row.runs)} green · ${row.median === null ? '–' : seconds(row.median)}`, tone(row.greens, row.runs)]);
  const chart = bars(stats.map(row => ({label: LAYER_NAMES[row.layer], hint: `in ${num(row.files)} files`, value: row.tests, text: `${num(row.tests)} tests`,
    tip: `${LAYER_NAMES[row.layer]} · ${num(row.tests)} tests in ${num(row.files)} files · median run ${row.median === null ? 'no run' : seconds(row.median)} · main green ${pct(row.greens, row.runs)} (${num(row.greens)} of ${num(row.runs)} runs)`})));
  return `<section class="card"><h2>The three layers · ${esc(name)}</h2>${figure({lead, chart: stats.some(row => row.tests) ? chart : '', table})}</section>`;
}

function flakyCard(snapshot, repo, name, keys) {
  const rows = (snapshot.flaky || []).filter(row => keys.includes(row.day)).map(row => `<tr><td><code>${esc(row.test)}</code><div class="muted">${esc(row.file)}</div></td><td>${chip(esc(LAYER_NAMES[row.layer]))}</td>
<td>${row.kind === 'same-commit' ? chip('same commit', 'bad') : chip('unchanged files', 'warn')}</td><td>red ${runLink(repo, row.red.runId)} <span class="muted">${esc(row.red.sha.slice(0, 7))}</span></td><td>green ${runLink(repo, row.green.runId)} <span class="muted">${esc(row.green.sha.slice(0, 7))}</span></td></tr>`).join('');
  return `<section class="card"><h2>Flaky tests · ${esc(name)}</h2><p class="muted">A test red in one run and green in another on the same commit, or on files nothing changed. Report only.</p>
${rows ? `<div class="scroll"><table><tr><th>Test</th><th>Layer</th><th>Seen as</th><th>Red run</th><th>Green run</th></tr>${rows}</table></div>` : '<p class="muted">No flaky test in this range.</p>'}</section>`;
}

function slowCard(snapshot) {
  const slow = (snapshot.slowest || []).slice().sort((a, b) => b.ms - a.ms).slice(0, 10);
  const rows = slow.map((row, i) => `<tr><td class="num">${i + 1}</td><td><code>${esc(row.test)}</code><div class="muted">${esc(row.file)}</div></td><td>${chip(esc(LAYER_NAMES[row.layer]))}</td><td class="num">${row.ms > SLOW_MS ? chip(seconds(row.ms), 'warn') : seconds(row.ms)}</td></tr>`).join('');
  return `<section class="card"><h2>Slowest 10 tests</h2><p class="muted">Integration tests are meant to be seconds: over ${SLOW_MS / 1000} s is flagged. Newest main run of each layer.</p>
${rows ? figure({lead: slow.some(row => row.ms > SLOW_MS) ? [[`${slow.filter(row => row.ms > SLOW_MS).length} over ${SLOW_MS / 1000} s`, 'warn']] : [['all within 5 s', 'good']],
    chart: bars(slow.map(row => ({label: row.test, hint: `${LAYER_NAMES[row.layer]} · ${row.file}`, value: row.ms, text: seconds(row.ms), tip: `${row.test} · ${LAYER_NAMES[row.layer]} · ${row.file} · ${seconds(row.ms)}`})), {max: Math.max(SLOW_MS, ...slow.map(row => row.ms))}),
    table: `<div class="scroll"><table><tr><th class="num">#</th><th>Test</th><th>Layer</th><th class="num">Time</th></tr>${rows}</table></div>`}) : '<p class="muted">No test timings stored yet.</p>'}</section>`;
}

/** The move: e2e steps left against the integration tests, from the newest stored day. */
export function moveStats(snapshot) {
  const days = (snapshot?.move?.days || []).slice().sort((a, b) => a.day.localeCompare(b.day)), last = days[days.length - 1], first = days[0];
  if (!last) return null;
  const integration = LAYERS.reduce((sum, layer) => sum + last.integration[layer], 0), firstIntegration = LAYERS.reduce((sum, layer) => sum + first.integration[layer], 0);
  return {days, last, first, integration, firstIntegration, checks: last.e2eSteps + integration, left: last.e2eSteps, movedSince: first.e2eSteps - last.e2eSteps};
}

function moveCard(snapshot) {
  const move = moveStats(snapshot);
  if (!move) return '<section class="card"><h2>The move · e2e to integration</h2><p class="muted">No folder counts stored yet.</p></section>';
  const max = Math.max(...move.days.map(day => day.e2eSteps + LAYERS.reduce((sum, layer) => sum + day.integration[layer], 0)), 1);
  const rows = move.days.slice().reverse().map(day => { const integration = LAYERS.reduce((sum, layer) => sum + day.integration[layer], 0);
    return `<div class="night"><b title="${esc(day.day)}">${esc(dayWords(day.day))}</b><div class="nightbar" style="width:${((day.e2eSteps + integration) / max) * 100}%"><i style="flex:${day.e2eSteps} 1 0;background:#e07b39" title="e2e steps: ${day.e2eSteps}">${day.e2eSteps}</i><i style="flex:${Math.max(integration, 0)} 1 0;background:#3fb68b" title="integration tests: ${integration}">${integration || ''}</i></div>
<span class="muted">${esc(String(day.e2eSuites))} e2e suites</span></div>`; }).join('');
  return `<section class="card"><h2>The move · e2e to integration</h2>
<p class="verdict"><b>${pct(move.integration, move.checks)} of the checks now run as integration tests</b> <span class="muted">(${num(move.integration)} integration tests, ${num(move.left)} e2e steps left${move.movedSince > 0 ? `; ${num(move.movedSince)} e2e steps gone since ${esc(dayWords(move.first.day))}` : ''})</span></p>
<div class="key"><span class="pill" style="background:#e07b39">e2e steps</span><span class="pill" style="background:#3fb68b">integration tests</span></div>${rows}
<p class="muted">Counts from the public repo's folders each day: <code>ctx.run</code> steps in <code>desktop/e2e/suites</code> and test cases under <code>desktop/integration</code>${snapshot.move.lanes != null ? `; ${num(snapshot.move.lanes)} suites in the lane registry` : ''}.</p></section>`;
}

const CSS = `.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:28px;margin:4px 0}${CHIP_STYLE}${GREEN_CSS}.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}
.filters{margin:8px 0 10px}h2{margin:0 0 8px}.scroll{overflow-x:auto}.verdict{font-size:17px;margin:0 0 10px}${BARS_CSS}${COVERAGE_CSS}${CLOCK_CSS}${VIZ_STYLE}`;

export function page(snapshot, {range = '7d', repo = PUBLIC_REPO, now = new Date(), problem = null} = {}) {
  range = rangeOf(range);
  const name = RANGES[range].name, filters = filterLinks(Object.entries(RANGES).map(([value, {name: text}]) => [value, text, `?range=${value}`]), range);
  const stats = layerStats(snapshot, range, now), {keys} = mainRuns(snapshot, range, now);
  const body = !snapshot ? '<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>integration-intel.yml</code> publishes the integration results hourly; the first run fills this page.</p></section>'
    : `${filters}${bandCard(stats)}\n${layersCard(stats, name)}\n${coverageCard(snapshot.coverage)}\n${clockMovedCard(snapshot.clockMoved)}\n${greenCard(greenRows(snapshot, now), {days: RANGES[range].days, now, lines: LINES, headline: ALL, what: 'integration', scopeName: name})}\n${flakyCard(snapshot, repo, name, keys)}\n${slowCard(snapshot)}\n${moveCard(snapshot)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Integration · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}</style></head><body><main>
<header><h1>🧩 Integration tests</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · extension, app and store layers, runs of “CI · Integration tests”` : ''}</span></header>
${startLine(problem)}${body}${VIZ_TOOLTIP}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  const snapshot = await readSnapshot(env.STATS), problem = await readStartProblem(env.STATS, 'integration-intel.yml');
  return new Response(page(snapshot, {range: rangeOf(url.searchParams.get('range')), repo: env.GITHUB_REPO || undefined, problem}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
