// The ONE rule for "a source brought no right job" over the stored nights (owner, 11 Nov 2026, asked via AskUserQuestion: "Build as drawn (Recommended)"; before it, after job boards gave 0 jobs on a first Find jobs since 26 Oct
// unseen for two weeks: "And how did we discover it? Do we have a graph in Admin that tells this ?"). The source chart's LOST chip and its "dropped to 0" mark (admin/search-source-trend.js) and the morning line
// (admin/search-night.js ingest) all read statusOf()/zeroNow() here, so the chart and the message cannot disagree about whether a source is at 0. Pure: stored nights in, words and counts out.
// Why (11 Nov 2026, sa's answers): a night is "switched on" for a source only when at least MIN_READ measured people sent a count for it that night: tools/persona-search/lost.py MIN_READ (=6, its `unread` cause, the
// public repo's CI) is this number's twin, kept as a second copy on purpose (no shared module across the repos); this one reads the stored nights across nights, lost.py reads one run's verdict, and this never reads lost.py's `open` list.
// A night that is not switched on (no row for the source, fewer than MIN_READ readers, a night that did not run, EURES off for the EURES row) is "off": it neither fires nor counts and it does not break a run.
// LinkedIn is never watched (typed by hand). Known limit: a row with 0 jobs cannot yet tell "read, found nothing" from "not read" (the night does not send sources[word].read, parked), so the line fires on both.
import {sourceZeroCard} from '../shared/owner-cards.js';
import {BLIND, OWN, SOURCE_NAMES} from './search-finish.js';
import {euresOf, notRunOf} from './search-night-judge.js';

export const MIN_READ = 6, WINDOW = 14;   // WINDOW = the nights the chart draws (admin/search-source-trend.js): a source last counted before it is stale, not lost (Gitar on #559, 11 Nov 2026)
// Why (11 Nov 2026, sa's decision on the fill-18 run 43088269080, where free job APIs and web search brought 0 right jobs to all 15 measured people): a source is WATCHED, so the LOST chip and the morning line judge it, only
// when it is known to read: employer sites, job boards (their jobs include the free APIs' and the web search's) and EURES on its nights. Free job APIs and web search stay DRAWN (their zeros are shown) but unjudged,
// because a LOST alarm on them would be false every morning. THEY JOIN `WATCHED` WHEN A RUN SHOWS THEM ABOVE 0 (a night with right jobs for them in the verdict): add the word here and a test line.
export const WATCHED = ['employer_sites', 'job_boards', 'eures'];
export const DRAWN = [...OWN, 'eures'];
const isCount = value => Number.isInteger(value) && value >= 0;

/**
 * One source on one night: {state: 'off'|'zero'|'some', readers, right}. `readers` = measured people with a sent count for the source (a person whose count was not sent is not a reader, never a 0).
 * @param {object} night a stored night (admin/search-night.js clean()): {eures, state, rows: [{kind, sources}]}
 * @param {string} source one of DRAWN (any other word, LinkedIn included, is always 'off'); an unwatched one still gets its state here, but statusOf and zeroNow never judge it
 */
export function nightOf(night, source) {
  const off = {state: 'off', readers: 0, right: null};
  if (!night || !DRAWN.includes(source) || notRunOf(night) || (source === 'eures' && euresOf(night) !== 'on')) return off;
  const counts = (night.rows || []).filter(row => !BLIND.includes(row.kind)).map(row => row.sources?.[source]?.right).filter(isCount);
  if (counts.length < MIN_READ) return off;
  const right = counts.reduce((sum, count) => sum + count, 0);
  return {state: right === 0 ? 'zero' : 'some', readers: counts.length, right};
}

/**
 * Where a source stands over the stored nights, newest first: {state: 'lost'|'reading'|'stale'|'unwatched'|'unseen', run, since, dropped, latest}.
 * `run` = nights in a row at 0 counted from the newest night that was switched on (off nights skipped); `since` = the first night of that run; `dropped` = the run follows a night with right jobs
 * (the chart's "dropped to 0" mark); `latest` = the newest switched-on night {night, readers, right}; 'unseen' = no night was ever switched on for it; 'unwatched' = drawn but not judged (not in WATCHED); 'stale' = its latest switched-on night is WINDOW or more days older than the
 * newest stored night, so a source that stopped being sent weeks ago is not shown as lost with a run that never advances (Gitar on #559).
 */
export function statusOf(nights, source) {
  let run = 0, since = null, dropped = false, latest = null;
  for (const night of nights) {
    const item = nightOf(night, source);
    if (item.state === 'off') continue;
    latest = latest || {night: night.night, readers: item.readers, right: item.right};
    if (item.state === 'some') { dropped = run > 0; break; }
    run += 1; since = night.night;
  }
  const stale = latest && nights.length && (Date.parse(nights[0].night) - Date.parse(latest.night)) / 86400000 >= WINDOW;
  const watched = WATCHED.includes(source);
  return {state: !latest ? 'unseen' : stale ? 'stale' : !watched ? 'unwatched' : run ? 'lost' : 'reading', run: watched ? run : 0, since: watched ? since : null, dropped: watched && dropped, latest};
}

/**
 * The sources at 0 on the night just uploaded, for the morning line: [{source, run, readers, total}] (run counts that night); [] when `night` is not the newest stored night (an older night filled in late is never news)
 * or no source is at 0 on it. A night that did not switch a source on says nothing about it.
 * @param {object[]} nights the stored nights, newest first, the uploaded one included
 * @param {string} night the uploaded night's date
 */
export function zeroNow(nights, night) {
  if (!nights.length || nights[0].night !== night) return [];
  return WATCHED.flatMap(source => {
    const here = nightOf(nights[0], source);
    return here.state === 'zero' ? [{source, run: statusOf(nights, source).run, readers: here.readers, total: nights[0].rows.length}] : [];
  });
}

/**
 * The morning line for the night just uploaded (one card, one row per source at 0, the count rising; sent also when the night is otherwise fine): {text, state, sources} or null when nothing is at 0.
 * `state` carries the run counts, so a second upload of the same night is held and the next night (a higher count) is told again.
 */
export function zeroAlert(nights, night) {
  const now = zeroNow(nights, night);
  if (!now.length) return null;
  return {text: sourceZeroCard(now.map(item => ({label: SOURCE_NAMES[item.source] || item.source, readers: item.readers, total: item.total, run: item.run}))).text,
    state: `${night} ${now.map(item => `${item.source}:${item.run}`).join(',')}`.slice(0, 60), sources: now.map(item => ({source: item.source, run: item.run}))};
}
