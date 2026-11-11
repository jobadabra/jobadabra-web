// "What a search read" on the Finish line tab (owner, 11 Nov 2026, asked via [sa]: "where I'm going to see this in the Admin UI? Will be there any graph that its trend will improve after we merge this PR?"; option "Yes, add the card"):
// per run, how much ONE Find jobs search reads for the 18 fixed people: jobs listed in the person's places, employer sites read (of the employers in their places), titles judged. The median of the people, one panel per
// number from a zero baseline with its own scale (three units are never on one axis). No blind judge is in these numbers, so judge noise does not move them.
// Fields: `read` {listed, employers} (jobadabra tools/persona-search/gate.py: press local_jobs, funnel employers_in_places) and `counters` {sites, titles} (already stored); a count not sent is null = "not sent yet", never 0.
// A run with EURES on lists the EURES jobs too, so its `listed` bar is grey (as ownOf: never a mixed number). Counts and fixed words only. Pure: runs in, HTML out. Guard: test/unit/admin/search/search-finish-read.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {MARK_ROOM, countTicks, marksOf} from './viz-time.js';
import {TREND_STYLE as MARK_STYLE, markOf, prTable} from './search-night-trend.js';
import {figure, tipOf} from './viz-core.js';

/** The card's style: its chips and its panel grid (the chart colours come with the tab). Why (CI on #555, 11 Nov 2026): a module that draws chip() carries CHIP_STYLE, as admin-chips.test.js wants. */
export const READ_STYLE = `${CHIP_STYLE}${MARK_STYLE}
.rd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:10px}.rd-panel{border:1px solid var(--vz-line,#262c33);border-radius:10px;padding:10px 12px;min-width:0}
.rd-panel h3{margin:0;font-size:14.5px}.rd-big{margin:4px 0 2px;font-size:22px;font-weight:700;line-height:1.1}.rd-big small{font-size:13px;color:var(--vz-muted,#8d949c);font-weight:500}.rd-svg{width:100%;height:auto;display:block}`;

const RUNS = 14, W = 420, H = 150, BOX = {l: 38, r: 6, t: 8, b: 22};
const PANELS = [
  {key: 'listed', title: 'Jobs listed in their places', unit: 'jobs', tone: 's3', words: 'in their city or country, never worldwide remote'},
  {key: 'sites', title: 'Employer sites read', unit: 'sites', tone: 's1', words: 'of the employers in their places', of: 'employers'},
  {key: 'titles', title: 'Titles judged', unit: 'titles', tone: 's4', words: 'titles the AI was asked about'}];
const whole = value => (Number.isInteger(value) && value >= 0 ? value : null);
const who = (persona, label) => `<b>p${esc(persona)}</b> ${esc(String(label || '').replace(/^p\d+ /, ''))}`;
const cell = value => (value == null ? '<span class="chip off">not sent yet</span>' : Number(value).toLocaleString('en-US'));
const median = list => { const sorted = list.filter(value => value != null).sort((a, b) => a - b); if (!sorted.length) return null; const mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2); };

/** One row's read numbers, each whole or null: {listed, employers, sites, titles}. A row that sent none of them is all null. */
export function readOf(row) {
  return {listed: whole(row.read?.listed), employers: whole(row.read?.employers), sites: whole(row.counters?.sites), titles: whole(row.counters?.titles)};
}

/**
 * One run as the card's numbers: per number the median over the people who sent it, how many sent it, and for sites read the median of the employers in their places.
 * @param {object} run a stored night or by-hand run ({night, hand, eures, rows, prs}); only a night has a merge mark (admin/search-night-trend.js markOf), a by-hand run never
 * @returns {{night: string, hand: boolean, mark: {count: number, tip: string}|undefined, eures: string|undefined, total: number, listed: {median: number|null, n: number}, sites: {median: number|null, n: number, of: number|null}, titles: {median: number|null, n: number}}}
 */
export function runOf(run) {
  const reads = (run.rows || []).map(readOf), pick = key => reads.map(item => item[key]).filter(value => value != null);
  const one = key => ({median: median(pick(key)), n: pick(key).length});
  return {night: run.night, hand: !!run.hand, mark: run.hand ? undefined : markOf(run, run.night), eures: run.eures, total: (run.rows || []).length, listed: one('listed'), sites: {...one('sites'), of: median(pick('employers'))}, titles: one('titles')};
}

const tipOfRun = (item, panel) => {
  const part = item[panel.key], when = `${item.night}${item.hand ? ' · by hand' : ''}`;
  if (part.median == null) return `${when} · ${panel.title.toLowerCase()}: not sent yet`;
  const of = panel.of && part.of != null ? ` of ${part.of} employers in their places` : '';
  return `${when} · median ${part.median}${of} ${panel.unit} · ${part.n} of ${item.total} people${panel.key === 'listed' && item.eures === 'on' ? ' · EURES was on: the jobs include its own' : ''}`;
};

