// The ONE verdict on a night of the nightly Search check (owner, 6 Nov 2026: "Where should I see it the search dropped? Am I getting alerted? I'm not alerted"). The "Night search" tab's red row, the
// Report only chip and the alert all read judgeNight(), so they cannot disagree about whether a night dropped. Pure: admin/search-night.js stores the nights, this file only judges them.
// A night dropped when ANY of three things holds (a stored night = {night, rows: [{kind, local, seconds, ranOut}]}, admin/search-night.js):
//   measured        fewer than two thirds of its personas were measured (kind 'measured' = the press found at least one right job: the gate's own 🟢);
//   local           relevant local jobs (the night's personas pooled) fell below the median of the last HISTORY nights minus SPREADS spreads; silent until HISTORY earlier nights WITH THE SAME NUMBER OF PERSONAS exist;
//   employer-sites  time ran out for employer sites in two thirds or more of its personas.
// Why (6 Nov 2026, owner: "6 personas is too narrow" -> 18, all fixed so each has its own 7-night baseline): every threshold is a share of the night's own personas, not a number (6 -> 4 as before, 18 -> 12), and a night is only
// compared with earlier nights of the same persona count: a pooled count of 6 personas is no baseline for 18 (a changed set starts its own first week, silent). Each persona also gets its own `usual` (median of its right local jobs
// over the same earlier nights): shown on the tab, never an alarm on its own.
// Why (6 Nov 2026, owner's rule of 27 Oct 2026 "no guessed number", tools/persona-search/gate.py QUALITY_SPREADS): the drop line for jobs is the PR gate's own rule, a spread being the sample standard deviation
// of the nights before, so no number here was picked by hand; the median (the brief's word) keeps one empty night from moving the line. A median of 0 has no line below it, so it stays silent: the other two reasons catch a search that finds nothing.
import {median, round} from './product-quality.js';
import {HISTORY, SPREADS, counterNotes, judgeCounters, spreadOf} from './search-night-counters.js';

export {HISTORY, SPREADS};   // one source for the 7 nights and the 2 spreads: the per-step counters (admin/search-night-counters.js) use the same
export const EMPLOYER_SITES = 'employer sites';
/** Two thirds of the night's personas, rounded up: the fewest that must be measured, and the fewest whose employer sites running out of time is a drop (6 -> 4, 18 -> 12). */
export const twoThirds = total => Math.ceil((2 * total) / 3);
const isNum = value => typeof value === 'number' && Number.isFinite(value);

// The six personas' right local jobs added up; null when no row has a count (never a 0 that looks measured).
function pooledLocal(rows) {
  const counts = rows.map(row => row.local).filter(isNum);
  return counts.length ? counts.reduce((sum, count) => sum + count, 0) : null;
}

/**
 * One night judged against the nights before it.
 * @param {object} night a stored night (admin/search-night.js clean())
 * @param {object[]} [earlier] the nights BEFORE this one, newest first
 * @returns {object} the night plus {total, measured, local, out, seconds, usual, floor, reasons: ('measured'|'local'|'employer-sites')[], dropped, notes} and each row with its own `usual` (null in the first week) and its step counters' `counterUsual` and `drops`; usual and floor are null while the first week lasts. `notes` (the counters that fell, one line each) is report only: it never adds a reason
 */
export function judgeNight(night, earlier = []) {
  const rows = night.rows || [], total = rows.length, measured = rows.filter(row => row.kind === 'measured').length, local = pooledLocal(rows);
  const out = rows.filter(row => (row.ranOut || []).includes(EMPLOYER_SITES)).length, need = twoThirds(total);
  const same = earlier.filter(item => (item.rows || []).length === total).slice(0, HISTORY);   // only nights of the same persona count are a baseline
  const history = same.map(item => pooledLocal(item.rows || [])).filter(isNum);
  const usual = history.length >= HISTORY ? median(history) : null, floor = usual > 0 ? usual - SPREADS * spreadOf(history) : null;
  const mineOf = row => same.map(item => (item.rows || []).find(other => other.persona === row.persona));
  const own = row => { const mine = mineOf(row).map(other => other?.local).filter(isNum); return {...row, usual: mine.length >= HISTORY ? median(mine) : null, ...judgeCounters(row, mineOf(row))}; };
  const reasons = [];
  if (total && measured < need) reasons.push('measured');
  if (floor != null && local != null && local < floor) reasons.push('local');
  if (total && out >= need) reasons.push('employer-sites');
  const judgedRows = rows.map(own);
  return {...night, rows: judgedRows, notes: counterNotes(judgedRows), total, measured, local, out, need, seconds: median(rows.map(row => row.seconds).filter(isNum)), usual, floor: floor == null ? null : round(floor, 1), reasons, dropped: reasons.length > 0};
}

/** Every stored night judged against the ones before it only (newest first in, the same order out). */
export const judgeAll = nights => nights.map((night, index) => judgeNight(night, nights.slice(index + 1)));

/** What a dropped night says, one line each, in plain words with its numbers (the tab's red chips, the Report only line). */
export function reasonWords(verdict) {
  const words = {
    measured: `only ${verdict.measured} of ${verdict.total} measured (under ${verdict.need})`,
    local: `relevant local jobs ${verdict.local}, under ${verdict.floor} (usual ${verdict.usual})`,
    'employer-sites': `time ran out for employer sites in ${verdict.out} of ${verdict.total} (${verdict.need}+)`,
  };
  return verdict.reasons.map(reason => words[reason]);
}

/** The alert's text: counts only, no persona, job or employer name (the switchboard adds the Admin link). */
export function alertText(verdict) {
  const parts = [`measured ${verdict.measured} of ${verdict.total}`];
  if (verdict.reasons.includes('local')) parts.push(`relevant local jobs ${verdict.local} against a usual ${round(verdict.usual, 1)}`);
  if (verdict.reasons.includes('employer-sites')) parts.push(`employer sites out of time in ${verdict.out}`);
  return `🔎 Night search: ${parts.join(', ')}`;
}
