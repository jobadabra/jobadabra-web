// The per-step counters of the nightly Search check (owner, 6 Nov 2026: "go ahead. Fix the search"; the brief's step 2: "the search only improves"): per persona, what each step of the press did, each against that
// persona's own median of the last HISTORY nights of the same persona count. REPORT ONLY: a drop is a line in the night's head and a mark on the persona's row; it never makes a night `dropped` and never alerts
// (admin/search-night-judge.js reasons stay the three it had). Pure. The press's own log lines are the source (tools/persona-search/funnel.py in the public repo); counts and seconds only, no job or employer text.
// Why (6 Nov 2026, "no guessed number", the PR gate's QUALITY_SPREADS rule): a drop is a value more than SPREADS spreads (the larger of the sample standard deviation and the square root of the median) below the median of the nights before (above it for the seconds to the first job); a median of 0 has nothing below it, so it stays silent by arithmetic.
import {median} from './product-quality.js';

export const HISTORY = 7, SPREADS = 2, MORE = 3;
/** The counters, in the order the tab shows them: `key` in a stored row's `counters`, `short` for the head line and the cell, `long` for the help text; `lowerIsBetter` for the seconds to the first job. */
export const COUNTERS = [
  {key: 'eu', short: 'EU jobs', cell: 'EU read', long: 'EU portal jobs our read listed'},
  {key: 'sites', short: 'Employer sites', cell: 'sites', long: 'employer sites read'},
  {key: 'titles', short: 'Titles', cell: 'titles', long: 'titles asked'},
  {key: 'ai', short: 'AI calls', cell: 'AI', long: 'AI calls'},
  {key: 'firstS', short: 'First job', cell: 'first job', long: 'seconds to the first job', lowerIsBetter: true, unit: ' s'}];
const isNum = value => typeof value === 'number' && Number.isFinite(value);

/** Sample standard deviation (n - 1), as the gate's statistics.stdev. */
export function spreadOf(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/**
 * One persona's counters against its own earlier nights.
 * @param {object} row a stored row of the night being judged ({persona, counters})
 * @param {object[]} sameRows the same persona's rows of the earlier nights of the same persona count, newest first (already cut to HISTORY nights)
 * @returns {{counterUsual: object, drops: string[]}} counterUsual[key] = the median (null in the first week); drops = the keys that fell beyond the spread. A row with no counters claims nothing.
 */
export function judgeCounters(row, sameRows) {
  const usual = {}, drops = [];
  for (const {key, lowerIsBetter} of COUNTERS) {
    const mine = sameRows.map(other => other?.counters?.[key]).filter(isNum);
    usual[key] = mine.length >= HISTORY ? median(mine) : null;
    if (!row.counters || usual[key] == null) continue;
    const now = row.counters[key], line = Math.max(spreadOf(mine), Math.sqrt(usual[key])) * SPREADS;   // Why (6 Nov 2026, review): seven identical nights have spread 0 and a drop of 1 would fire every night; a count's own noise is at least its square root (Poisson), no hand-picked number
    if (lowerIsBetter ? (now == null || now > usual[key] + line) : (isNum(now) && now < usual[key] - line)) drops.push(key);
  }
  return {counterUsual: usual, drops};
}

const shown = (item, value) => (value == null ? 'none' : `${value}${item.unit || ''}`);
/** One line per counter that dropped in some persona, newest night's words: "EU jobs: p10 200 → 0, p1 146 → 0 (+3 more)"; [] when nothing dropped. */
export function counterNotes(rows) {
  return COUNTERS.flatMap(item => {
    const hit = rows.filter(row => (row.drops || []).includes(item.key));
    if (!hit.length) return [];
    const named = hit.slice(0, MORE).map(row => `${String(row.label).split(' ')[0]} ${shown(item, row.counterUsual[item.key])} → ${shown(item, row.counters[item.key])}`);
    return [`${item.short}: ${named.join(', ')}${hit.length > MORE ? ` (+${hit.length - MORE} more)` : ''}`];
  });
}
