// The scouting numbers behind /admin/job-search/scouting: the day's snapshot of the employer list (counts only, with each kind), its storage and the gathering of what the page shows.
// Published by api/employers.js, drawn by admin/scoutingadmin.js. Guarded by test/unit/shared/scoutingadmin.test.js.
import {LATEST_FAMILY} from './engines.js';
import {load as loadScouting} from './scouting.js';
import {gather as gatherClosed} from './closed-sites.js';
import {gather as gatherBotChecks} from './bot-checks.js';
import {gather as gatherReads} from './readmethods.js';
import {cellsOf, demandOf, topKind} from './scoutingvisual.js';
import {gatherBoards} from './board-counts.js';

export const day = (date, back = 0) => new Date(date.getTime() - back * 86400000).toISOString().slice(0, 10);
const all = async (db, sql, ...args) => ((await db.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results) || [];
export {topKind, cellsOf};
// The day's snapshot, from the list just published (employers.js publish): counts only, with each kind × country cell for the trends.
export function snapshot(feeds, fromPool = 0, deadEnds = 0) {
  return {feeds: feeds.length, non_it: feeds.filter(feed => !['software', 'unknown'].includes(topKind(feed))).length,
    failing: feeds.filter(feed => (feed.fresh?.fails || 0) >= 3).length, from_pool: fromPool, dead_ends: deadEnds, cells: cellsOf(feeds)};
}
export async function storeSnapshot(db, date, snap) {
  await db.prepare(`INSERT INTO index_daily (day, feeds, non_it, failing, from_pool, dead_ends, cells) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET feeds = excluded.feeds, non_it = excluded.non_it, failing = excluded.failing, from_pool = excluded.from_pool,
    dead_ends = excluded.dead_ends, cells = excluded.cells`).bind(date, snap.feeds, snap.non_it, snap.failing, snap.from_pool, snap.dead_ends, JSON.stringify(snap.cells || {})).run();
}

// What installs share, this many days back, per AI family (owner, 9 Oct 2026; src/engines.js): installs sharing, employers shared, dead ends, board reads with matches.
async function byFamily(db, now) {
  const out = {};
  for (const family of ['claude', 'openai', 'unknown']) {
    const one = async (sql, ...args) => (await all(db, sql, ...args).catch(() => []))[0]?.n || 0;
    out[family] = {sharing7: await one('SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ? AND ai_family = ?', day(now, 7), family),
      shared: await one("SELECT COUNT(DISTINCT ats || ':' || slug) AS n FROM contributions WHERE ai_family = ?", family),
      dead: await one('SELECT COUNT(DISTINCT key) AS n FROM nofeed WHERE ai_family = ?', family),
      boardsMatched: await one('SELECT COUNT(*) AS n FROM board_reads WHERE hits > 0 AND ai_family = ?', family)};
  }
  return out;
}

export async function gather(db, now = new Date(), family = '') {
  // ?family=claude|openai: only what installs of that AI family shared (src/engines.js); '' = all. The central scout and the index are everyone's.
  const F = " (? = '' OR ai_family = ?) ", f = [family, family];
  const feeds = (await all(db, 'SELECT body FROM index_feeds')).map(row => { try { return JSON.parse(row.body); } catch { return null; } }).filter(Boolean);
  const daily = await all(db, 'SELECT * FROM index_daily ORDER BY day DESC LIMIT 30');
  const sharing = async back => (await all(db, `SELECT COUNT(DISTINCT install) AS n FROM contributions WHERE day >= ? AND${F}`, day(now, back), ...f))[0]?.n || 0;
  const shared = (await all(db, `SELECT COUNT(DISTINCT ats || ':' || slug) AS n FROM contributions WHERE${F}`, ...f))[0]?.n || 0;
  const routes = await all(db, `SELECT how, COUNT(DISTINCT ats || ':' || slug) AS feeds, SUM(COALESCE(hits, 0)) AS hits FROM contributions WHERE how IS NOT NULL AND${F}GROUP BY how ORDER BY feeds DESC`, ...f);
  const useful = await all(db, `SELECT company, ats, slug, SUM(COALESCE(hits, 0)) AS hits, COUNT(*) AS installs, MAX(jobs) AS jobs, MAX(site) AS site, SUM(COALESCE(json_extract(out_json, '$.applied'), 0)) AS applied, SUM(COALESCE(json_extract(out_json, '$.interview'), 0)) AS interviews FROM contributions WHERE${F}GROUP BY ats, slug ORDER BY interviews DESC, hits DESC, installs DESC LIMIT 15`, ...f);
  const dead = await all(db, `SELECT company, host, COUNT(*) AS installs, MAX(day) AS last FROM nofeed WHERE${F}GROUP BY key ORDER BY installs DESC, last DESC LIMIT 15`, ...f);
  const deadTotal = (await all(db, `SELECT COUNT(DISTINCT key) AS n FROM nofeed WHERE${F}`, ...f))[0]?.n || 0;
  // Which job boards give matches for which kind of role (src/contribute.py boards, 7 Oct 2026); a missing table (before 0031) reads as none.
  const boards = await all(db, `SELECT board, roles, COUNT(*) AS installs, SUM(CASE WHEN hits > 0 THEN 1 ELSE 0 END) AS matched, SUM(COALESCE(hits, 0)) AS hits,
    SUM(COALESCE(dup, 0)) AS dup, SUM(COALESCE(json_extract(out_json, '$.interview'), 0)) AS interviews, SUM(failed) AS failed FROM board_reads WHERE${F}GROUP BY board, roles ORDER BY hits DESC LIMIT 30`, ...f).catch(() => []);
  // Advice shown in the app and how often it was taken (desktop renderer/coverage-actions.js adviceEvent, technical reports).
  const advice = await all(db, `SELECT json_extract(data, '$.advice') AS advice, json_extract(data, '$.where') AS place,
      SUM(CASE WHEN json_extract(data, '$.act') = 'shown' THEN 1 ELSE 0 END) AS shown, SUM(CASE WHEN json_extract(data, '$.act') = 'taken' THEN 1 ELSE 0 END) AS taken,
      SUM(CASE WHEN json_extract(data, '$.act') = 'dismissed' THEN 1 ELSE 0 END) AS dismissed, COUNT(DISTINCT install) AS installs
    FROM telemetry WHERE kind = 'advice' AND day >= ? AND (? = '' OR install IN (SELECT install FROM (${LATEST_FAMILY}) WHERE family = ?)) GROUP BY advice, place ORDER BY shown DESC`, day(now, 90), ...f);
  // Who searches where (last 30 days): kinds × countries of the installs that share, for the heat map's hover and the gaps (k >= 3 installs).
  const demand = demandOf(await all(db, `SELECT DISTINCT install, roles, countries FROM contributions WHERE day >= ? AND${F}`, day(now, 30), ...f));
  const served = await all(db, 'SELECT day, kind, n FROM pool_served_day WHERE day >= ? ORDER BY day DESC, kind', day(now, 30)).catch(() => []);   // before 0100: none
  const central = await loadScouting(db);
  const boardCounts = await gatherBoards(db, daily).catch(() => null);   // the published boards per family × country and their trend (shared/board-counts.js)
  return {family, served, boardCounts, families: await byFamily(db, now).catch(() => null), feeds, daily, demand, boards, advice, sharing7: await sharing(7), sharing30: await sharing(30), shared, routes, useful, dead, deadTotal, central, closed: await gatherClosed(db, family).catch(() => []), botChecks: await gatherBotChecks(db).catch(() => null), reads: await gatherReads(db, central?.runs || []).catch(() => null)};
}
