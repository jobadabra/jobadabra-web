// The "Random draws" tab of /admin/job-search/lab (owner, 18 Oct 2026): one report row per daily CI draw, newest first, judged by admin/search-lab-draws.js.
// Why (owner, 12 Nov 2026: "not very intelligible… make them more meaningful just by looking at them"; sketch https://claude.ai/artifact/MDCxJXb1Kb9PKuF8CS6w8M, "Yes, as sketched"):
// a verdict band (how many draws reached a relevant job), dated columns of each draw's funnel, where the draws stop, then one line per draw with ONE reason.
// Counts and seconds only; every row says CI, so a Mac run is never compared with it. Guard: test/unit/admin/search/search-lab-draws.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {verdictBand} from './verdict-band.js';
import {VIZ_TOOLTIP, bars, columns, figure} from './viz.js';
import {judge} from './search-lab-draws.js';

const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? '—' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
const PATH_NAMES = {'field-change': 'field change, 2nd search', again: 'same search again'};
const where = row => (row.place_kind === 'region' ? `${row.place} (from ${row.city})` : row.place_kind === 'remote' ? `remote, from ${row.city}, ${row.country}` : row.place_kind === 'country' ? `all of ${row.country} (from ${row.city})` : `${row.city}, ${row.country}`);
const funnelOf = row => { try { return row.funnel ? JSON.parse(row.funnel) : null; } catch { return null; } };
const median = list => { const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null; };

/** The funnel's words for a row's tooltip: kinds, employers, boards, web searches, jobs listed, AI dollars. */
function funnelWords(row) {
  const f = funnelOf(row);
  const parts = f ? [f.kinds?.length ? `kind ${f.kinds.join(', ')}` : null, f.employers_picked != null ? `${num(f.employers_picked)} employers` : null, `${num(f.boards_read)} boards`,
    `${num(f.web_searches)} web searches`, f.looked != null ? `${num(f.looked)} jobs listed` : null].filter(Boolean) : [];
  if (row.ai_usd != null) parts.push(`AI $${Number(row.ai_usd).toFixed(2)}`);
  return parts.join(' · ');
}

/** Where a judged draw stopped, in a few words: the first stage of the funnel that came out empty, else the judge's first reason. Invariant: a usual draw gives ''. */
export function stopOf(row) {
  if (row.verdict === 'failed') return `crashed: ${row.failed_step || 'unknown step'}`;
  if (row.verdict === 'usual') return '';
  if (!row.in_places) return 'no job in the places';
  if (!row.scored) return 'nothing scored';
  if (!row.fit70) return 'none at 70+';
  return row.why[0] || '';
}

/**
 * The draws the headline speaks for: the search robot's kind (a made-up role, 26 Oct 2026) when there is one; the rest are an earlier kind that is not compared with it.
 * Why (12 Nov 2026, live rows): 3 earlier draws had a median of 143 jobs in places, the robot's 17 a median of 7; mixed, the chart's scale and the median hid the robot's numbers.
 */
export function eras(rows) {
  const robot = rows.filter(row => row.role);
  return robot.length ? {now: robot, before: rows.filter(row => !row.role)} : {now: rows, before: []};
}

function band(now, before) {
  const ok = now.filter(row => row.verdict !== 'failed'), relevant = ok.filter(row => row.fit70 > 0).length;
  const funnels = now.map(funnelOf).filter(Boolean), sum = key => funnels.reduce((total, f) => total + (f[key] || 0), 0);
  const chips = [{label: `median ${num(median(ok.map(row => row.in_places ?? 0)))} jobs in the places`, tone: 'off', title: before.length ? `${before.length} earlier draws of another kind: median ${num(median(before.map(row => row.in_places ?? 0)))}` : ''}];
  if (funnels.length && sum('web_searches') && !sum('web_found')) chips.push({label: `web search found 0 jobs in ${num(sum('web_searches'))} searches`, tone: 'bad'});
  if (sum('board_jobs')) chips.push({label: `boards: ${num(sum('board_jobs'))} listed, ${num(sum('board_relevant'))} relevant`, tone: sum('board_relevant') ? 'warn' : 'bad'});
  if (sum('ai_refused')) chips.push({label: `AI refused ${num(sum('ai_refused'))} calls`, tone: 'warn'});
  if (now.length > ok.length) chips.push({label: `${now.length - ok.length} crashed`, tone: 'bad'});
  return verdictBand({icon: relevant === 0 ? '🔴' : relevant < now.length / 2 ? '🟠' : '🟢', headline: `${relevant} of ${now.length} draws reached a relevant (70+) job`, chips,
    note: before.length ? `The search robot's draws (a made-up role in a city, country, region or remote) since ${now.at(-1).draw_date}; ${before.length} earlier draws of another kind are listed below, not counted here.` : ''});
}

