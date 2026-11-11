// Demo data for the Night search Finish line tab (10 Nov 2026, [oe]): MADE-UP runs with in = out for EURES and per-source counts, over the Scoreboard seed's nights. Fixed dates. Nothing here is a real person or a real count.
import {readState, writeState} from '../admin/ci-state.js';
import {REFERENCE_KEY, STATE_KEY} from '../admin/search-night.js';
import {HAND_KEY} from '../admin/search-night-hand.js';
import {searchScoreboard} from './page-shot-seed-scoreboard.mjs';
import {cleanInout, cleanRuns, cleanSources} from '../admin/search-finish.js';
import {cleanFloors} from '../admin/search-floors.js';
import {cleanScout} from '../admin/search-finish-scout.js';
import {cleanStepYield} from '../admin/search-night-yield.js';
import {WEEK_KEY, cleanByRun, cleanRuns as cleanWeekRuns} from '../admin/search-week.js';

// in (EURES right jobs) per person; 0 = EURES lists none; p6 and p15 are blind on the newest runs.
const IN = [19, 1, 22, 6, 24, 0, 0, 18, 21, 15, 0, 17, 43, 25, 0, 0, 13, 0];
const SOURCES = ['employer_sites', 'job_boards', 'free_job_apis'];

// How many of `in` are in the list on run `t` (0 = oldest), and where the rest were lost: a stage per person, p13 mostly unexplained (after_kept).
function inoutOf(person, t, runs) {
  const inn = IN[person];
  if (!inn) return null;
  const share = Math.min(1, 0.35 + (0.55 * t) / (runs - 1) + ((person * 7 + t * 3) % 5) * 0.02), out = person === 12 ? Math.round(inn * 0.53) : person === 3 ? Math.min(1, inn) : Math.min(inn, Math.round(inn * (person % 3 === 0 && person !== 0 ? 1 : share)));
  const miss = inn - out, stage = {0: 'never_asked', 3: 'not_read', 4: 'ai_no', 16: 'placed_out', 12: 'after_kept', 7: 'after_kept', 1: 'after_kept'}[person] || 'never_asked';
  return {eures: {in: inn, out, lost: miss ? {[stage]: miss} : {}}};
}

// MADE-UP counts of the Central Scout's list per person (the shape of jobadabra's `scout` row): 363 empty feeds in every person's places, the gap (open jobs, no kind counted) 17-40% of the rest and falling night by night, most of
// the others whole-mix only, a few counted per country. Not a real list, person or count.
function scoutDemo(person, t, runs) {
  const open = 90 + ((person * 53) % 700), empty = 363, gap = Math.round(open * Math.max(0.1, 0.17 + ((person * 7) % 24) / 100 - (0.04 * t) / Math.max(1, runs - 1))), counted = Math.round((open - gap) * 0.08), mixOnly = open - gap - counted;
  const fits = Math.round((counted + mixOnly) * (0.04 + ((person * 3) % 9) / 100)), forRole = fits + (person % 3);
  return {in_places: open + empty, empty_feeds: empty, no_kind_mix: gap, mix_only: mixOnly, counted_per_country: counted, for_role: forRole, fit_their_kind: fits, kind_not_theirs: counted + mixOnly - fits, kinds_known: person !== 5,
    listed_from_list: 2 + (person % 6), right_from_list: person % 4, employers_right_from_list: person % 3};
}

