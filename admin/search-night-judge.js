// The ONE verdict on a night of the nightly Search check (owner, 6 Nov 2026: "Where should I see it the search dropped? Am I getting alerted? I'm not alerted"). The "Night search" tab's red row, the
// Report only chip and the alert all read judgeNight(), so they cannot disagree about whether a night dropped. Pure: admin/search-night.js stores the nights, this file only judges them.
// A night dropped when ANY of three things holds (a stored night = {night, rows: [{kind, local, seconds, ranOut}]}, admin/search-night.js):
//   measured        fewer than MIN_MEASURED of its personas were measured (kind 'measured' = the press found at least one right job: the gate's own 🟢);
//   local           relevant local jobs (the six personas pooled) fell below the median of the last HISTORY nights minus SPREADS spreads; silent until HISTORY earlier nights exist;
//   employer-sites  time ran out for employer sites in OUT_MIN or more personas.
// Why (6 Nov 2026, owner's rule of 27 Oct 2026 "no guessed number", tools/persona-search/gate.py QUALITY_SPREADS): the drop line for jobs is the PR gate's own rule, a spread being the sample standard deviation
// of the nights before, so no number here was picked by hand; the median (the brief's word) keeps one empty night from moving the line. A median of 0 has no line below it, so it stays silent: the other two reasons catch a search that finds nothing.
import {median, round} from './product-quality.js';

export const MIN_MEASURED = 4, OUT_MIN = 4, HISTORY = 7, SPREADS = 2, EMPLOYER_SITES = 'employer sites';
const isNum = value => typeof value === 'number' && Number.isFinite(value);

// Sample standard deviation (n - 1), as the gate's statistics.stdev.
function spreadOf(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}
// The six personas' right local jobs added up; null when no row has a count (never a 0 that looks measured).
function pooledLocal(rows) {
  const counts = rows.map(row => row.local).filter(isNum);
  return counts.length ? counts.reduce((sum, count) => sum + count, 0) : null;
}

/**
 * One night judged against the nights before it.
 * @param {object} night a stored night (admin/search-night.js clean())
 * @param {object[]} [earlier] the nights BEFORE this one, newest first
 * @returns {object} the night plus {total, measured, local, out, seconds, usual, floor, reasons: ('measured'|'local'|'employer-sites')[], dropped}; usual and floor are null while the first week lasts
 */
export function judgeNight(night, earlier = []) {
  const rows = night.rows || [], total = rows.length, measured = rows.filter(row => row.kind === 'measured').length, local = pooledLocal(rows);
  const out = rows.filter(row => (row.ranOut || []).includes(EMPLOYER_SITES)).length;
  const history = earlier.slice(0, HISTORY).map(item => pooledLocal(item.rows || [])).filter(isNum);
  const usual = history.length >= HISTORY ? median(history) : null, floor = usual > 0 ? usual - SPREADS * spreadOf(history) : null;
  const reasons = [];
  if (measured < MIN_MEASURED) reasons.push('measured');
  if (floor != null && local != null && local < floor) reasons.push('local');
  if (out >= OUT_MIN) reasons.push('employer-sites');
  return {...night, total, measured, local, out, seconds: median(rows.map(row => row.seconds).filter(isNum)), usual, floor: floor == null ? null : round(floor, 1), reasons, dropped: reasons.length > 0};
}

/** Every stored night judged against the ones before it only (newest first in, the same order out). */
export const judgeAll = nights => nights.map((night, index) => judgeNight(night, nights.slice(index + 1)));

/** What a dropped night says, one line each, in plain words with its numbers (the tab's red chips, the Report only line). */
export function reasonWords(verdict) {
  const words = {
    measured: `only ${verdict.measured} of ${verdict.total} measured (under ${MIN_MEASURED})`,
    local: `relevant local jobs ${verdict.local}, under ${verdict.floor} (usual ${verdict.usual})`,
    'employer-sites': `time ran out for employer sites in ${verdict.out} of ${verdict.total} (${OUT_MIN}+)`,
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
