
import {viewer} from '../shared/auth.js';
import {EUROPE} from '../shared/pool-tags.js';
import {CHART_STYLE, TOOLTIP, bars, C, columns, esc, n, tile} from '../shared/scoutingcharts.js';
import {floorFor, cellsOf, kindName, topKind} from '../shared/scoutingvisual.js';
import {CHIP_STYLE} from './chip.js';
import {servedSection} from './scoutingadmin.js';
import {stacked} from './installscharts.js';
import {all, day, jobsOf, pooledKeys, isPooled} from '../shared/pool-snapshot.js';

// /admin/job-search/installs: what real installs add to the product, above all the central employer list (owner, 20 Oct 2026: "the impact of real
// users/installation over our product growth ... especially on the scouting/job search"). Employers an install shared, the open jobs they
// hold, the kind × country cells installs filled, steps installs skipped thanks to the pool (pool_served_day), boards and dead ends.
// Counts and names only, never a job text. Tests: test/unit/admin/installsimpact.test.js.
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };


// Cells at the floor with installs, and how many of them only reached it thanks to installs (central cell alone is under the floor).
export function floorCells(cells, poolCells) {
  const keys = Object.keys(cells || {});
  const withInstalls = keys.filter(key => cells[key][0] >= floorFor(key.split('|')[1])).length;
  const alone = keys.filter(key => cells[key][0] - (poolCells?.[key]?.[0] || 0) >= floorFor(key.split('|')[1])).length;
  return {withInstalls, alone, gained: withInstalls - alone};
}

// Per kind of role, each employer once: what the central scout found alone and what only installs added.
export function byKind(feeds, keys) {
  const out = {};
  for (const feed of feeds) {
    const entry = out[topKind(feed)] ||= {central: 0, installs: 0};
    entry[isPooled(feed, keys) ? 'installs' : 'central'] += 1;
  }
  return Object.entries(out).map(([kind, v]) => ({kind, ...v})).sort((a, b) => b.central + b.installs - (a.central + a.installs));
}

export async function gather(db, now = new Date()) {
  const feeds = (await all(db, 'SELECT body FROM index_feeds')).map(row => parse(row.body)).filter(Boolean);
  const keys = await pooledKeys(db);
  const daily = (await all(db, 'SELECT day, feeds, from_pool, dead_ends, cells, jobs_total, from_pool_jobs, pool_cells FROM index_daily ORDER BY day DESC LIMIT 45')).reverse()
    .map(row => ({...row, cells: parse(row.cells), pool_cells: parse(row.pool_cells)}));
  const one = async (sql, ...args) => (await all(db, sql, ...args))[0]?.n || 0;
  return {feeds, keys, daily, kinds: byKind(feeds, keys),
    served: await all(db, 'SELECT day, kind, n FROM pool_served_day WHERE day >= ? ORDER BY day DESC, kind', day(now, 30)),
    sharing7: await one('SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ?', day(now, 7)),
    sharing30: await one('SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ?', day(now, 30)),
    boards: await one('SELECT COUNT(DISTINCT board) AS n FROM board_reads WHERE hits > 0'),
    deadTotal: await one('SELECT COUNT(DISTINCT key) AS n FROM nofeed')};
}

const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '—');
const weekAgo = (rows, key) => { const old = rows[Math.max(0, rows.length - 8)]; return old ? old[key] : null; };