/** @param {{env: object}} context the seed context */
export async function searchFinish({env}) {
  await searchScoreboard({env});
  const state = await readState(env, STATE_KEY, {nights: []}), eighteen = state.nights.filter(night => night.rows.length === 18).reverse(), n = eighteen.length;
  const nights = state.nights.map(night => {
    const t = eighteen.indexOf(night);
    return t < 0 ? night : {...night, rows: night.rows.map((row, i) => ({...row, scout: cleanScout(scoutDemo(i, t, n)), inout: cleanInout(inoutOf(i, t, n)),
      sources: cleanSources(Object.fromEntries(['eures', ...SOURCES].map((source, k) => [source, {right: source === 'job_boards' && t >= n - 3 ? 0 : Math.max(0, (source === 'eures' ? 6 : 3 - k) + ((i + t) % 3) - (i % 4 === 0 ? 3 : 0)), only: null, fit70: null, seconds: 40 + k * 12 + ((i + t) % 5) * 3}]))),
      stepYield: cleanStepYield(SOURCES.map(step => ({step, seconds: 30, jobs: step === 'job_boards' && t >= n - 3 ? 0 : 5, local: 2, scored: 2, fit70: 1, local_fit70: 1})).filter(item => !(item.step === 'free_job_apis' && i % 6 === 5)))}))};   // MADE-UP: job boards bring 0 right jobs for everyone on the newest 3 nights (the case the source chart is for); a few people read no free job APIs
  });
  // MADE-UP floors on the newest 18-person night (cr's G2): p13 right jobs 0 against a floor of 4, the 2nd night under; the other floors held (first seconds to first job is a ceiling).
  const levels = Object.fromEntries(Array.from({length: 18}, (_, i) => [i + 1, {right: {floor: i % 5 === 4 ? null : 4, now: i === 12 ? 0 : 4 + (i % 3), spread: 1, below: i === 12 ? 2 : 0}, first_s: {floor: 60, now: 44 + i, spread: 5, below: 0}}]));
  // The newest night runs with EURES off (11 Nov 2026): no EURES in = out on it (the side check reads the older runs and the by-hand run), floors of the eures-off series.
  const withFloors = nights.map(night => (night.rows.length === 18 && night.night === eighteen.at(-1).night ? {...night, eures: 'off', rows: night.rows.map((row, i) => ({...row, inout: null, runs: cleanRuns(i === 3 ? [{run: 1, new_listed: 9, new_right: row.local ?? 0, right_after: row.local ?? 0, seconds: 80}] : [{run: 1, new_listed: 9 + i, new_right: row.local ?? 0, right_after: row.local ?? 0, seconds: 80}, {run: 2, new_listed: 2, new_right: i % 4 === 0 ? 1 : 0, right_after: (row.local ?? 0) + (i % 4 === 0 ? 1 : 0), seconds: 60}])})),   // MADE-UP two-run night (5/5, 11 Nov 2026): run 2 adds a right job for every 4th person; p4 had one run only
    measure: '3f9a1c07be52', floors: cleanFloors({checked: true, series: '3f9a1c07be52|codex-gpt-6-luna|eures-off', last_green: {run: '42897000000', sha: '83bf4626aabbccdd'},
    merges: ['Read the employer pages in one pass (#3709)', 'Raise the AI call cap (#3712)'], red: [{persona: 13, number: 'right', floor: 4, now: 0, spread: 1, below: 2}], levels})} : night));
  await writeState(env, STATE_KEY, {nights: withFloors}, new Date());
  // MADE-UP weekly reference with mc's per-source rows (5/5): the market per person, and what each source read and found; LinkedIn by hand, free job APIs without a query, web search not counted.
  const personas = Object.fromEntries(IN.map((inn, i) => [i + 1, {total: inn, reachable: Math.round(inn * 0.7), eures: inn, market: inn + 6 + (i % 4), counted_on: '2026-11-09', sources: {
    eures: {status: 'counted', read: inn + 8, right: inn, only: inn > 2 ? 2 : 0}, employer_sites: {status: i % 6 === 5 ? 'partial: 2 feeds late' : 'counted', read: 10 + i, right: 3 + (i % 4), only: i % 3},
    job_boards: i % 5 === 4 ? {status: 'none (no board)'} : {status: 'counted', read: 15 + i, right: 4 + (i % 5), only: 1}, free_job_apis: {status: 'none (no query)'}, web_search: {status: 'not counted: no key'}, linkedin: {status: 'by hand'}}}]));
  await writeState(env, REFERENCE_KEY, {week: '2026-W46', run: null, personas: personas, at: new Date().toISOString()}, new Date());
  const hand = await readState(env, HAND_KEY, {runs: []});
  await writeState(env, HAND_KEY, {runs: hand.runs.map((run, h) => ({...run, eures: 'on', rows: run.rows.map((row, i) => ({...row, inout: cleanInout(inoutOf(i, n - 1 - h, n))}))}))}, new Date());
}

/** The same tab with MADE-UP weekly data: 5 runs in one install, each person's new right jobs per run (run 1 most, later runs fewer, run 5 none), from the newest 18-person night's rows. @param {{env: object}} context the seed context */
export async function searchFinishWeek({env}) {
  await searchFinish({env});
  const newest = (await readState(env, STATE_KEY, {nights: []})).nights.find(night => night.rows.length === 18);
  const rows = newest.rows.map((row, i) => {
    const added = [4 + (i % 4), i % 3, i % 5 === 0 ? 1 : 0, i % 7 === 0 ? 1 : 0, 0];
    let after = 0;
    return {...row, runs: cleanWeekRuns(added.map((n, k) => ({run: k + 1, new_listed: n + 6 - k, new_right: n, right_after: (after += n), seconds: 70 + k * 15})))};
  }), measured = rows.filter(row => !['unmeasured', 'fault', 'unknown', 'not-run'].includes(row.kind));
  const byRun = cleanByRun([0, 1, 2, 3, 4].map(k => ({run: k + 1, measured: measured.length, people_new: measured.filter(row => row.runs[k].newRight > 0).length, new_right: measured.reduce((sum, row) => sum + row.runs[k].newRight, 0)})));
  await writeState(env, WEEK_KEY, {weeks: [{...newest, week: '2026-11-12', at: new Date().toISOString(), run: null, byHand: false, byRun, rows}]}, new Date());
}