function svgOf(items, panel) {
  const room = items.some(item => item.mark) ? MARK_ROOM : 0, top = Math.max(0, ...items.flatMap(item => [item[panel.key].median || 0, item[panel.key].of || 0])), ticks = countTicks(top), max = ticks[ticks.length - 1] || 1;
  const T = BOX.t + room, ph = H - BOX.t - BOX.b, base = T + ph, pw = W - BOX.l - BOX.r, y = value => base - (ph * value) / max, slot = pw / items.length, bw = Math.min(26, slot * 0.62);
  const grid = ticks.map(tick => `<line x1="${BOX.l}" x2="${W - BOX.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" class="vz-grid"/><text x="${BOX.l - 5}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${tick}</text>`).join('');
  const bars = items.map((item, index) => {
    const part = item[panel.key], x = BOX.l + slot * index + (slot - bw) / 2, tone = panel.key === 'listed' && item.eures === 'on' ? 'var(--off)' : `var(--${panel.tone})`;
    let bar;
    if (part.median == null) bar = `<rect x="${x.toFixed(1)}" y="${base - 12}" width="${bw.toFixed(1)}" height="12" rx="2" fill="none" stroke="var(--off)" stroke-dasharray="2 2"/>`;
    else {
      const ghost = part.of != null ? `<rect x="${x.toFixed(1)}" y="${y(part.of).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - y(part.of)).toFixed(1)}" rx="2" fill="none" stroke="${tone}" stroke-dasharray="3 2" opacity=".7"/>` : '';
      const fill = item.hand ? `fill="none" stroke="${tone}" stroke-width="2"` : `fill="${tone}"`;
      bar = `${ghost}<rect x="${x.toFixed(1)}" y="${y(part.median).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, base - y(part.median)).toFixed(1)}" rx="2" ${fill}/>`;
    }
    const day = index % 2 === (items.length - 1) % 2 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H + room - 6}" text-anchor="middle" class="vz-axis">${esc(item.night.slice(5).replace('-', '/'))}</text>` : '';
    return `<g${tipOf(tipOfRun(item, panel))}><rect x="${(BOX.l + slot * index).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent"/>${bar}${day}</g>`;
  }).join('');
  const marks = marksOf(items, {x0: BOX.l, slot, top: MARK_ROOM - 2, bottom: base});   // the Night search trend's one mechanism (admin/viz-time.js), never a second one
  return `<svg class="rd-svg" viewBox="0 0 ${W} ${H + room}" role="img" aria-label="${esc(panel.title)}: the median of the people, per run">${grid}${bars}${marks}</svg>`;
}

function panelOf(items, panel) {
  const last = [...items].reverse().find(item => item[panel.key].median != null), part = last?.[panel.key];
  const big = !part ? chip('not sent yet', 'off')
    : `${Number(part.median).toLocaleString('en-US')}${part.of != null ? ` <small>of ${Number(part.of).toLocaleString('en-US')}</small>` : ''} <small>${panel.unit} · median of ${part.n}${part.n === last.total ? '' : ` of ${last.total}`} people</small>`;
  const note = last ? `${last.hand ? 'by-hand run' : 'night'} ${esc(last.night)}${panel.key === 'listed' && last.eures === 'on' ? ' · EURES on: includes its jobs' : ''}` : 'the next run that sends it starts the bars';
  return `<section class="rd-panel" id="read-${panel.key}"><h3>${esc(panel.title)}</h3><div class="rd-big">${big}</div><div class="muted small">${esc(panel.words)} · ${note}</div>${svgOf(items, panel)}</section>`;
}

function tableOf(run) {
  const body = run.rows.map(row => { const item = readOf(row); return `<tr><td>${who(row.persona, row.label)}</td><td class="num">${cell(item.listed)}</td><td class="num">${item.sites == null ? cell(null) : `${item.sites}${item.employers == null ? '' : ` <span class="muted">of ${item.employers}</span>`}`}</td><td class="num">${cell(item.titles)}</td></tr>`; }).join('');
  return `<div class="scroll"><table><tr><th>Person</th><th class="num">Jobs listed</th><th class="num">Employer sites read</th><th class="num">Titles judged</th></tr>${body}</table></div>`;
}

/**
 * The card.
 * @param {object[]} runs the tab's runs (nights and by-hand runs), newest first
 */
export function readCard(runs) {
  const head = '<h2>📖 What a search read</h2>', shown = (runs || []).filter(run => (run.rows || []).length).slice(0, RUNS).reverse(), items = shown.map(runOf);
  const note = '<div class="muted small">What one Find jobs search reads for the people, per run: the median of the people, each number from 0 with its own scale · no judge is in these numbers · a hollow bar was a by-hand run · grey = EURES was on (its jobs are in the count) · a dashed stub = not sent yet, never 0 · a dashed outline = the employers in their places</div>';
  const marked = items.some(item => item.mark), key = marked ? '<p class="muted small" style="margin:2px 0 0"><span class="mk-swatch">7</span> A mark on a night = that many PRs that changed the search code were merged since the night before (hover for the titles), so a step up is pinned to the merge that caused it. No mark = none.</p>' : '';
  if (!items.some(item => PANELS.some(panel => item[panel.key].median != null))) return `<section class="card vz" id="finish-read">${head}${note}<p>${chip('not sent yet', 'off')} <span class="muted small">no run has sent what its search read yet: the bars start with the next run that does</span></p></section>`;
  const newest = [...shown].reverse().find(run => PANELS.some(panel => runOf(run)[panel.key].median != null));
  const chart = `<div class="rd-grid">${PANELS.map(panel => panelOf(items, panel)).join('')}</div>`;
  return `<section class="card vz" id="finish-read">${head}${note}${key}${figure({chart, table: tableOf(newest), label: `Per person · ${newest.hand ? 'by-hand run' : 'night'} ${newest.night}`})}${prTable(shown.filter(run => !run.hand))}</section>`;
}
