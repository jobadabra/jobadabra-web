// "Each source, night after night" on the Finish line tab (owner, 11 Nov 2026, asked via AskUserQuestion: "Build as drawn (Recommended)", after job boards gave 0 jobs for two weeks unseen: "Do we have a graph in Admin that tells
// this ?"; before it: "We should have graphs in the Admin showing us our progress to the finish line"): one panel per source over the last 14 nights, replacing the stacked "Right jobs per night, by source group".
// A panel = right jobs per night as bars from 0 (a source at 0 is a red 0, a night with no upload a dashed gap, a count not sent a dashed tick, never a flat 0) + "people who read it (of N)" under it + a LOST chip and a "▼ dropped to 0" mark.
// The LOST chip, the mark and the morning line all read admin/search-source-zero.js, so they cannot disagree. Counts and fixed words only. Pure: nights in, HTML out.
// "People who read it" = measured people with a row for the Find jobs step (step_yield: employer sites, job boards, free job APIs), which works today; other sources say "not sent yet" (the night does not send sources[word].read yet, parked).
// Guard: test/unit/admin/search/search-source-trend.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {BLIND, OWN, SOURCE_NAMES} from './search-finish.js';
import {MIN_READ, WATCHED, nightOf, statusOf} from './search-source-zero.js';
import {figure, tipOf} from './viz-core.js';

export const TREND_STYLE = `${CHIP_STYLE}
.st-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}.st-panel{border:1px solid var(--vz-line,#262c33);border-radius:10px;padding:10px 12px;min-width:0}.st-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.st-head h3{margin:0;font-size:14.5px}
.st-big{margin:2px 0 4px;font-size:13.5px}.st-svg{width:100%;height:auto;display:block}.st-bad{fill:#ff5a4f}.st-key{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0}.st-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
@media(max-width:900px){.st-grid{grid-template-columns:1fr}}`;

const DAYS = 14, FINDER_STEP = {employer_sites: 'employer_sites', job_boards: 'job_boards', free_job_apis: 'free_job_apis'};
const TONE = {employer_sites: 's1', job_boards: 's3', free_job_apis: 's4', web_search: 's5', eures: 'off'};
const RED = '#ff5a4f', W = 640, TOP = 16, HR = 96, HS = 34, L = 34, R = 8;
const name = source => (source === 'eures' ? 'EURES · side check' : SOURCE_NAMES[source] || source);
const dayAfter = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The people of a night who read a Find jobs step: measured people with a step_yield row for it; null = the night sent no step_yield at all (never a 0).
function readOf(night, source) {
  const step = FINDER_STEP[source];
  if (!step || !(night.rows || []).some(row => row.stepYield?.length)) return null;
  return night.rows.filter(row => !BLIND.includes(row.kind) && (row.stepYield || []).some(item => item.step === step)).length;
}

/** One source's 14 days (oldest first): {day, gap} for a day with no stored night, else {day, state, right, readers, read, total}. `state` is the shared rule's (off = no count to judge from). */
export function daysOf(nights, source) {
  const byNight = new Map(nights.map(night => [night.night, night])), last = nights[0]?.night;
  if (!last) return [];
  return Array.from({length: DAYS}, (_, i) => dayAfter(last, i - DAYS + 1)).map(day => {
    const night = byNight.get(day);
    if (!night) return {day, gap: true};
    const item = nightOf(night, source);
    return {day, state: item.state, right: item.right, readers: item.readers, read: readOf(night, source), total: night.rows.length};
  });
}

const tipOfDay = (item, source) => {
  if (item.gap) return `${item.day} · no night stored`;
  const read = item.read == null ? '' : ` · read by ${item.read} of ${item.total}`;
  if (item.state === 'off') return `${item.day} · right jobs not sent yet (fewer than ${MIN_READ} people sent a count${source === 'eures' ? ', or EURES was off' : ''})${read}`;
  return `${item.day} · ${item.right} right jobs from ${plural(item.readers, 'person')}${read}`;
};