export function page(data, now = new Date()) {
  const {feeds, keys, daily, kinds} = data;
  const pooledNow = feeds.filter(feed => isPooled(feed, keys)), total = feeds.length;
  const jobsAll = feeds.reduce((sum, feed) => sum + jobsOf(feed), 0), jobsPool = pooledNow.reduce((sum, feed) => sum + jobsOf(feed), 0);
  const last = daily[daily.length - 1], cellsNow = cellsOf(feeds), poolCellsNow = cellsOf(pooledNow), floor = floorCells(cellsNow, poolCellsNow);
  const skipped30 = data.served.reduce((sum, row) => sum + row.n, 0), perDay = {};
  for (const row of data.served) perDay[row.day] = (perDay[row.day] || 0) + row.n;
  const days = Array.from({length: 30}, (_, i) => day(now, 29 - i));
  const delta = key => { const before = weekAgo(daily, key); return before == null || !daily.length ? null : (last?.[key] ?? 0) - before; };
  const verdict = !total ? 'No employer list published yet: the central scout publishes every 6 hours.'
    : `${n(pooledNow.length)} of ${n(total)} employers (${pct(pooledNow.length, total)}) came from installs, holding ${pct(jobsPool, jobsAll)} of the open jobs. `
      + `Installs skipped ${n(skipped30)} steps in 30 days and lifted ${n(floor.gained)} kind × country cells to their floor.`;
  const series = daily.map(row => ({day: row.day, central: Math.max(0, row.feeds - row.from_pool), installs: row.from_pool}));
  const gainHistory = daily.filter(row => row.cells && row.pool_cells).map(row => floorCells(row.cells, row.pool_cells).gained);
  const kindBars = bars(kinds.map(k => ({label: kindName(k.kind), parts: [[k.central, C.gray, 'central scout'], [k.installs, C.accent, 'from installs']], after: `${n(k.central + k.installs)} <small class="muted">+${pct(k.installs, k.central + k.installs)}</small>`})), {empty: 'No employers yet.'});
  const countries = EUROPE.filter(country => Object.keys(poolCellsNow).some(key => key.endsWith(`|${country}`)))
    .map(country => ({country, installs: Object.entries(poolCellsNow).filter(([key]) => key.endsWith(`|${country}`)).reduce((sum, [, v]) => sum + v[0], 0)})).sort((a, b) => b.installs - a.installs).slice(0, 12);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Installs · Admin</title><link rel="icon" href="/favicon-32.png">
<style>${CHIP_STYLE}.card{padding:16px;margin-bottom:12px;min-width:0}td{padding:7px 4px}.verdict{background:#1d1a12;border:1px solid #5a4620;border-radius:14px;padding:14px 16px;margin-bottom:12px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-bottom:12px}.grid2>.card{margin-bottom:0}.legend i.sw{width:10px;height:10px;border-radius:2px}${CHART_STYLE}</style></head><body><main>
<header><div><h1>🧲 What installs add</h1><small class="muted">Counts and names only. <a href="/admin/job-search/scouting">Scouting →</a></small></div></header>
<div class="verdict">${esc(verdict)}</div>
<div class="tiles">
${tile('Employers from installs', n(pooledNow.length), {spark: daily.map(row => row.from_pool), delta: delta('from_pool'), note: `${pct(pooledNow.length, total)} of the list`})}
${tile('Open jobs they hold', n(jobsPool), {spark: daily.filter(row => row.jobs_total).map(row => row.from_pool_jobs), delta: delta('from_pool_jobs'), note: `${pct(jobsPool, jobsAll)} of ${n(jobsAll)}`})}
${tile('Steps skipped, 30 days', n(skipped30), {spark: days.map(d => perDay[d] || 0), note: 'work the pool already had done'})}
${tile('Cells lifted by installs', n(floor.gained), {spark: gainHistory, note: `kind × country now at their floor`})}
${tile('Dead ends shared', n(data.deadTotal), {note: 'skipped by everyone for 30 days'})}
${tile('Boards found by installs', n(data.boards), {note: `${n(data.sharing7)} installs sharing this week`})}
</div>
<div class="grid2"><section class="card"><h2>The employer list: central scout and installs</h2><small class="muted">Employers per day, stacked. Blue is what installs shared.</small>${stacked(series, {label: 'Employers in the list'})}
<p class="legend"><span><i class="sw" style="background:${C.gray}"></i> Central scout</span> <span><i class="sw" style="background:${C.accent}"></i> From installs</span></p></section>
<section class="card"><h2>Steps skipped thanks to other installs</h2><small class="muted">Per day, all kinds.</small>${columns(days.map(d => ({value: perDay[d] || 0, tip: `${d}: ${n(perDay[d] || 0)} skipped`})), {label: 'Steps skipped per day', empty: 'Nothing reported yet.'})}</section></div>
<section class="card"><h2>Which kinds of role installs filled</h2><small class="muted">Employers per kind (each once): found by the central scout alone, and shared by installs.</small>${kindBars}
<p class="legend"><span><i class="sw" style="background:${C.gray}"></i> Central scout</span> <span><i class="sw" style="background:${C.accent}"></i> From installs</span></p></section>
<section class="card"><h2>Countries installs added employers to</h2><small class="muted">Employers from installs per European country (an employer counts in every country it hires in).</small>
${bars(countries.map(c => ({label: c.country.toUpperCase(), parts: [[c.installs, C.accent, 'from installs']]})), {empty: 'No employers from installs yet.'})}</section>
<details class="fold"><summary>♻️ Skipped steps per kind</summary>${servedSection(data.served, now)}</details>
</main>${TOOLTIP}</body></html>`;
}

export async function view(request, env) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  return new Response(page(await gather(env.STATS)), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
