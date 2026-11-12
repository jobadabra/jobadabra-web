// The rows the Lab's Overview reads (admin/lab-overview.js): the same loaders each Lab tab uses, read once, each on its own so one unreadable store greys one card, never the page.
// Used by the Lab's Overview tab and by Job search → Overview's Lab tiles (admin/headlines-search.js). Guard: test/unit/admin/search/lab-overview.test.js.
import {draws} from './search-lab-draws.js';
import {realRows} from './search-lab-real.js';
import {checks} from './session-checks.js';
import {nights} from './search-night.js';
import {judgeAll} from './search-night-judge.js';
import {handRuns} from './search-night-hand.js';

/** {nights (null when unreadable), hand, real, draws, checks} for labTabs(); every list is [] without a database. */
export async function labData(env, now = new Date()) {
  if (!env?.STATS) return {nights: [], hand: [], real: [], draws: [], checks: []};
  const safe = async (read, fallback) => { try { return await read(); } catch (error) { console.error(`lab overview: ${error?.message || error}`); return fallback; } };
  const [judged, hand, real, drawn, checked] = await Promise.all([safe(async () => judgeAll(await nights(env)), null), safe(() => handRuns(env), []), safe(() => realRows(env.STATS, now), []),
    safe(() => draws(env.STATS), []), safe(() => checks(env.STATS), [])]);
  return {nights: judged, hand, real, draws: drawn, checks: checked};
}