function svgOf(days, source, status) {
  const step = (W - L - R) / days.length, bw = step * 0.62, tone = `var(--${TONE[source] || 's1'})`;
  const top = Math.max(10, Math.ceil(Math.max(0, ...days.map(item => item.right || 0)) / 10) * 10), y0 = TOP + HR, ys = y0 + 26, H = ys + HS + 22;
  const yOf = value => y0 - (HR * value) / top, finder = Boolean(FINDER_STEP[source]);
  const grid = [0, top / 2, top].map(value => `<line x1="${L}" x2="${W - R}" y1="${yOf(value).toFixed(1)}" y2="${yOf(value).toFixed(1)}" class="vz-grid"/><text x="${L - 6}" y="${(yOf(value) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${value}</text>`).join('');
  const total = Math.max(0, ...days.map(item => item.total || 0));
  const strip = finder
    ? `<line x1="${L}" x2="${W - R}" y1="${ys}" y2="${ys}" class="vz-grid"/><line x1="${L}" x2="${W - R}" y1="${ys + HS}" y2="${ys + HS}" class="vz-grid"/><text x="${L - 6}" y="${ys + 4}" text-anchor="end" class="vz-axis">${total}</text><text x="${L - 6}" y="${ys + HS + 4}" text-anchor="end" class="vz-axis">0</text>`
    : '';
  const label = `<text x="${L}" y="9" class="vz-axis">right jobs per night</text><text x="${L}" y="${y0 + 18}" class="vz-axis">people who read it${finder ? ` (of ${total || 18})` : ': not sent yet'}</text>`;
  const cols = days.map((item, i) => {
    const x = L + i * step + (step - bw) / 2, hit = `<rect x="${(L + i * step).toFixed(1)}" y="${TOP}" width="${step.toFixed(1)}" height="${ys + HS - TOP}" fill="transparent"/>`;
    let bar = '', read = '';
    if (item.gap) bar = `<rect x="${x.toFixed(1)}" y="${TOP}" width="${bw.toFixed(1)}" height="${HR}" rx="3" fill="none" stroke="var(--off)" stroke-dasharray="3 3" opacity=".6"/>`;
    else if (item.state === 'off') bar = `<rect x="${x.toFixed(1)}" y="${y0 - 3}" width="${bw.toFixed(1)}" height="3" rx="1.5" fill="none" stroke="var(--off)" stroke-dasharray="2 2"/>`;
    else if (item.state === 'zero') bar = `<rect x="${x.toFixed(1)}" y="${y0 - 3}" width="${bw.toFixed(1)}" height="3" rx="1.5" class="st-bad"/><text x="${(x + bw / 2).toFixed(1)}" y="${y0 - 7}" font-size="9.5" font-weight="700" text-anchor="middle" class="st-bad">0</text>`;
    else bar = `<rect x="${x.toFixed(1)}" y="${yOf(item.right).toFixed(1)}" width="${bw.toFixed(1)}" height="${((HR * item.right) / top).toFixed(1)}" rx="2" fill="${tone}"/>`;
    if (finder && item.read != null) read = item.read === 0 ? `<rect x="${x.toFixed(1)}" y="${ys + HS - 3}" width="${bw.toFixed(1)}" height="3" rx="1.5" class="st-bad"/>` : `<rect x="${x.toFixed(1)}" y="${(ys + HS - (HS * item.read) / total).toFixed(1)}" width="${bw.toFixed(1)}" height="${((HS * item.read) / total).toFixed(1)}" rx="2" fill="${tone}" opacity=".55"/>`;
    const day = i % 2 === 0 || i === days.length - 1 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${ys + HS + 15}" text-anchor="middle" class="vz-axis">${esc(item.day.slice(5).replace('-', '/'))}</text>` : '';
    return `<g${tipOf(tipOfDay(item, source))}>${hit}${bar}${read}${day}</g>`;
  }).join('');
  const at = status.dropped ? days.findIndex(item => item.day === status.since) : -1;
  const mark = at < 0 ? '' : (() => {
    const x = L + at * step, end = at > days.length - 5;
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${TOP - 4}" y2="${ys + HS}" stroke="${RED}" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${(x + (end ? -5 : 5)).toFixed(1)}" y="${TOP + 9}" font-size="10.5" font-weight="700" text-anchor="${end ? 'end' : 'start'}" class="st-bad">▼ dropped to 0</text>`;
  })();
  return `<svg class="st-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name(source))}: right jobs and people who read it, per night">${grid}${label}${strip}${cols}${mark}</svg>`;
}

function headOf(source, status) {
  if (status.state === 'unseen') return source === 'eures' ? chip('SIDE CHECK · not read on nights with EURES off', 'off') : chip('right jobs: not sent yet', 'off');
  if (status.state === 'lost') return chip(`✖ LOST · 0 right jobs since ${esc(status.since)} · night ${status.run} in a row`, 'bad');
  return chip('✔ reading', 'good');
}

function bigOf(status) {
  if (status.state === 'unseen') return '<span class="muted">No night has sent a count for it yet; the bars fill from the night that does.</span>';
  const {latest} = status, zero = status.state === 'lost';
  return `<b${zero ? ' class="st-bad"' : ''}>${latest.right}</b> right jobs from <b>${latest.readers}</b> people <span class="muted">· night ${esc(latest.night)}</span>`;
}

const cellOf = item => (item.gap || item.state === 'off' ? '<span class="muted">–</span>' : `${item.right}${item.read == null ? '' : ` <span class="muted">(${item.read})</span>`}`);

/**
 * The card.
 * @param {object[]} runs the tab's runs, newest first; only stored nights (not by-hand runs) are read
 */
export function sourceTrendCard(runs) {
  const nights = (runs || []).filter(run => !run.hand), head = '<h2>📉 Each source, night after night</h2>';
  const panels = WATCHED.map(source => ({source, days: daysOf(nights, source), status: statusOf(nights, source)}));
  if (!panels.some(({days}) => days.some(item => !item.gap && (item.state !== 'off' || item.read != null)))) {
    return `<section class="card vz" id="finish-nights">${head}<p>${chip('not sent yet', 'off')} <span class="muted small">no night has sent a count per source yet: right jobs per source start with the next night, the people who read it (employer sites, job boards, free job APIs) with any night that sends the step yield</span></p></section>`;
  }
  const table = `<div class="scroll"><table><tr><th>Night</th>${panels.map(({source}) => `<th class="num">${esc(name(source))}</th>`).join('')}</tr>${[...panels[0].days].reverse().map((_, i) => {
    const row = panels.map(({days}) => [...days].reverse()[i]);
    return `<tr><td>${esc(row[0].day)}</td>${row.map(item => `<td class="num">${cellOf(item)}</td>`).join('')}</tr>`;
  }).join('')}</table></div>`;
  const grid = `<div class="muted small">Right jobs per night (bars, from 0) and the people who read it · a night with no upload is a dashed gap, a count not sent a dashed tick, never a flat line · a source at 0 is a red 0 and says LOST · own sources: ${OWN.map(name).join(', ')}; EURES is a side check, LinkedIn is typed by hand</div>
<div class="st-grid">${panels.map(({source, days, status}) => `<section class="st-panel" id="source-${source}"><div class="st-head"><h3>${esc(name(source))}</h3>${headOf(source, status)}</div><div class="st-big">${bigOf(status)}</div>${svgOf(days, source, status)}</section>`).join('')}</div>
<div class="st-key small muted"><span><i style="background:${RED}"></i>0 right jobs</span><span><i style="border:1px dashed var(--off)"></i>no night stored / not sent</span><span><i style="background:var(--s1);opacity:.55"></i>people who read it</span></div>`;
  return `<section class="card vz" id="finish-nights">${head}${figure({chart: grid, table})}</section>`;
}
