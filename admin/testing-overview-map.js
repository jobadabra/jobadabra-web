// Testing → Overview's two pictures (owner, 1 Nov 2026: "a graph summarizing better visually everything"; the cards stay below): one bar of all methods by their last
// run (green / red / no run / planned), and the health map: one row per method, grouped by ring, one cell per day for 14 days, then its last run and its bugs caught.
// Status is never colour alone: a red cell carries ✕, a green one ✓, an amber one !, a day with no run is an empty outline, a day the data does not reach is hatched. Every cell has a tooltip.
import {esc} from '../shared/html.js';
import {chip, CHIP_STYLE} from './chip.js';
import {MAP_DAYS} from './testing-overview-history.js';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayName = day => { const d = new Date(`${day}T12:00:00Z`); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one bar: every item by its last run, the segments in a fixed order (green, red, none, planned), each labelled with its count and word. `text` renames it for another page (Testing → Scheduled: jobs, "no run yet", "disabled"). */
export function summaryBar(counts, text = {}) {
  const parts = [['green', counts.green, '✓ green'], ['red', counts.red, '✕ red'], ['none', counts.none, text.none || '◷ no run stored'], ['planned', counts.planned, text.planned || '◌ planned']].filter(([, n]) => n);
  const total = parts.reduce((sum, [, n]) => sum + n, 0) || 1;
  return `<section class="card sbar"><h2>${esc(text.title || `${counts.live + counts.planned} methods · by their last run`)}</h2>
<div class="bar" role="img" aria-label="${esc(parts.map(([, n, word]) => `${n} ${word.slice(2)}`).join(', '))}">${parts.map(([kind, n, word]) => `<i class="s-${kind}" style="flex:${n} 1 0" title="${esc(`${n} ${word.slice(2)}`)}"><b>${n}</b></i>`).join('')}</div>
<div class="keys">${parts.map(([kind, n, word]) => `<span><i class="k s-${kind}"></i>${esc(word)} <b>${n}</b></span>`).join('')}</div>
<small class="muted">${text.note ?? `${Math.round(100 * counts.green / total)}% of all methods green on their last run, planned ones counted as not green yet.`}</small></section>`;
}

const cellTitle = cell => `${dayName(cell.day)} · ${cell.state === 'unknown' ? 'not stored (the snapshot keeps the newest runs only)' : cell.state === 'none' ? 'no run'
  : cell.note || (cell.greens + cell.reds > 1 ? `${cell.greens} green · ${cell.reds} red (${cell.pct}%)` : cell.greens ? plural(cell.greens, 'green run') : plural(cell.reds, 'red run'))}`;
const GLYPH = {green: '✓', amber: '!', red: '✕', none: '', unknown: ''};
export const cellHtml = cell => {
  const inner = `<span class="c c-${cell.state}" title="${esc(cellTitle(cell))}" aria-label="${esc(cellTitle(cell))}">${GLYPH[cell.state]}</span>`;
  return `<td class="d">${cell.url ? `<a href="${esc(cell.url)}">${inner}</a>` : inner}</td>`;
};
const LAST = {green: ['✓ green', 'good'], red: ['✕ red', 'bad'], none: ['◷ no run', 'off']};

function rowHtml(card) {
  const label = `<a href="#m-${esc(card.id)}">${card.icon} ${esc(card.title)}</a>`;
  if (card.kind === 'planned') return `<tr class="planned"><th scope="row">${label}</th><td class="d planned-span" colspan="${MAP_DAYS}"><span>planned · not built yet</span></td><td>${chip('◌ planned', 'off')}</td><td class="muted">—</td></tr>`;
  if (card.state === 'link') return `<tr><th scope="row">${label}</th><td class="d planned-span" colspan="${MAP_DAYS}"><span>${card.pending ? 'its own page is being built' : 'see its own page'}</span></td><td class="muted">—</td><td class="muted">—</td></tr>`;
  const bugs = card.bugs.why ? '<span class="muted">—</span>' : `<b>${esc(card.bugs.text)}</b>${card.bugs.window ? ` <span class="muted">· ${esc(card.bugs.window)}</span>` : ''}`;
  return `<tr class="${card.state === 'red' ? 'is-red' : ''}"><th scope="row">${label}</th>${card.days.map(cellHtml).join('')}<td>${chip(...LAST[card.state])}</td><td class="bugs-cell">${bugs}</td></tr>`;
}

/** The header cells of a 14-day map (weekday over date, "now" on today). */
export const dayHeads = days => days.map((day, i) => { const d = new Date(`${day}T12:00:00Z`); return `<th class="d${i === days.length - 1 ? ' today' : ''}" title="${esc(dayName(day))}"><span>${WEEKDAY[d.getUTCDay()]}</span>${i === days.length - 1 ? 'now' : d.getUTCDate()}</th>`; }).join('');
/** The health map: rings as row groups, methods as rows, the last 14 days as cells (oldest left, today right). */
export function healthMap(model, days) {
  const head = dayHeads(days);
  return `<section class="card hmap"><h2>Every method, day by day · last ${MAP_DAYS} days</h2>
<div class="keys"><span><i class="c c-green">✓</i>green above 98% of runs</span><span><i class="c c-amber">!</i>some red, 80–98%</span><span><i class="c c-red">✕</i>red below 80%</span><span><i class="c c-none"></i>no run that day</span><span><i class="c c-unknown"></i>not stored</span><span class="muted">a day is its share of green runs, cancelled runs not counted, one run is green or red · click a cell for its run (newest red, else newest), a name for its card</span></div>
<div class="scroll"><table><thead><tr><th class="m">Method</th>${head}<th>Last run</th><th>Bugs caught</th></tr></thead>
${model.rings.map(ring => `<tbody><tr class="ring-row"><th colspan="${MAP_DAYS + 3}">${ring.icon} ${esc(ring.title)}</th></tr>${ring.cards.map(rowHtml).join('')}</tbody>`).join('')}</table></div></section>`;
}

// The bar and its key alone (Testing → Scheduled keeps its own .chip, so it takes this and not CHIP_STYLE).
export const BAR_STYLE = `.sbar .bar{display:flex;gap:2px;height:30px;margin:10px 0 8px}.sbar .bar i{display:flex;align-items:center;padding:0 10px;border-radius:4px;min-width:28px;font-style:normal}
.sbar .bar b{font-size:13px;color:#0b0d10}.s-green{background:#3fb68b}.s-red{background:#e5484d}.s-red b,.s-none b,.s-planned b{color:#f4efe3!important}.s-none{background:#3a4048}
.s-planned{background:repeating-linear-gradient(135deg,#1b2027 0 6px,#262c33 6px 12px);border:1px dashed #3a4048}
.keys{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#c9c3b6;align-items:center;margin:2px 0 8px}.keys>span{display:inline-flex;gap:6px;align-items:center}.keys i.k{width:12px;height:12px;border-radius:3px;display:inline-block}`;
export const MAP_STYLE = `${CHIP_STYLE}
${BAR_STYLE}
.hmap table{border-collapse:separate;border-spacing:0;width:100%;min-width:760px}.hmap th,.hmap td{border-top:0;padding:3px 2px;font-size:13px;vertical-align:middle}
.hmap thead th{font-size:11px;color:#8d949c;font-weight:500;text-align:center;line-height:1.2}.hmap thead th.m{text-align:left}.hmap thead th span{display:block;opacity:.7}.hmap thead th.today{color:#f5b54a}
.hmap tbody th{text-align:left;font-weight:500;white-space:nowrap;padding-right:10px}.hmap tbody th a{color:#f4efe3;text-decoration:none}.hmap tbody th a:hover{color:#f5b54a}
.hmap .ring-row th{padding:14px 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}
.hmap td.d{width:24px;text-align:center}.hmap td.d a{text-decoration:none}.c{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;font-size:12px;font-weight:700;font-style:normal;line-height:1;box-sizing:border-box}
.c-green{background:#3fb68b;color:#0b0d10}.c-amber{background:#f5b54a;color:#0b0d10}.c-red{background:#e5484d;color:#fff}.c-none{border:1px solid #232930;opacity:.6}.c-unknown{background:repeating-linear-gradient(135deg,#171b21 0 3px,#1f242b 3px 6px);opacity:.7}
.hmap td.d a:hover .c,.hmap td.d .c:hover{outline:2px solid #f4efe3;outline-offset:1px}
.hmap tr.is-red th a{color:#ff8f84}.hmap td.planned-span span{display:block;border:1px dashed #3a4048;border-radius:4px;padding:2px 8px;color:#8d949c;font-size:12px;text-align:left}
.hmap tr.planned th a{color:#8d949c}.hmap td.bugs-cell{white-space:nowrap;padding-left:10px}.hmap td{padding-left:4px}`;
