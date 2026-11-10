// Demo data for the Night search Finish line tab (10 Nov 2026, [oe]): MADE-UP runs with in = out for EURES and per-source counts, over the Scoreboard seed's nights. Fixed dates. Nothing here is a real person or a real count.
import {readState, writeState} from '../admin/ci-state.js';
import {STATE_KEY} from '../admin/search-night.js';
import {HAND_KEY} from '../admin/search-night-hand.js';
import {searchScoreboard} from './page-shot-seed-scoreboard.mjs';
import {cleanInout, cleanSources} from '../admin/search-finish.js';

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

/** @param {{env: object}} context the seed context */
export async function searchFinish({env}) {
  await searchScoreboard({env});
  const state = await readState(env, STATE_KEY, {nights: []}), eighteen = state.nights.filter(night => night.rows.length === 18).reverse(), n = eighteen.length;
  const nights = state.nights.map(night => {
    const t = eighteen.indexOf(night);
    return t < 0 ? night : {...night, rows: night.rows.map((row, i) => ({...row, inout: cleanInout(inoutOf(i, t, n)),
      sources: cleanSources(Object.fromEntries(['eures', ...SOURCES].map((source, k) => [source, {right: Math.max(0, (source === 'eures' ? 6 : 3 - k) + ((i + t) % 3) - (i % 4 === 0 ? 3 : 0)), only: null, fit70: null, seconds: 40 + k * 12 + ((i + t) % 5) * 3}])))}))};
  });
  await writeState(env, STATE_KEY, {nights}, new Date());
  const hand = await readState(env, HAND_KEY, {runs: []});
  await writeState(env, HAND_KEY, {runs: hand.runs.map((run, h) => ({...run, rows: run.rows.map((row, i) => ({...row, inout: cleanInout(inoutOf(i, n - 1 - h, n))}))}))}, new Date());
}
