// /admin/testing/e2e: where our e2e reds come from (owner, 18 Oct 2026; every run kind and a cause for every red, 27 Oct 2026). Draws the ONE snapshot row admin/e2e-intel.js
// keeps: every finished e2e run (beta, nightly, main after a merge, scheduled, soak, PR, the daily harness tests), which suites went red, and why (admin/e2e-causes.js), and how steady the AI is in the quality suite (admin/e2e-quality.js). The top
// (who caused it, top causes and suites, the biggest breaks, PR e2e's cost vs catch) is admin/e2e-top.js. No table scan. Guard: test/unit/admin/e2e/e2e-page.test.js.
import {viewer} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {remember} from '../shared/auth.js';
import {CAUSES, CAUSE_IDS, causeId} from './e2e-causes.js';
import {KINDS} from './e2e-intel.js';
import {TOP_CSS, top} from './e2e-top.js';
import {filterLinks} from './admin.js';
import {BARS_CSS, barRows, legend} from './day-bars.js';
import {CHIP_STYLE, chip} from './chip.js';
import {BARS, rateOf} from './e2e-quality.js';
import {readStartProblem} from '../shared/intel-start.js';
import {startLine} from './intel-start-line.js';
import {SCORECARD_CSS, scorecardCard, workCard} from './e2e-scorecard.js';
import {greySummary, greyNightText, GREY_NOTE} from './e2e-grey.js';
import {weekOf} from './e2e-work.js';
import {GREEN_CSS, greenCard} from './e2e-green.js';
import {BETA_CSS, betaCard} from './e2e-beta.js';
import {PR_JOB_BUDGET_SECONDS, PR_SPLIT_SECONDS, speedSummary, speedTime} from './e2e-speed.js';
import {PUBLIC_REPO} from '../shared/repos.js';
import {VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';
import {filesChart, prCostChart, qualityChart, scoreChart, speedFigure, suiteCostFigure, swapTable} from './testing-charts.js';
import {summary as topSummary} from './e2e-top.js';
import {scoreRows} from './e2e-scorecard.js';

const DAY = 86400000;
export const RANGES = {'7d': {name: 'Last 7 days', days: 7}, '30d': {name: 'Last 30 days', days: 30}};
export const rangeOf = value => (RANGES[value] ? value : '7d');
export const kindFilter = value => (KINDS.includes(value) ? value : 'all');
const KIND_NAMES = {all: 'All runs', beta: 'Beta', nightly: 'Nightly', 'after-merge': 'Main after merge', scheduled: 'Scheduled', soak: 'Soak', canary: 'Canary', pr: 'PR', harness: 'Harness tests'};
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const hours = minutes => `${((Number(minutes) || 0) / 60).toLocaleString('en-US', {maximumFractionDigits: 1})} h`;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const swatch = id => `<span class="sw" style="background:${CAUSES.find(cause => cause.id === id)?.color || '#8d949c'}"></span>`;
const label = id => CAUSES.find(cause => cause.id === id)?.label || id;

// The rows of the range: days from `now` back, as the YYYY-MM-DD keys they are stored under.
// kind: one run kind or 'all'. allDays/allFails stay unfiltered by kind (the PR box and main's green share need every kind). Rows of rules 1-2 read under today's cause ids.
export function windowOf(snapshot, range, now = new Date(), kind = 'all') {
  const keys = new Set(Array.from({length: RANGES[rangeOf(range)].days}, (_, i) => new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)));
  const ofKind = row => kind === 'all' || (row.kind || 'beta') === kind;
  const allDays = (snapshot?.days || []).filter(row => keys.has(row.day)), allFails = (snapshot?.fails || []).filter(row => keys.has(row.day)).map(row => ({...row, cause: causeId(row.cause)}));
  const days = allDays.filter(ofKind), fails = allFails.filter(ofKind);
  const weeks = new Set([...keys].map(weekOf)), escapes = (snapshot?.escapes || []).filter(row => weeks.has(row.week));
  const breaks = (snapshot?.breaks || []).filter(row => keys.has(row.day) && ofKind(row)).map(row => ({...row, cause: causeId(row.cause)})), caught = (snapshot?.caught || []).filter(row => keys.has(row.day));
  const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const reds = sum(fails, 'n'), byCause = Object.fromEntries(CAUSE_IDS.map(id => [id, sum(fails.filter(row => row.cause === id), 'n')]));
  const betas = allDays.filter(row => (row.kind || 'beta') === 'beta'), beta = {runs: sum(betas, 'runs'), cancelled: sum(betas, 'cancelled'), greens: sum(betas, 'greens')};
  return {keys: [...keys], allDays, allFails, breaks, caught, beta, days, fails, escapes, runs: sum(days, 'runs'), cancelled: sum(days, 'cancelled'), redRuns: sum(days, 'reds'), greenRuns: sum(days, 'greens'), redMin: sum(days, 'redMin'), reds, byCause, failMin: sum(fails, 'min')};
}

