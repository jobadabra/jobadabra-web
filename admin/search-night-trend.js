// The Night search tab's trend (owner, 7 Nov 2026: "do I have a graph/trend for the job searches? same, in Admin"): day by day, over the stored nights, how many candidates the nightly check found a right job for
// (measured, N of total), how many right local jobs it found in all (the judge's `local`), and for how many candidates the employer sites finished in time (total minus `out`). Nothing is judged here: every number and every
// "dropped" is the night's own verdict from admin/search-night-judge.js judgeAll, the one the red band, the Report only chip and the alert read, so the chart cannot disagree with them.
// Why (6 Nov 2026, as admin/product-quality-search.js): nights with a different number of candidates are different series, never one line: 6 candidates found 4 vs 18 found 4 is not the same night, and the judge
// compares a night only with nights of its own count. One chart pair per count, the newest count first. Pure. Guard: test/unit/admin/search/search-night-trend.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {VIZ_TOOLTIP, columns, figure, line} from './viz.js';
import {euresOf, reasonWords, seriesOf} from './search-night-judge.js';

const DAY = 86400000;
const isNum = value => typeof value === 'number' && Number.isFinite(value);
const days = (from, to) => { const out = []; for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY) out.push(new Date(at).toISOString().slice(0, 10)); return out; };

/** The card's own style: the chips it draws (the page keeps its own CHIP_STYLE; this guard, test/unit/shared/admin-chips.test.js, wants the style named in the file that draws chips). */
export const TREND_STYLE = `${CHIP_STYLE}
.vz-mark-n{fill:var(--vz-ink);font-size:9.5px;font-weight:700}.vz-mark:focus{outline:none}.vz-mark:focus rect{stroke:var(--vz-text);stroke-width:1.5}
.mk-swatch{display:inline-block;min-width:16px;text-align:center;background:#9085e9;color:#0b0d10;border-radius:4px;padding:0 4px;font-weight:700;font-size:11px}:root[data-theme=light] .mk-swatch{background:#6250d6;color:#fff}
#tip{white-space:pre-line}   /* the PR list of a mark is one line a PR */
.pr-list{margin:0;padding:0;list-style:none}.pr-list li{margin:2px 0}`;

/**
 * The nights grouped by candidate count and EURES switch, newest first: [{total, eures, current, days: [{day, night | null}]}], each group's days continuous from its first to its last night (a day with no stored night is a gap, never a 0).
 * @param {object[]|null} judged the judged nights, newest first (admin/search-night-judge.js judgeAll)
 */
export function groups(judged) {
  const by = new Map(), taken = new Set((judged || []).map(night => night.night));   // every stored night's date: a day with a night of another count is not a missing night
  // Why (10 Nov 2026, jobadabra [oe] 1/3): a night without EURES is another series as well (the judge compares it only with its own kind), so the switch is never one line falling.
  for (const night of judged || []) { const key = `${night.total} ${seriesOf(night)}`; by.set(key, [...(by.get(key) || []), night]); }
  return [...by].map(([, list], index) => {
    const [total, eures] = [list[0].total, euresOf(list[0])];
    const byDay = new Map(list.map(night => [night.night, night]), []), sorted = list.map(night => night.night).sort();
    return {total, eures, current: index === 0, days: days(sorted[0], sorted.at(-1)).map(day => ({day, night: byDay.get(day)?.notRun ? null : byDay.get(day) || null, elsewhere: taken.has(day), notRun: !!byDay.get(day)?.notRun}))};
  });
}

const tipOf = (day, night, total, elsewhere = false, notRun = false) => (!night ? `${day} · ${notRun ? 'not run (no AI answered): not a zero' : elsewhere ? `no night with ${total} candidates (the night of this day had another number)` : 'no night stored'}`
  : `${day} · found ${night.measured} of ${total} · right local jobs ${night.local ?? 'not counted'} · employer sites in time ${total - night.out} of ${total}${night.dropped ? ` · DROPPED: ${reasonWords(night).join('; ')}` : ''}`);

const TIP_LINES = 8;   // PRs named in a mark's tooltip; the table under the charts has them all
const countOf = night => (Array.isArray(night?.prs) ? night.prs.length + (Number(night.prsMore) || 0) : 0);

/**
 * The mark of a night: {count, tip} when search PRs were merged between the build of the night before and this night's, else undefined (no PR = no mark, never a "0" mark; a night whose builds are unknown has none either).
 * @param {object|null} night a judged night (admin/search-night-judge.js) with its `prs` (admin/search-night-prs.js)
 */
