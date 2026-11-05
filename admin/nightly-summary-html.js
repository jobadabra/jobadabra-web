// How the nightly summary (admin/nightly-summary.js) is drawn, once, for the two pages that show it: the Testing Overview cards and the Testing → Scheduled rows (owner, 1 Nov 2026).
// A job = its name, last night's key number as a chip (icon + word for the verdict), and 14 cells, one per night, oldest first: a bar for a rate or a count (a line marks its bar or
// its median), a dot for a green/red night; grey for a night with no result. Only draws; no reader, no table. Guard: test/unit/admin/nightly-summary.test.js.
import {esc} from '../shared/html.js';

// Own chip classes (nchip): /admin/operations/scheduled has its own .chip colours (shared/.. schedules.js CSS), the Overview uses admin/chip.js; this draws the same on both.
const STATUS = {good: ['✓ ok', 'good'], warn: ['! watch', 'warn'], bad: ['✕ off', 'bad'], none: ['◷ no data', 'off']};
const chip = (word, tone) => `<span class="nchip ${tone}">${esc(word)}</span>`;
const UNIT = {'beta-clock': ' min', 'night-clock': ' min'};
const pct = value => `${Math.round(value * 100)}%`;

// What one night says in the cell's tooltip.
function pointText(job, point) {
  if (point.value == null && point.ok == null) return `${point.day}: no result`;
  const verdict = point.ok == null ? '' : point.ok ? ' · ok' : ' · not ok';
  if (point.value == null) return `${point.day}: ${point.ok ? 'green' : 'red'}`;
  const rate = job.bar && job.bar.value != null && job.bar.value <= 1 && job.id !== 'agent-coding';
  return `${point.day}: ${rate ? pct(point.value) : `${point.value}${UNIT[job.id] || ''}`}${verdict}`;
}

/** The 14 cells of one job; a numeric series is bars scaled to the series (rates 0..1 to the full height), a green/red one is a row of dots. */
export function trendBars(job) {
  const numeric = job.series.some(point => point.value != null);
  const rate = numeric && job.series.every(point => point.value == null || point.value <= 1) && job.id !== 'agent-coding' && !UNIT[job.id];
  const top = rate ? 1 : Math.max(1, ...job.series.map(point => point.value ?? 0), job.median ?? 0);
  const line = job.bar && job.bar.value != null ? job.bar.value : job.median ?? null;
  const cells = job.series.map(point => {
    const tone = point.ok === true ? 'ok' : point.ok === false ? 'no' : point.value != null ? 'num' : 'gap';
    const height = !numeric ? (tone === 'gap' ? 30 : 100) : point.value == null ? 8 : Math.max(10, Math.round((point.value / top) * 100));
    return `<i class="${tone}" style="height:${height}%" title="${esc(pointText(job, point))}"></i>`;
  }).join('');
  const mark = numeric && line != null ? `<s style="bottom:${Math.round((line / top) * 100)}%" title="${esc(job.bar ? job.bar.label : `median ${line} min`)}"></s>` : '';
  const words = job.series.filter(point => point.value != null || point.ok != null).length;
  return `<div class="nbars${numeric ? '' : ' dots'}" role="img" aria-label="${esc(`${job.title}: ${words} of ${job.series.length} nights have a result`)}">${cells}${mark}</div>`;
}

/** One job as a block: title, key number, verdict chip, the 14 nights, and the line under it. */
export function trendHtml(job) {
  const [word, tone] = STATUS[job.status] || STATUS.none, badge = job.status === 'none' && job.value !== '–' ? '' : chip(word, tone);   // a number with no bar to judge it by (a wall clock) shows no verdict chip, never "no data"
  const bars = job.series.length ? trendBars(job) : '<div class="nbars none" aria-hidden="true"></div>';
  const bar = job.bar ? `<span class="muted small">bar: ${esc(job.bar.label)}</span>` : '';
  return `<div class="nt"><div class="nhead"><span class="ntitle">${esc(job.title)}</span> <b>${esc(job.value)}</b> ${badge}</div>${bars}<div class="muted small">${esc(job.sub)}${bar ? ` · ${bar}` : ''}</div></div>`;
}

/**
 * A Scheduled row's jobs as ONE short line of chips (owner, 2 Nov 2026: "now it's too crowded"): what is off by name, what has no data by name (a count from 3), the ok ones as a count,
 * and a number with no verdict (a wall clock) as "night 10.5 min". The 14-night blocks live in detailHtml, one toggle away.
 */
export function summaryLine(jobs) {
  const list = jobs || [], parts = [], named = (items, icon, word, tone) => (items.length > 2 ? [`${icon} ${items.length} ${word}`] : items.map(job => `${icon} ${job.title} ${word}`)).map(text => chip(text, tone));
  const noData = list.filter(job => job.value === '–'), measured = list.filter(job => job.value !== '–');
  const by = status => measured.filter(job => job.status === status);
  parts.push(...named(by('bad'), '✕', 'off', 'bad'), ...named(by('warn'), '!', 'watch', 'warn'), ...named(noData, '◷', 'no data', 'off'));
  if (by('good').length) parts.push(chip(`✓ ${by('good').length} ${by('good').length > 1 ? 'green' : 'ok'}`, 'good'));
  parts.push(...by('none').map(job => `<span class="nnum">${esc(job.title.replace(/ wall clock$/i, '').toLowerCase())} <b>${esc(job.value)}</b></span>`));
  return parts.length ? `<div class="nline">${parts.join(' ')}</div>` : '';
}

