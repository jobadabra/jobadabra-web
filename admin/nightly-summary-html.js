// How the nightly summary (admin/nightly-summary.js) is drawn, once, for the two pages that show it: the Testing Overview cards and the Testing → Scheduled rows (owner, 1 Nov 2026).
// A job = its name, last night's key number as a chip (icon + word for the verdict), and 14 cells, one per night, oldest first: a bar for a rate or a count (a line marks its bar or
// its median), a dot for a green/red night; grey for a night with no result. Only draws; no reader, no table. Guard: test/unit/admin/nightly-summary.test.js.
import {esc} from '../shared/html.js';
import {dayWords} from './nightly-summary.js';

// Own chip classes (nchip): /admin/operations/scheduled has its own .chip colours (shared/.. schedules.js CSS), the Overview uses admin/chip.js; this draws the same on both.
const STATUS = {good: ['✓ ok', 'good'], warn: ['! watch', 'warn'], bad: ['✕ off', 'bad'], none: ['◷ no data', 'off']};
const chip = (word, tone) => `<span class="nchip ${tone}">${esc(word)}</span>`;
const UNIT = {'beta-clock': ' min', 'night-clock': ' min'};
const pct = value => `${Math.round(value * 100)}%`;

// Why (5 Nov 2026): the dots class is `ndots`, never `dots`: the Scheduled page's own `.dots i` (admin/schedules.js, the Last 14 column) painted these dots as 8px green circles with the red one inside.
// How a series is measured: a rate runs 0..100%, a count 0..3 at least (one bug is a third of the plot, never all of it), minutes up to the next round number.
function scaleOf(job) {
  const values = job.series.map(point => point.value).filter(value => value != null), most = Math.max(0, ...values), minutes = Boolean(UNIT[job.id]);
  const rate = !job.unit && !minutes && values.length > 0 && most <= 1;   // counts declare `unit: 'count'` (agent coding, the finders); every other job under 1 is a rate
  if (rate) return {kind: 'rate', top: 1, label: '100%'};
  if (minutes || values.some(value => !Number.isInteger(value))) { const top = niceCeil(Math.max(most, job.median ?? 0)); return {kind: 'minutes', top, label: String(top)}; }
  const top = Math.max(3, Math.ceil(Math.max(most, job.bar?.value ?? 0)));
  return {kind: 'count', top, label: String(top)};
}
const niceCeil = value => { const unit = 10 ** Math.floor(Math.log10(value || 1)); return Number([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(step => step * unit).find(step => step >= value).toPrecision(3)); };   // toPrecision: 3 * 0.1 is 0.30000000000000004

// What one night says in the cell's tooltip.
function pointText(job, point, scale) {
  const day = dayWords(point.day);
  if (point.value == null && point.ok == null) return `${day}: no result stored`;
  const verdict = point.ok == null ? '' : point.ok ? ' · ok' : ' · not ok';
  if (point.value == null) return `${day}: ${point.ok ? 'green' : 'red'}`;
  return `${day}: ${scale.kind === 'rate' ? pct(point.value) : `${point.value}${UNIT[job.id] || ''}`}${verdict}`;
}

/**
 * One job's nights as a small column chart (owner, 5 Nov 2026: "this is bad visual representation… use better graphs"). A numeric series is thin columns growing from a baseline on a
 * labelled scale, with the first and last day under it; a zero draws nothing, a night with no result is a dotted tick (different from a zero), a series that is all zero says so in words.
 * A green/red series is one row of dots on the same time axis. Each night is a full-height hover slot (day and value), larger than its mark.
 */
export function trendBars(job) {
  const numeric = job.series.some(point => point.value != null), scale = scaleOf(job), measured = job.series.filter(point => point.value != null || point.ok != null).length;
  const top = scale.top, line = job.bar && job.bar.value != null ? job.bar.value : job.median ?? null;
  const cells = job.series.map(point => {
    const tone = point.ok === true ? 'ok' : point.ok === false ? 'no' : point.value != null ? 'num' : 'gap';
    const zero = numeric && point.value === 0, height = numeric && point.value ? Math.min(100, Math.max(1, (point.value / top) * 100)).toFixed(1) : 0;
    return `<i class="${tone}${zero ? ' zero' : ''}" style="--h:${height}%" title="${esc(pointText(job, point, scale))}"></i>`;
  }).join('');
  // Why (5 Nov 2026, code-review): "none" is only for counts; a rate or a wall clock that is all zero is a result (0% of planted bugs caught), never calm.
  const quiet = numeric && scale.kind === 'count' && job.series.every(point => point.value == null || point.value === 0);
  const mark = numeric && line != null && line <= top ? `<s style="bottom:${Math.round((line / top) * 100)}%" title="${esc(job.bar ? job.bar.label : `median ${line} min`)}"></s>` : '';
  const calm = quiet ? `<span class="nquiet">${measured === job.series.length ? `none in ${measured} days` : `none on the ${measured} day${measured === 1 ? '' : 's'} measured`}</span>` : '';
  const first = dayWords(job.series[0].day), last = dayWords(job.series.at(-1).day);
  const newest = [...job.series].reverse().find(point => point.value != null || point.ok != null);
  const label = `${job.title}: ${measured} of ${job.series.length} nights have a result${newest ? `, newest ${pointText(job, newest, scale)}` : ''}`;   // the values themselves are hover text only; the newest one is read aloud
  const gutter = numeric ? `<span class="nscale" aria-hidden="true"><span>${esc(scale.label)}</span><span>0</span></span>` : '';
  return `<div class="nchart${numeric ? '' : ' ndots'}" role="img" style="--n:${job.series.length}" aria-label="${esc(label)}"><div class="nrow">${gutter}<div class="nbars${numeric ? '' : ' ndots'}">${cells}${mark}${calm}</div></div><div class="naxis"><span>${esc(first)}</span><span>${esc(last)}</span></div></div>`;
}

/** One job as a block: title, key number, verdict chip, the 14 nights, and the line under it. */
export function trendHtml(job) {
  const [word, tone] = STATUS[job.status] || STATUS.none, badge = job.status === 'none' && job.value !== '–' ? '' : chip(word, tone);   // a number with no bar to judge it by (a wall clock) shows no verdict chip, never "no data"
  const bars = job.series.length ? trendBars(job) : '<div class="nbars none" aria-hidden="true"></div>';
  const bar = job.bar ? `<span class="muted small"><span class="nkey"></span>bar: ${esc(job.bar.label)}</span>` : '';   // the key names the dashed line in the plot
  const note = job.note ? ` · ${esc(job.note)}` : '';   // a muted aside on the same line (a finder's "last filed by 1 Nov")
  return `<div class="nt"><div class="nhead"><span class="ntitle">${esc(job.title)}</span> <b>${esc(job.value)}</b> ${badge}</div>${bars}<div class="muted small">${esc(job.sub)}${note}${bar ? ` · ${bar}` : ''}</div></div>`;
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
.nchart{display:grid;gap:3px;max-width:100%}.nrow{display:flex;gap:6px;align-items:stretch}.nscale{display:flex;flex-direction:column;justify-content:space-between;width:30px;flex:none;text-align:right;font-size:11px;line-height:11px;color:#8d949c}
.nbars{position:relative;display:flex;align-items:stretch;gap:2px;height:60px;flex:1 1 0;min-width:120px;border-bottom:1px solid #3a424c;background:linear-gradient(#20252c,#20252c) top/100% 1px no-repeat}
.nbars i{position:relative;flex:1 1 0;min-width:4px}.nbars i::after{content:'';position:absolute;bottom:0;left:8%;right:8%;height:max(var(--h),3px);border-radius:3px 3px 0 0;background:#3a424c}
.nbars i.ok::after{background:#3fb68b}.nbars i.no::after{background:#e5484d}.nbars i.num::after{background:#6f8fb3}.nbars i.zero::after{height:0}
.nbars i.gap::after{height:0;border-top:2px dotted #4a525c;bottom:0;left:1px;right:1px;border-radius:0;background:none}.nbars i:hover{background:#ffffff0d}
.nbars.ndots{height:22px;border-bottom:0;background:none;align-items:center}.nbars.ndots i{height:100%}.nbars.ndots i::after{left:50%;right:auto;bottom:auto;top:50%;width:9px;height:9px!important;margin:-4.5px 0 0 -4.5px;border-radius:50%}
.nbars.ndots i.gap::after{border:1px solid #3a424c;background:none;width:9px;height:9px!important;left:50%;right:auto}
.nquiet{position:absolute;left:0;right:0;bottom:6px;text-align:center;font-size:12px;color:#8d949c;pointer-events:none}
.naxis{display:flex;justify-content:space-between;font-size:11px;color:#8d949c;margin-left:36px}.nchart.ndots .naxis{margin-left:0;padding:0 calc(50% / var(--n))}
.nbars.none{border-bottom:1px dashed #3a424c;height:12px;background:none}.rline{display:flex;gap:4px 10px;flex-wrap:wrap;align-items:baseline;font-size:13px}.rline a{text-decoration:none}
.nbars s{position:absolute;left:0;right:0;border-top:1px dashed #f5b54a;pointer-events:none}.nkey{display:inline-block;width:14px;border-top:1px dashed #f5b54a;margin-right:5px;vertical-align:middle}
.nline{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:13px}.nnum{color:#8d949c;white-space:nowrap}.nnum b{color:inherit;font-weight:600}
.ntoggle{margin-top:6px;font:inherit;font-size:12px;color:#8d949c;background:none;border:1px solid #2a2f37;border-radius:999px;padding:1px 10px;cursor:pointer}.ntoggle:hover{color:inherit}.ntoggle[aria-expanded=true] span{display:inline-block;transform:rotate(180deg)}
.ndetail>td{padding:4px 0 14px}@media (max-width:940px){.ndetail .ngrid,.ndetail p{position:sticky;left:0;width:calc(100vw - 54px)}}   /* a phone scrolls the wide table sideways: the detail stays in view */
.ndetail[hidden]{display:none}.ndetail p{margin:8px 0 0}
.rjob{padding:12px 16px;min-width:0}
.rgrid,.ngrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media (max-width:640px){.rgrid,.ngrid{grid-template-columns:minmax(0,1fr)}}`;

/** Opens and closes a Scheduled row's detail row; without script the noscript style shows every detail row and hides the toggle. */
export const NIGHTLY_SCRIPT = `document.addEventListener('click',e=>{const b=e.target.closest('.ntoggle');if(!b)return;const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));document.getElementById(b.getAttribute('aria-controls')).hidden=!open;});`;
export const NIGHTLY_NOSCRIPT = '<noscript><style>.ndetail[hidden]{display:table-row!important}.ntoggle{display:none}</style></noscript>';
