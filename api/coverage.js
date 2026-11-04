// GET /api/coverage: the website's public numbers (owner, 20 Oct 2026). Employers and open jobs: the summary of the latest publish (KV
// index:summary, the landing's numbers too, each employer's jobs once); per country, per kind of work and the week's growth: the latest daily
// snapshot (index_daily); the kind × country table drawn by the admin's own renderer in its public cut (heatTable open, 27 Oct 2026).
// Counts only, never an employer or anything from an install. Read by web/public/coverage.html and web/public/site.js. Tests: test/unit/api/coverage.test.js.
import {countryName, heatTable, history, kindName} from '../shared/scoutingvisual.js';

const HIDDEN = ['other', 'unknown'];   // shown as one line (other) or not at all (not counted yet): a chart of named kinds only

export async function coverage(env) {
  const none = () => new Response(JSON.stringify({ok: false}), {status: 404, headers: {'Content-Type': 'application/json'}});
  if (!env.STATS) return none();
  const daily = (await env.STATS.prepare('SELECT day, feeds, cells FROM index_daily ORDER BY day DESC LIMIT 14').all().catch(() => ({results: []}))).results || [];
  const latest = history(daily).withCells.at(-1);
  if (!latest) return none();
  const past = history(daily, new Date(`${latest.day}T12:00:00Z`));   // the week before the snapshot, not before today
  const countries = {}, kinds = {};
  for (const [cell, [count]] of Object.entries(latest.cells)) {   // a cell's jobs repeat an employer's whole count per country: never summed here
    const [kind, country] = cell.split('|');
    countries[country] = (countries[country] || 0) + count;
    kinds[kind] = (kinds[kind] || 0) + count;
  }
  let summary = null;
  try { summary = JSON.parse(await env.WAITLIST?.get('index:summary') || 'null'); } catch { summary = null; }
  const order = rows => rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const body = {day: latest.day, employers: summary?.employers || latest.feeds};
  if (summary?.jobs) body.jobs = summary.jobs;
  body.country_count = Object.keys(countries).length;
  if (past.week) body.week_added = latest.feeds - past.week.feeds;
  body.countries = order(Object.entries(countries).map(([code, count]) => [countryName(code), count]));
  body.kinds = order(Object.entries(kinds).filter(([kind]) => !HIDDEN.includes(kind)).map(([kind, count]) => [kindName(kind), count]));
  body.other_kinds = kinds.other || 0;
  body.heat = heatTable(latest.cells, past, {open: true});
  return new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'}});
}