function tiles(w) {
  const top = CAUSES.filter(cause => w.byCause[cause.id]).sort((a, b) => w.byCause[b.id] - w.byCause[a.id])[0];
  return `<div class="tiles"><section class="card tile"><span class="muted">Red runs</span><b>${pct(w.redRuns, w.runs)}</b><span class="muted">${num(w.redRuns)} of ${num(w.runs)} finished runs ended red</span></section>
<section class="card tile"><span class="muted">Betas per green</span><b>${w.beta.greens ? ((w.beta.runs + w.beta.cancelled) / w.beta.greens).toLocaleString('en-US', {maximumFractionDigits: 1}) : '–'}</b><span class="muted">${num(w.beta.runs + w.beta.cancelled)} betas started (${num(w.beta.cancelled)} cancelled) for ${num(w.beta.greens)} green</span></section>
<section class="card tile"><span class="muted">Time in red runs</span><b>${hours(w.redMin)}</b><span class="muted">wall time of the runs that ended red</span></section>
<section class="card tile"><span class="muted">Flakes</span><b>${pct(w.byCause.flake, w.reds)}</b><span class="muted">${num(w.byCause.flake)} of ${num(w.reds)} red suites passed on the second try</span></section>
<section class="card tile"><span class="muted">Top cause</span><b>${top ? esc(top.label) : '–'}</b><span class="muted">${top ? `${num(w.byCause[top.id])} red suites` : 'no red suites in this range'}</span></section></div>`;
}