function trendCard(now) {
  const shown = now.slice(0, 30).reverse();
  const days = shown.map(row => ({day: row.draw_date, values: row.verdict === 'failed' ? [null, null, null] : [row.in_places ?? 0, row.scored ?? 0, row.fit70 ?? 0],
    tip: `${row.draw_date} · ${row.role || row.family}, ${where(row)} · ${num(row.in_places)} in the places · ${num(row.scored)} scored · ${num(row.fit70)} at 70+`}));
  const chart = columns(days, [{name: 'Jobs in the places', tone: 's1'}, {name: 'Scored', tone: 's4'}, {name: 'Relevant (70+)', tone: 's3'}], {whole: true, labelEvery: Math.max(1, Math.ceil(days.length / 8)), gapLabel: 'crashed'});
  return `<section class="card"><h2>Each draw's jobs: in the places → scored → relevant</h2>${figure({chart})}</section>`;
}

function stopsCard(now) {
  const ok = now.filter(row => row.verdict !== 'failed'), reached = test => ok.filter(test).length;
  const steps = [['Drawn', now.length], ['Jobs in the places', reached(row => row.in_places > 0)], ['Scored', reached(row => row.scored > 0)], ['Relevant (70+)', reached(row => row.fit70 > 0)]];
  return `<section class="card"><h2>Where the ${now.length} draws stop</h2>${figure({chart: bars(steps.map(([label, value]) => ({label, value, text: `${value} of ${now.length}`})), {max: now.length})})}</section>`;
}

function rowHtml(row) {
  const failed = row.verdict === 'failed', cell = (value, good) => `<i class="${!value ? 'z' : good ? 'g' : ''}">${num(value)}</i>`;
  const chips = [(row.source || 'ci').toUpperCase(), PATH_NAMES[row.path], row.engine === 'free' ? 'Free AI' : null].filter(Boolean).map(word => `<span class="chip">${esc(word)}</span>`).join(' ');
  const tip = [...row.why, funnelWords(row), `1st job ${clock(row.first_s)} · 10th job ${clock(row.tenth_s)} · 1st 70+ job ${clock(row.fit_s)}`].filter(Boolean).join('\n');
  return `<tr title="${esc(tip)}"><td>${esc(row.draw_date)}</td><td><b>${esc(row.role || row.family)}</b>${row.role ? ` <span class="muted">${esc(row.family)}</span>` : ''} · ${esc(where(row))} ${chips}</td>`
    + `<td>${failed ? '–' : `<span class="strip">${cell(row.in_places)}${cell(row.scored)}${cell(row.fit70, true)}</span>`}</td><td class="num">${failed ? '–' : clock(row.first_s)}</td>`
    + `<td>${row.verdict === 'usual' ? chip('✓ Usual', 'good') : chip(`✕ ${failed ? 'FAILED' : 'Weak'} · ${esc(stopOf(row))}`, 'bad')}</td></tr>`;
}

/** The whole tab: band, chart, where the draws stop, the rows (newest first) and how a draw is judged. */
export function drawsSection(all) {
  const rows = judge(all), {now, before} = eras(rows);
  if (!rows.length) return '<section class="card"><h2>No draw yet</h2><p class="muted">The daily CI job (.github/workflows/random-draw.yml) uploads one each day.</p></section>';
  const table = `<div class="scroll"><table class="draws"><tr><th>Date</th><th>Draw</th><th>In places → scored → 70+</th><th class="num">1st job</th><th>Result</th></tr>${rows.map(rowHtml).join('')}</table></div>`;
  return `${band(now, before)}${trendCard(now)}${stopsCard(now)}
<section class="card"><h2>Each daily draw</h2><p class="muted">Hover a row for every reason, the funnel and the three times.</p>${table}</section>
<section class="card"><h2>How a draw is judged</h2><p class="muted">A random role kind with a role the AI makes up, in a city, a country, a region or remote, on a first search, a field change then a 2nd search, or the same search again; a fictional CV, a fresh throwaway install on CI (data-centre address: a board that refuses is "not reached", never worked around). <b>Weak</b>: no relevant job reached, fewer than 10 jobs in places, or under half the role family's median once it has 5 earlier draws. Never mixed with the six candidates or the Real installs.</p></section>${VIZ_TOOLTIP}`;
}

export const DRAWS_CSS = `${CHIP_STYLE}.tabs{display:flex;gap:8px;margin-bottom:12px}.tabs a{padding:4px 12px;border:1px solid #2a2f37;border-radius:999px;color:#8d949c;text-decoration:none;font-size:13px}.tabs a.on{color:#e6e9ed;border-color:#5fb3ff}
table.draws td{vertical-align:middle}table.draws td:first-child{white-space:nowrap}.strip{display:inline-flex;gap:2px}.strip i{font-style:normal;min-width:40px;text-align:center;padding:2px 6px;font-size:12px;font-weight:600;border-radius:3px;background:#22303d;color:#cfe6ff;font-variant-numeric:tabular-nums}
.strip i.z{background:#40181a;color:#ff8a80}.strip i.g{background:#16341f;color:#6fdc8c}`;