/** The full-width row under a Scheduled row (hidden until its toggle is pressed): every job as a card with its 14 nights, and the way on to the Report only page. */
export const detailHtml = (jobs, colspan, id, reportHref) => (jobs && jobs.length
  ? `<tr class="ndetail" id="${esc(id)}" hidden><td colspan="${colspan}"><div class="ngrid">${jobs.map(job => `<section class="card rjob">${trendHtml(job)}</section>`).join('')}</div>${reportHref ? `<p class="small"><a href="${esc(reportHref)}">All measurements → Report only</a></p>` : ''}</td></tr>` : '');

/** The toggle in the row's summary cell; the script that flips it is NIGHTLY_SCRIPT. */
export const toggleHtml = (jobs, id) => (jobs && jobs.length ? `<button type="button" class="ntoggle" aria-expanded="false" aria-controls="${esc(id)}">Details <span aria-hidden="true">▾</span></button>` : '');

/** The jobs with a number as one short text ("Beta wall clock 29.9 min · Real Notion green"); a job with no data is left out. */
export const reportWords = jobs => (jobs || []).filter(job => job.value !== '–').map(job => `${job.title} ${job.value}`).join(' · ');

/** The one line a proof card keeps for its report-only numbers (owner, 2 Nov 2026): the numbers in words, linking to the Report only page at `href` ('' = that page is not in the menu: no line). */
export const reportLine = (jobs, href) => (jobs && jobs.length && href ? `<div class="rline"><a href="${esc(href)}">📊 Report only</a><span class="muted small">${esc(reportWords(jobs) || 'no night stored yet')}</span></div>` : '');

// Why (2 Nov 2026, owner: "make this 2 columns per row, not 3"): exactly two cards a row on a desktop, one on a phone (.rgrid, .ngrid); a column count that follows the width gave three at 1440.
export const NIGHTLY_STYLE = `.nchip{display:inline-block;border:1px solid #2a2f37;border-radius:999px;padding:1px 9px;font-size:12px;line-height:18px;white-space:nowrap;font-weight:400;color:#8d949c;background:transparent}
.nchip.good{border-color:#1f5a45;color:#3fb68b;background:#11261e}.nchip.warn{border-color:#4a3c1c;color:#f5b54a;background:#2a2312}.nchip.bad{border-color:#5a2326;color:#e5484d;background:#2a1213}
.nt{display:grid;gap:3px;font-size:13px;min-width:0}.nt .nhead{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.nt .ntitle{color:#8d949c;white-space:nowrap}
.nbars{position:relative;display:flex;align-items:flex-end;gap:3px;height:28px;min-width:120px;max-width:260px}.nbars i{flex:1 1 0;min-width:5px;border-radius:2px;background:#3a424c}
.nbars i.ok{background:#3fb68b}.nbars i.no{background:#e5484d}.nbars i.num{background:#6f8fb3}.nbars i.gap{background:transparent;border:1px solid #3a424c}.nbars.dots{height:12px;align-items:center}.nbars.dots i{height:100%;border-radius:50%;flex:0 0 9px}
.nbars.none{border-bottom:1px dashed #3a424c;height:12px}.rline{display:flex;gap:4px 10px;flex-wrap:wrap;align-items:baseline;font-size:13px}.rline a{text-decoration:none}
.nbars s{position:absolute;left:0;right:0;border-top:1px dashed #f5b54a;pointer-events:none}
.nline{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:13px}.nnum{color:#8d949c;white-space:nowrap}.nnum b{color:inherit;font-weight:600}
.ntoggle{margin-top:6px;font:inherit;font-size:12px;color:#8d949c;background:none;border:1px solid #2a2f37;border-radius:999px;padding:1px 10px;cursor:pointer}.ntoggle:hover{color:inherit}.ntoggle[aria-expanded=true] span{display:inline-block;transform:rotate(180deg)}
.ndetail>td{padding:4px 0 14px}@media (max-width:940px){.ndetail .ngrid,.ndetail p{position:sticky;left:0;width:calc(100vw - 54px)}}   /* a phone scrolls the wide table sideways: the detail stays in view */
.ndetail[hidden]{display:none}.ndetail p{margin:8px 0 0}
.rjob{padding:12px 16px;min-width:0}.rjob .nbars{max-width:100%}
.rgrid,.ngrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media (max-width:640px){.rgrid,.ngrid{grid-template-columns:minmax(0,1fr)}}`;

/** Opens and closes a Scheduled row's detail row; without script the noscript style shows every detail row and hides the toggle. */
export const NIGHTLY_SCRIPT = `document.addEventListener('click',e=>{const b=e.target.closest('.ntoggle');if(!b)return;const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));document.getElementById(b.getAttribute('aria-controls')).hidden=!open;});`;
export const NIGHTLY_NOSCRIPT = '<noscript><style>.ndetail[hidden]{display:table-row!important}.ntoggle{display:none}</style></noscript>';
