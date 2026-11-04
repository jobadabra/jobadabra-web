// /admin/testing/gtm-readiness (owner, 1 Nov 2026): how stable each critical journey is, as one gauge, a Tier 1 table (e2e steps after merge, beta, night) and a Tier 2 table (integration tests).
// Draws the ONE snapshot row the collector keeps (gtm_snapshot); no table scan. Report only: no gate, no CI check. Guard: test/unit/admin/gtm-readiness.test.js.
import {viewer, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {readSnapshot} from './gtm-intel.js';
import {TRELLO_BOARD, TRELLO_CARD} from '../shared/gtm-trello.js';
import {CHIP_STYLE, chip} from './chip.js';
import {BAND_STYLE, verdictInner} from './verdict-band.js';
import {QUIET_DAYS, STABLE_RUNS, WINDOW_DAYS, percentOf, shareTone, tier1Rows, tier2Rows, verdict} from './gtm-readiness-data.js';
import {PUBLIC_REPO} from '../shared/repos.js';

const REPO = PUBLIC_REPO;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const pct = percentOf;
const KIND = {'after-merge': 'after merge', beta: 'beta', nightly: 'night'};
const run = (runId, label = `#${runId}`) => `<a href="https://github.com/${REPO}/actions/runs/${Number(runId)}">${esc(label)}</a>`;
const STATES = {stable: ['Stable', 'good', '✓'], unstable: ['Not stable', 'bad', '✕'], few: [`Under ${STABLE_RUNS} runs`, 'warn', '…'], none: ['No runs', 'off', '–']};
const TRENDS = {up: ['▲', 'good', 'better than the 14 days before'], down: ['▼', 'bad', 'worse than the 14 days before'], flat: ['＝', 'off', 'same as the 14 days before'], null: ['–', 'off', 'needs 28 days of runs']};
const card = id => (TRELLO_CARD[id] ? `<a href="${TRELLO_BOARD}" title="card ${TRELLO_CARD[id]} on the GTM board">Trello ${TRELLO_CARD[id]}</a>` : '<span class="muted">–</span>');
const SHADE = {good: '#3fb68b', warn: '#f5c542', orange: '#f08a3c', bad: '#e5484d', off: '#8d949c'};   // the ring colours of the one scale (shareTone)
const tone = share => { const name = shareTone(share); return name === 'orange' ? 'warn' : name; };   // a chip has good / warn / bad: orange reads amber there

// One cell per day of the row's 14 days (the same window as the percentages): green = every run green, red = every run red, amber = both, grey = no run. A red or amber day links to its newest red run.
const dayCell = day => {
  const words = dayWords(day.day), kind = !day.runs ? 'e' : !day.red ? 'g' : day.red === day.runs ? 'r' : 'm';
  const title = !day.runs ? `${words} · no run` : `${words} · ${day.runs} ${day.runs === 1 ? 'run' : 'runs'} · ${day.red ? `${day.red} red` : 'all green'}`;
  return day.red ? `<a class="${kind}" href="https://github.com/${REPO}/actions/runs/${Number(day.redRunId)}" title="${esc(title)}"></a>` : `<i class="${kind}" title="${esc(title)}"></i>`;
};
const strip = days => `<span class="strip" role="img" aria-label="last ${days.length} days, newest right">${days.map(dayCell).join('')}</span>`;

// One ring: `share` 0..1 fills it, `big` is the text in the middle, `small` the word under it; `shade` is the arc's colour.
function ring({share, big, small, shade, label}) {
  const circ = 2 * Math.PI * 52;
  return `<svg class="gauge" viewBox="0 0 130 130" role="img" aria-label="${esc(label)}"><circle cx="65" cy="65" r="52" fill="none" stroke="var(--line,#262c33)" stroke-width="14"/>
<circle cx="65" cy="65" r="52" fill="none" stroke="${shade}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(circ * share).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 65 65)"/>
<text x="65" y="64" text-anchor="middle" font-size="${big.length > 5 ? 20 : 25}" font-weight="700" fill="currentColor">${esc(big)}</text><text x="65" y="84" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">${esc(small)}</text></svg>`;
}
function gauge(done, total) {
  const share = total ? done / total : 0;
  return `<div class="gtmgauge">${ring({share, big: `${done}/${total}`, small: 'stable', shade: SHADE[shareTone(share)], label: `${done} of ${total} Tier 1 journeys stable`})}</div>`;
}
// The second ring (owner, 2 Nov 2026): how many of ALL Tier 1 runs of the window were green. Same size and place as the first; the count behind it is in the text beside the rings ("395 of 400").
function runGauge(say) {
  if (say.share === null) return '';
  return `<div class="gtmgauge">${ring({share: say.share, big: say.percent, small: 'runs green', shade: SHADE[shareTone(say.share)], label: `${say.green} of ${say.runs} Tier 1 runs green`})}</div>`;
}

function tier1Card(rows) {
  const body = rows.map(row => { const [word, stateTone, icon] = STATES[row.state], [arrow, arrowTone, arrowWhy] = TRENDS[row.trend];
    return `<tr><td class="nowrap"><b>${esc(row.id === 'K' ? 'Kept' : row.id)}</b></td><td>${esc(row.name)}</td><td>${chip(`${icon} ${esc(word)}`, stateTone)}${row.why ? `<div class="muted small">${esc(row.why)}</div>` : ''}</td>
<td class="num">${row.os.mac ? chip(pct(row.os.mac.green), tone(row.os.mac.green)) : '<span class="muted">–</span>'}</td><td class="num">${row.os.windows ? chip(pct(row.os.windows.green), tone(row.os.windows.green)) : '<span class="muted">–</span>'}</td>
<td>${strip(row.days)}</td><td class="nowrap">${row.lastBad ? `${esc(dayWords(row.lastBad.day))} · ${esc(KIND[row.lastBad.kind] || row.lastBad.kind)} ${run(row.lastBad.runId)}` : '<span class="muted">none in 14 days</span>'}</td>
<td title="${esc(arrowWhy)}">${chip(arrow, arrowTone)}</td><td>${card(row.id)}</td></tr>`; }).join('');
  return `<section class="card"><h2>Tier 1 · the journeys that block a user · last ${WINDOW_DAYS} days</h2>
<div class="scroll"><table><tr><th>Id</th><th>Journey</th><th>State</th><th class="num">Mac</th><th class="num">Windows</th><th>Last ${WINDOW_DAYS} days</th><th>Last red</th><th>Trend</th><th>Board</th></tr>${body}</table></div>
<p class="muted">Every cell of a row counts the same runs: the last ${WINDOW_DAYS} days. Each square is one day (green = all runs green, amber = some red, red = all red, grey = no run); hover for the runs. Green share = runs with no failed step, from the e2e runs after each merge, the beta and the night (every run of a journey's steps, on each OS). <b>Stable</b> = green in its last ${STABLE_RUNS} runs of those days and no red in the last ${QUIET_DAYS} days; the line under the state says which rule holds it back. A run is red for a journey when one of its registry steps failed, or its suite died before the step ran. The kept row bundles safety and data steps no journey owns; it is not in the count.</p></section>`;
}

function tier2Card(rows) {
  const body = rows.map(row => `<tr><td class="nowrap"><b>${esc(row.id)}</b></td><td>${esc(row.name)}</td><td class="num">${row.tests}</td><td class="num">${row.runs}</td>
<td class="num">${row.runs ? chip(pct(row.share), tone(row.share)) : '<span class="muted">–</span>'}</td><td class="nowrap">${row.lastRed ? esc(dayWords(row.lastRed.day)) : '<span class="muted">none</span>'}</td><td>${card(row.id)}</td></tr>`).join('');
  return `<section class="card"><h2>Tier 2 · integration tests only · last ${WINDOW_DAYS} days</h2>
<div class="scroll"><table><tr><th>Id</th><th>Journey</th><th class="num">Tests</th><th class="num">Runs</th><th class="num">Green</th><th>Last red</th><th>Board</th></tr>${body}</table></div>
<p class="muted">Runs of “CI · Integration tests”: they run on pull requests and on main (the integration job of CI · Tests), so a red on a PR can be a real bug a test caught. The history grows from the first collector run.</p></section>`;
}

const CSS = `${CHIP_STYLE}${BAND_STYLE}.gtmhero{display:flex;gap:24px;align-items:center;flex-wrap:wrap}.gauge{width:130px;height:130px;flex:none}.gtmhero>div:last-child{flex:1 1 320px;min-width:0}.gtmgauge{flex:none;width:130px;height:130px}
.scroll{overflow-x:auto}table{width:100%;font-size:14px}td:nth-child(2){min-width:170px}td:last-child{white-space:nowrap}th,td{padding-left:6px;padding-right:6px}h2{margin:0 0 8px}td.num,th.num{text-align:right}.nowrap{white-space:nowrap}
.strip{display:inline-flex;gap:2px;vertical-align:middle}.strip i,.strip a{display:block;width:6px;height:18px;border-radius:2px}.strip .g{background:#3fb68b}.strip .r{background:#e5484d}.strip .m{background:#f5b54a}.strip .e{background:var(--line,#262c33)}.small{font-size:12px}`;

export function page(snapshot, {now = new Date()} = {}) {
  const rows = snapshot ? tier1Rows(snapshot, now) : [], say = verdict(rows);
  const body = !snapshot ? '<section class="card"><h2>No data yet</h2><p class="muted">The collector (<code>e2e-intel.yml</code>) fills this page from the e2e and integration runs.</p></section>'
    : `<section class="card"><div class="gtmhero">${gauge(say.stable, say.total)}${runGauge(say)}<div>${verdictInner({headline: say.text, chips: say.chips, note: `${say.runs ? `${say.green} of ${say.runs} runs green in the last ${WINDOW_DAYS} days · ` : ''}Tier 1 = journeys that block a flow · red = failed lately · amber = too few runs to judge`})}</div></div></section>
${tier1Card(rows)}\n${tier2Card(tier2Rows(snapshot, now))}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>GTM readiness · Testing · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${CSS}</style></head><body><main>
<header><h1>🚦 GTM readiness</h1><span class="muted">${snapshot ? `as of ${esc(snapshot.at.slice(0, 16).replace('T', ' '))} UTC · critical journeys of <code>desktop/e2e/critical-journeys.json</code>` : ''}</span></header>
${body}</main></body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  return new Response(page(await readSnapshot(env.STATS)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
