// The by-hand full runs of the 18 people (owner, 10 Nov 2026: "We should trigger manually, to understand right away the direction"), stored apart from the nights under ci_state 'search-byhand': a night's date
// replaces that night on upload, and a by-hand run must never replace a night, feed the judge's usual or raise the alert. Same slim rows as a night (admin/search-night.js clean); newest first, the last KEEP_HAND.
import {readState} from './ci-state.js';

export const HAND_KEY = 'search-byhand', KEEP_HAND = 30;

/** The stored by-hand runs, newest first: [{day, at, engine, rows}]; [] when none or unreadable (the scoreboard draws without them, never fails the tab). */
export async function handRuns(env) {
  const body = await readState(env, HAND_KEY, null);
  return (Array.isArray(body?.runs) ? body.runs : []).filter(run => run && Array.isArray(run.rows) && /^\d{4}-\d\d-\d\d$/.test(run.day || '')).slice(0, KEEP_HAND);
}
