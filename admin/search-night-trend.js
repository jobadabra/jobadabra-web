// The Night search tab's trend (owner, 7 Nov 2026: "do I have a graph/trend for the job searches? same, in Admin"): day by day, over the stored nights, how many candidates the nightly check found a right job for
// (measured, N of total), how many right local jobs it found in all (the judge's `local`), and for how many candidates the employer sites finished in time (total minus `out`). Nothing is judged here: every number and every
// "dropped" is the night's own verdict from admin/search-night-judge.js judgeAll, the one the red band, the Report only chip and the alert read, so the chart cannot disagree with them.
// Why (6 Nov 2026, as admin/product-quality-search.js): nights with a different number of candidates are different series, never one line: 6 candidates found 4 vs 18 found 4 is not the same night, and the judge
// compares a night only with nights of its own count. One chart pair per count, the newest count first. Pure. Guard: test/unit/admin/search/search-night-trend.test.js.
import {esc} from '../shared/html.js';
import {chip} from './chip.js';
import {VIZ_TOOLTIP, columns, figure, line} from './viz.js';
import {reasonWords} from './search-night-judge.js';

const DAY = 86400000;
const isNum = value => typeof value === 'number' && Number.isFinite(value);
const days = (from, to) => { const out = []; for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY) out.push(new Date(at).toISOString().slice(0, 10)); return out; };

/**
 * The nights grouped by candidate count, newest count first: [{total, current, days: [{day, night | null}]}], each group's days continuous from its first to its last night (a day with no stored night is a gap, never a 0).
 * @param {object[]|null} judged the judged nights, newest first (admin/search-night-judge.js judgeAll)
 */
export function groups(judged) {
  const by = new Map(), taken = new Set((judged || []).map(night => night.night));   // every stored night's date: a day with a night of another count is not a missing night
  for (const night of judged || []) by.set(night.total, [...(by.get(night.total) || []), night]);
  return [...by].map(([total, list], index) => {
    const byDay = new Map(list.map(night => [night.night, night]), []), sorted = list.map(night => night.night).sort();
    return {total, current: index === 0, days: days(sorted[0], sorted.at(-1)).map(day => ({day, night: byDay.get(day) || null, elsewhere: taken.has(day)}))};
  });
}

const tipOf = (day, night, total, elsewhere = false) => (!night ? `${day} · ${elsewhere ? `no night with ${total} candidates (the night of this day had another number)` : 'no night stored'}`
  : `${day} · found ${night.measured} of ${total} · right local jobs ${night.local ?? 'not counted'} · employer sites in time ${total - night.out} of ${total}${night.dropped ? ` · DROPPED: ${reasonWords(night).join('; ')}` : ''}`);

/** The charts of one group: found and in time as columns on one 0..total count axis, the right local jobs as a line from 0. */
export function groupHtml(group) {
  const {total, days: span} = group, columnsOf = span.map(({day, night, elsewhere}) => ({day, values: night ? [night.measured, total - night.out] : [null, null], tip: tipOf(day, night, total, elsewhere)}));
  const local = span.map(({day, night, elsewhere}) => ({day, value: night && isNum(night.local) ? night.local : null, tip: tipOf(day, night, total, elsewhere)}));
  const dropped = span.filter(item => item.night?.dropped);
  const found = columns(columnsOf, [{name: `Candidates found (of ${total})`, tone: 's1'}, {name: `Employer sites in time (of ${total})`, tone: 's3'}], {whole: true, labelEvery: Math.max(1, Math.ceil(span.length / 7))});
  const jobs = line(local, {tone: 's2', percent: false, whole: true, name: 'Relevant local jobs', labelEvery: Math.max(1, Math.ceil(span.length / 7))});
  return `<h3 style="margin:14px 0 2px;font-size:14px">${total} candidates ${group.current ? chip('current set', 'good') : chip('an earlier set: not compared with the current one', 'off')}</h3>
<p class="muted small" style="margin:0">Candidates found a right job for, and employer sites that finished in time</p>${figure({chart: found})}
<p class="muted small" style="margin:8px 0 0">Right local jobs found, all candidates added up</p>${figure({chart: jobs})}
<p class="small" style="margin:6px 0 0">${dropped.length ? `${chip('✕ dropped', 'bad')} ${dropped.map(item => `<span title="${esc(reasonWords(item.night).join('; '))}">${esc(item.day.slice(5).replace('-', '/'))}</span>`).join(' · ')}` : chip('✓ no night dropped', 'good')}</p>`;
}

/** The card: one chart pair per candidate count; '' when no night is stored (the tab already says so). */
export function trendSection(judged) {
  const all = groups(judged);
  if (!all.length) return '';
  return `<section class="card" id="night-trend"><h2>📈 Day by day</h2><p class="muted small" style="margin:0">One point a night · a day with no stored night is a gap · a dropped night is the same verdict as the band above and the alert</p>${all.map(groupHtml).join('')}${VIZ_TOOLTIP}</section>`;   // the tab's one tooltip script: without it the points' exact numbers never show (nothing else on this page emits it)
}
