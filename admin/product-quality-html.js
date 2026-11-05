// How the product-quality board (admin/product-quality-areas.js) is drawn on /admin/testing/report-only: the verdict band, then one card per area (owner, 5 Nov 2026, the approved sketch):
// the number, a better / same / worse chip with icon and word, the change line, the lines beneath, where it comes from. Only draws: no reader, no judging here.
// Every value is escaped; only `chart` (HTML a chart helper drew, 2/3) and the verdict icon (an emoji from admin/product-quality.js) are trusted HTML. The page puts BAND_STYLE and this QUALITY_STYLE (which carries CHIP_STYLE, as admin-chips.test.js asks of a chip file) in its own <style>. Guard: test/unit/admin/report/product-quality.test.js.
import {esc} from '../shared/html.js';
import {chip, CHIP_STYLE} from './chip.js';
import {verdictBand} from './verdict-band.js';
import {chartOf} from './product-quality-charts.js';

const ICON = {good: '✓', warn: '!', bad: '✕', none: '–'};
const TONE = {good: 'good', warn: 'warn', bad: 'bad', none: 'off'};

export const QUALITY_STYLE = `${CHIP_STYLE}
.qgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}@media(max-width:700px){.qgrid{grid-template-columns:1fr}}
.qc{display:grid;gap:8px;align-content:start;min-width:0}.qc .hd{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.qc .area{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}.qc .q{font-size:13px;color:#8d949c}
.qc .num{font-size:32px;font-weight:600;line-height:1.05;font-variant-numeric:tabular-nums}.qc .num small{font-size:14px;font-weight:400;color:#8d949c}.qc .lbl{font-size:13px;color:#8d949c}
.qc .sub{font-size:12.5px;color:#8d949c;display:grid;gap:2px}.qc .sub b{color:inherit;font-weight:600}.qc .src{font-size:11.5px;color:#6b7580}
.qc.nm{border-style:dashed;background:transparent}.qc.nm .num{font-size:20px;color:#8d949c}
.qc .vz{margin:2px 0}.qc .vz-more table{width:100%;border-collapse:collapse;font-size:12.5px}.qc .vz-more th,.qc .vz-more td{text-align:left;padding:3px 8px;border-bottom:1px solid var(--vz-line,#262c33)}.qc .vz-more .tw{max-height:260px;overflow:auto}
.qhead{margin:26px 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8d949c}.qhead .muted{text-transform:none;letter-spacing:0;font-weight:400}`;

const iconOf = tone => ICON[tone] ?? ICON.none, toneOf = tone => TONE[tone] ?? TONE.none;
const stateChip = area => chip(`${iconOf(area.tone)} ${esc(area.word)}`, toneOf(area.tone));

/** One area's card; `chart` is the HTML drawn between the number and the lines beneath ('' = none; trusted HTML). A card with no number is dashed: "not measured" says why, "too few installs" shows its count. */
export function areaCard(area, chart = '') {
  const empty = area.value == null, unmeasured = empty && area.trend === 'none';
  const number = !empty ? `<div><span class="num">${esc(area.value)}<small>${esc(area.unit)}</small></span> <span class="lbl">${esc(area.label)}</span></div>`
    : unmeasured ? `<div class="num">not measured</div><div class="lbl">${esc(area.label)}</div>` : `<div class="num">${esc(area.label)}</div>`;
  const lines = [`<span><b>${esc(area.delta)}</b></span>`, ...area.subs.map(line => `<span>${esc(line)}</span>`)].join('');
  return `<section class="card qc${empty ? ' nm' : ''}" id="q-${esc(area.id)}"><div class="hd"><span class="area">${esc(area.area)}</span>${stateChip(area)}</div>`
    + `<div class="q">${esc(area.question)}</div>${number}${chart}<div class="sub">${lines}</div>${area.src ? `<div class="src">from ${esc(area.src)}</div>` : ''}</section>`;
}

// What the owner asked for that nothing collects yet: a dashed card each, with where it could come from.
const gapCard = gap => `<section class="card qc nm"><div class="hd"><span class="area">${esc(gap.area)}</span>${chip('– not measured', 'off')}</div><div class="q">${esc(gap.question)}</div><div class="num">not collected yet</div><div class="sub"><span>${esc(gap.why)}</span></div></section>`;

/** The board: the verdict band, the five area cards (each with its chart), the two "not collected yet" cards. `quality` = qualityModel(inputs). */
export function board(quality) {
  const {verdict, areas, gaps} = quality;
  const band = verdictBand({icon: verdict.icon, headline: verdict.headline, chips: verdict.chips.map(item => ({label: `${iconOf(item.tone)} ${item.area} · ${item.word}`, tone: toneOf(item.tone)})),
    note: 'Last 7 days against the 7 before. Every number is collected data; a source with none says "not measured", never 0.'});
  return `<div class="qhead">📈 How are we doing <span class="muted">· what a job seeker feels, one number per area</span></div>${band}<div class="qgrid">${areas.map(area => areaCard(area, chartOf(area))).join('')}${gaps.map(gapCard).join('')}</div>`;
}