// Per suite and platform: red count, minutes, and the causes as chips, the most expensive first.
export function suiteRows(w) {
  const rows = new Map();
  for (const fail of w.fails) {
    const key = `${fail.suite}|${fail.platform}`, row = rows.get(key) || {suite: fail.suite, platform: fail.platform, n: 0, min: 0, causes: {}};
    row.n += fail.n; row.min += fail.min || 0; row.causes[fail.cause] = (row.causes[fail.cause] || 0) + fail.n; rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.min - a.min || b.n - a.n || a.suite.localeCompare(b.suite));
}
function suiteTable(w) {
  const rows = suiteRows(w).map(row => `<tr><td><code>${esc(row.suite)}</code></td><td>${row.platform === 'windows' ? 'Windows' : 'Mac + Linux'}</td><td class="num">${num(row.n)}</td><td class="num">${hours(row.min)}</td>
<td>${CAUSES.filter(cause => row.causes[cause.id]).map(cause => `<span class="chip">${swatch(cause.id)}${esc(cause.label)} ${row.causes[cause.id]}</span>`).join(' ')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No red suites in this period.</td></tr>';
  return `<div class="scroll"><table><tr><th>Suite</th><th>Platform</th><th class="num">Red</th><th class="num">Job time</th><th>Why</th></tr>${rows}</table></div>`;
}

// One stacked row per day, newest first: the red suites by cause. Days with no red suite say so.
export function bars(w) {
  const list = w.keys.slice().sort().reverse().filter(day => w.days.some(row => row.day === day)).map(day => ({label: dayWords(day), title: day, counts: Object.fromEntries(CAUSE_IDS.map(id => [id, w.fails.filter(row => row.day === day && row.cause === id).reduce((total, row) => total + row.n, 0)]))}));
  const summary = (row, total) => { const runs = w.days.filter(item => item.day === row.title).reduce((n, item) => n + (Number(item.runs) || 0), 0); return total ? `${total} red ${total === 1 ? 'suite' : 'suites'}` : (runs ? `${runs} ${runs === 1 ? 'run' : 'runs'}, all green` : 'no run'); };
  return `${legend(CAUSES)}${barRows(CAUSES, list, summary)}`;
}

// How steady the AI is in the quality suite (admin/e2e-quality.js): two tiles against the owner's bars, facts and judge flags, then each night.
const rate1 = value => (value == null ? '–' : `${Math.round(value * 1000) / 10}%`);
// One night's prompt-case replay (the public repo's nightly, report only; admin/e2e-quality.js cleanPrompt) in words and a chip: it has no bar, so nothing here goes red but "got worse".
function promptWords(prompt) {
  if (!prompt) return {text: '–', tone: 'off'};
  if (prompt.status === 'not-asked') return {text: 'not asked', tone: 'warn'};
  if (prompt.status === 'carried') return {text: 'no prompt changed', tone: 'off'};
  return {text: `${prompt.right}/${prompt.total}`, tone: prompt.flipped ? 'bad' : 'good'};
}
const promptTile = prompt => {
  const words = promptWords(prompt);
  const detail = !prompt ? 'no night reported yet' : prompt.status === 'not-asked' ? 'the broker said no; last baseline kept'
    : prompt.status === 'carried' ? `nothing asked, ${prompt.right} of ${prompt.total} right as last asked` : `${prompt.noise} model noise · ${prompt.newWrong} new wrong · ${prompt.unconfirmed} unconfirmed · ${prompt.calls} calls`;
  return `<section class="card tile"><span class="muted">Prompt cases (newest night)</span><b>${esc(words.text)}</b>${prompt && ['asked', 'first'].includes(prompt.status) ? `<div>${chip(prompt.flipped ? `${prompt.flipped} got worse` : 'none got worse', prompt.flipped ? 'bad' : 'good')}</div>` : ''}<span class="muted">${esc(detail)}</span></section>`;
};
export function qualityCard(nights = [], repo = PUBLIC_REPO) {
  if (!nights.length) return '<section class="card"><h2>How steady the AI is · quality suite</h2><p class="muted">No live quality night yet: the night\'s fresh quality run scores the golden jobs twice.</p></section>';
  const rate = rateOf(nights), tone = ok => (ok ? 'good' : 'bad');
  const html = `<section class="card"><h2>How steady the AI is · last ${rate.pairs} score pairs (${rate.nights} ${rate.nights === 1 ? 'night' : 'nights'})</h2>
<div class="tiles"><section class="card tile"><span class="muted">Same score twice (within ${BARS.within})</span><b>${rate1(rate.agree)}</b>${chip(`bar ≥ ${BARS.agree * 100}%`, tone(rate.agreeOk))}</section>
<section class="card tile"><span class="muted">Big jumps (over ${BARS.jump} apart)</span><b>${rate1(rate.jumps)}</b>${chip(`bar ≤ ${BARS.jumps * 100}%`, tone(rate.jumpsOk))}</section>
<section class="card tile"><span class="muted">Facts exact</span><b>${rate1(rate.factsTotal ? rate.factsExact / rate.factsTotal : null)}</b><span class="muted">${rate.factsExact} of ${rate.factsTotal}</span></section>
<section class="card tile"><span class="muted">Score texts with invented facts</span><b>${rate1(rate.judged ? rate.invented / rate.judged : null)}</b><span class="muted">${rate.invented} of ${rate.judged} judged</span></section>
${promptTile(nights.find(night => night.promptCases)?.promptCases)}</div>
<div class="scroll"><table><tr><th>Night</th><th>Run</th><th class="num">Pairs</th><th class="num">Within ${BARS.within}</th><th class="num">Over ${BARS.jump}</th><th class="num">Facts exact</th><th class="num">Invented</th><th class="num">Prompt cases</th></tr>${nights.slice(0, 14).map(night =>
  `<tr><td>${esc(night.day)}</td><td><a href="https://github.com/${esc(repo)}/actions/runs/${Number(night.runId)}">#${Number(night.runId)}</a></td><td class="num">${night.pairs}</td><td class="num">${chip(`${night.within8}`, night.within8 / night.pairs >= BARS.agree ? 'good' : 'warn')}</td><td class="num">${night.over20 ? chip(`${night.over20}`, 'bad') : chip('0', 'good')}</td><td class="num">${night.factsExact}/${night.factsTotal}</td><td class="num">${night.invented}/${night.judged}</td><td class="num">${chip(esc(promptWords(night.promptCases).text), promptWords(night.promptCases).tone)}</td></tr>`).join('')}</table></div></section>`;
  return swapTable(html, '<div class="scroll"><table><tr><th>Night</th>', qualityChart(nights));
}

function greyCard(snapshot, now, repo) {
  const grey = greySummary(snapshot, now);
  return `<section class="card"><h2>Grey</h2>${!grey.read ? '<p class="muted">lane registry not read yet</p>' : !grey.rows.length ? '<p class="muted">No tolerant or suspended suites.</p>' :
    `<div class="scroll"><table><tr><th>Suite</th><th>Lane · input</th><th>Why</th><th>Since</th><th>Returns</th><th>Last 7 nights observed</th></tr>${grey.rows.map(row =>
      `<tr><td><code>${esc(row.suite)}</code></td><td>${esc(row.lane)} · ${esc(row.input || 'input not named')}</td><td>${esc(row.why || 'reason not named')}</td><td>${esc(row.since || 'unknown')} (${esc(row.ageText)})</td><td>${esc(row.returns)}</td><td>${row.nights.map(night => chip(esc(greyNightText(night)), night.green === null ? 'off' : night.green ? 'good' : 'bad')).join(' ') || '<span class="muted">No suite nights stored yet.</span>'}</td></tr>`).join('')}</table></div>`}
<p class="muted">${esc(GREY_NOTE)}</p></section>`;
}

function budgetBar(seconds) {
  const used = Math.min(seconds, PR_JOB_BUDGET_SECONDS), left = PR_JOB_BUDGET_SECONDS - used;
  return `<div class="nightbar" role="img" aria-label="${esc(speedTime(seconds))} against the ${PR_JOB_BUDGET_SECONDS / 60}-minute PR job budget">
<i style="flex:${used} 1 0;background:var(--amber,#f5b54a)" title="Median job: ${esc(speedTime(seconds))}"></i><i style="flex:${left} 1 0;background:var(--line,#262c33)" title="PR job budget: ${PR_JOB_BUDGET_SECONDS / 60} min"></i></div>`;
}

/** Informational job medians after Grey; never substitutes a job duration for a user-promise step timing. */
function speedCard(snapshot, now = new Date()) {
  const speed = speedSummary(snapshot, now);
  const rows = speed.main.map(row => `<tr><td><code>${esc(row.suite)}</code></td><td>${row.median === null ? '<span class="muted">Not enough runs</span>' : chip(speedTime(row.median))}</td>
<td>${row.n} run${row.n === 1 ? '' : 's'}</td><td>${row.median === null ? '–' : `${speedTime(row.p25)}–${speedTime(row.p95)}`}</td><td>${row.median === null ? '–' : budgetBar(row.median)}</td></tr>`).join('');
  return `<section class="card"><h2>Speed · last 30 days</h2>
<p class="muted">Successful suite jobs on main (after merge, nightly and scheduled), slowest first. At least 3 runs for a median. Each run counts once per suite using its longest successful job; shard names stay separate. Old rows without timings do not count.</p>
${rows ? speedFigure(speed.main, `<div class="scroll"><table><tr><th>Suite</th><th>Main median</th><th>n</th><th>p25–p95</th><th>PR job budget · ${PR_JOB_BUDGET_SECONDS / 60} min</th></tr>${rows}</table></div>`, {budgetSeconds: PR_JOB_BUDGET_SECONDS}) : '<p class="muted">No suite job timings stored yet. The hourly collector adds timings as new runs finish.</p>'}
<p class="muted">Job time includes setup and teardown. User promise step timings are not collected yet.</p>
<h3>PR suite jobs · ${PR_SPLIT_SECONDS / 60}-minute early warning</h3>
${speed.slowPr.length ? `<ul>${speed.slowPr.map(row => `<li><code>${esc(row.suite)}</code> · ${speedTime(row.median)} · ${row.n} runs ${chip('split it', 'warn')}</li>`).join('')}</ul>`
    : `<p class="muted">${speed.prRead ? `PR suites over ${PR_SPLIT_SECONDS / 60} min: none.` : 'Not enough PR runs for a median yet.'}</p>`}</section>`;
}

// The public cards (admin/e2e-top.js, e2e-scorecard.js) draw their tables; these put a chart in front (admin/testing-charts.js swapTable).
const withPrChart = (html, w) => swapTable(html, '<div class="scroll"><table><tr><th>Day</th><th class="num">Full runs green</th>', prCostChart(topSummary(w).green));
const withFilesChart = (html, snapshot, now) => swapTable(html, '<div class="scroll"><table><tr><th>File</th><th class="num">Commits</th>',
  filesChart((snapshot.workFiles || []).filter(row => row.week === weekOf(now.toISOString().slice(0, 10))).slice(0, 6)));

export function page(snapshot, {range = '7d', kind = 'all', repo = PUBLIC_REPO, now = new Date(), problem = null} = {}) {
  range = rangeOf(range); kind = kindFilter(kind);
  const filters = filterLinks(Object.entries(RANGES).map(([value, {name}]) => [value, name, `?range=${value}${kind === 'all' ? '' : `&kind=${kind}`}`]), range)
    + filterLinks(Object.entries(KIND_NAMES).map(([value, text]) => [value, text, `?range=${range}${value === 'all' ? '' : `&kind=${value}`}`]), kind);
  const w = windowOf(snapshot, range, now, kind), name = `${RANGES[range].name}${kind === 'all' ? '' : ` · ${KIND_NAMES[kind]}`}`;
  const body = !snapshot ? `<section class="card"><h2>No data yet</h2><p class="muted">The workflow <code>e2e-intel.yml</code> publishes every finished e2e run hourly; the first run fills this page.</p></section>`
    : `${filters}${greenCard(snapshot, {kind, days: RANGES[range].days, now, kindName: id => KIND_NAMES[id] || id, scopeName: name})}${['all', 'beta'].includes(kind) ? betaCard(snapshot, {days: RANGES[range].days, now, repo, scopeName: RANGES[range].name}) : ''}${withPrChart(top(w, {repo}), w)}${tiles(w)}
${qualityCard(snapshot.quality || [], repo)}
${greyCard(snapshot, now, repo)}
${speedCard(snapshot, now)}
<section class="card"><h2>Red suites per day, by cause · ${esc(name)}</h2>${w.reds ? bars(w) : '<p class="muted">No red suites in this range.</p>'}</section>
<section class="card"><h2>Which suites cost the most · ${esc(name)}</h2>${suiteCostFigure(suiteRows(w), suiteTable(w), label)}</section>
${swapTable(scorecardCard(w, name, {now, repo}), '<div class="scroll"><table><tr><th>Suite</th><th class="num">Caught a bug</th>', scoreChart(scoreRows(w.fails, w.escapes || [])))}
${withFilesChart(workCard(snapshot, now), snapshot, now)}
<section class="card"><h2>What each cause means</h2><table>${CAUSES.map(cause => `<tr><td class="nowrap">${swatch(cause.id)}${esc(cause.label)}</td><td class="muted">${esc(cause.hint)}</td></tr>`).join('')}</table></section>
<section class="card"><h2>Latest ${(snapshot.latest || []).length} runs</h2><div class="scroll"><table><tr><th>Run</th><th>Day</th><th>Kind</th><th>Result</th><th class="num">Minutes</th></tr>${(snapshot.latest || []).map(run =>
  `<tr><td><a href="https://github.com/${esc(repo)}/actions/runs/${Number(run.runId)}">#${Number(run.runId)}</a></td><td>${esc(run.day)}</td><td>${chip(esc(run.kind || 'beta'))}</td><td>${run.conclusion === 'failure' ? chip('red', 'bad') : run.conclusion === 'cancelled' ? chip('cancelled', 'off') : chip('green', 'good')}</td><td class="num">${num(run.minutes)}</td></tr>`).join('')
  || '<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}</table></div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>E2E · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:28px;margin:4px 0}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}${CHIP_STYLE}
.filters{margin:8px 0 10px}${TOP_CSS}h2{margin:0 0 8px}.scroll{overflow-x:auto}.nights .night span.muted{white-space:nowrap}${BARS_CSS}${SCORECARD_CSS}${GREEN_CSS}${BETA_CSS}${VIZ_STYLE}</style></head><body><main>
<header><h1>🧪 Why e2e goes red</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · every e2e run: beta, nightly, main after merge, scheduled, soak, PR, harness` : ''}</span></header>
${startLine(problem)}${body}${VIZ_TOOLTIP}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  const problem = await readStartProblem(env.STATS, 'e2e-intel.yml');
  return new Response(page(snapshot, {range: rangeOf(url.searchParams.get('range')), kind: kindFilter(url.searchParams.get('kind')), repo: env.GITHUB_REPO || undefined, problem}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
