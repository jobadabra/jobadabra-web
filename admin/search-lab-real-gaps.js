// GET /search-lab/real-gaps (Bearer REPLAYS_PUBLISH_KEY, like /applying/discovery-input): the real installs' search gaps for the search robot's alarm
// (jobs/persona-search/real-alarm.mjs, owner 26 Oct 2026: "catch all of the app problems automatically, including this search problem"). Per role family × country,
// each install's latest finished search of the last GAP_DAYS days ('search' reports, shared/search-report.js): how many installs got 0 relevant jobs (fit 70+).
// A group is sent only when MIN_INSTALLS+ installs share it (k >= 3, as the Real installs tab shows a city). Counts only: no install id, city, title or CV.
// Guard: test/unit/admin/search/search-lab-real-gaps.test.js.
import {equal} from '../shared/guard.js';
import {KIND_NAMES} from '../shared/pool-labels.js';
import {realRows} from './search-lab-real.js';

export const MIN_INSTALLS = 3, GAP_DAYS = 14;
const NAMES = {...KIND_NAMES, sales_retail: 'Retail sales'};
const finished = r => r.result !== 'failed' && r.result !== 'stopped' && r.family && r.country && Number.isInteger(r.fit70);
const middle = list => { const sorted = list.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };

// Pure: reports ([{install, day, ...fields}], oldest first) -> [{family, name, country, installs, zero, in_places}] with installs >= MIN_INSTALLS, most zeros first.
export function gaps(reports, now = new Date()) {
  const from = new Date(now.getTime() - GAP_DAYS * 86400000).toISOString().slice(0, 10), groups = new Map();
  for (const r of reports.filter(r => r.day >= from && finished(r))) {
    const key = `${r.family}|${r.country}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(r.install, r);   // oldest first: the install's latest search wins
  }
  return [...groups.entries()].map(([key, latest]) => {
    const [family, country] = key.split('|'), list = [...latest.values()];
    return {family, name: NAMES[family] || 'Other', country, installs: list.length, zero: list.filter(r => r.fit70 === 0).length, in_places: middle(list.map(r => r.in_places))};
  }).filter(g => g.installs >= MIN_INSTALLS).sort((a, b) => b.zero - a.zero || b.installs - a.installs);
}

export async function realGaps(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  return Response.json({day: now.toISOString().slice(0, 10), min_installs: MIN_INSTALLS, days: GAP_DAYS, groups: gaps(await realRows(env.STATS, now), now)},
    {headers: {'Cache-Control': 'no-store'}});
}