export function markOf(night, day) {
  const count = countOf(night);
  if (!count) return undefined;
  const shown = night.prs.slice(0, TIP_LINES), rest = count - shown.length;
  return {count, tip: [`${day} · ${count} search PR${count === 1 ? '' : 's'} merged since the night before:`, ...shown.map(pr => `${pr.n ? `#${pr.n}` : 'direct push'} ${pr.title}`), ...(rest > 0 ? [`and ${rest} more (listed under the charts)`] : [])].join('\n')};
}

/** The charts of one group: found and in time as columns on one 0..total count axis, the right local jobs as a line from 0. */
export function groupHtml(group) {
  const {total, days: span} = group, columnsOf = span.map(({day, night, elsewhere, notRun}) => ({day, values: night ? [night.measured, total - night.out] : [null, null], tip: tipOf(day, night, total, elsewhere, notRun), mark: markOf(night, day)}));
  const local = span.map(({day, night, elsewhere, notRun}) => ({day, value: night && isNum(night.local) ? night.local : null, tip: tipOf(day, night, total, elsewhere, notRun), mark: markOf(night, day)}));
  const dropped = span.filter(item => item.night?.dropped);
  const found = columns(columnsOf, [{name: `Candidates found (of ${total})`, tone: 's1'}, {name: `Employer sites in time (of ${total})`, tone: 's3'}], {whole: true, gapLabel: 'no night with this number of candidates', labelEvery: Math.max(1, Math.ceil(span.length / 7))});
  const jobs = line(local, {tone: 's2', percent: false, whole: true, name: 'Relevant local jobs', labelEvery: Math.max(1, Math.ceil(span.length / 7))});
  return `<h3 style="margin:14px 0 2px;font-size:14px">${total} candidates${group.eures === 'off' ? ' · EURES off' : ''} ${group.current ? chip('current set', 'good') : chip('an earlier set: not compared with the current one', 'off')}</h3>
<p class="muted small" style="margin:0">Candidates found a right job for, and employer sites that finished in time</p>${figure({chart: found})}
<p class="muted small" style="margin:8px 0 0">Right local jobs found, all candidates added up</p>${figure({chart: jobs})}
<p class="small" style="margin:6px 0 0">${dropped.length ? `${chip('✕ dropped', 'bad')} ${dropped.map(item => `<span title="${esc(reasonWords(item.night).join('; '))}">${esc(item.day.slice(5).replace('-', '/'))}</span>`).join(' · ')}` : chip('✓ no night dropped', 'good')}</p>`;
}

const link = n => (n ? `<a href="https://github.com/jobadabra/jobadabra/pull/${esc(n)}">#${esc(n)}</a>` : 'direct push');
/** The text behind the marks: one row per night that has search PRs, every PR with its number and title (the marks' tooltips name the first few). '' when no night has one. */
export function prTable(judged) {
  const rows = (judged || []).filter(night => countOf(night)).map(night => `<tr><td>${esc(night.night)}</td><td class="num">${countOf(night)}</td><td><ul class="pr-list">${night.prs.map(pr => `<li>${link(pr.n)} ${esc(pr.title)}</li>`).join('')}${night.prsMore ? `<li class="muted">and ${esc(night.prsMore)} more</li>` : ''}</ul></td></tr>`);
  return rows.length ? `<details class="vz-more"><summary>Search PRs behind the marks</summary><div class="scroll"><table><tr><th>Night</th><th class="num">PRs</th><th>Merged since the night before</th></tr>${rows.join('')}</table></div></details>` : '';
}

/** The card: one chart pair per candidate count; '' when no night is stored (the tab already says so). */
export function trendSection(judged) {
  const all = groups(judged), marked = (judged || []).some(night => countOf(night));
  if (!all.length) return '';
  return `<section class="card" id="night-trend"><h2>📈 Day by day</h2><p class="muted small" style="margin:0">One point a night · a day with no stored night is a gap · a dropped night is the same verdict as the band above and the alert</p>${marked ? `<p class="muted small" style="margin:2px 0 0"><span class="mk-swatch">7</span> A mark on a night = that many PRs that changed the search code were merged since the night before (hover for the titles). No mark = none.</p>` : ''}${all.map(groupHtml).join('')}${prTable(judged)}${VIZ_TOOLTIP}</section>`;   // the tab's one tooltip script: without it the points' exact numbers never show (nothing else on this page emits it)
}
