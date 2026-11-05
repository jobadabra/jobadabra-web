// The day's pool columns beside the scouting snapshot (migration 0102): jobs held by employers installs shared, and the cells they filled.
// Written by api/employers.js when the list is published, drawn by admin/installsimpact.js. Guarded by test/unit/admin/installsimpact.test.js.
import {cellsOf} from './scoutingvisual.js';

export const all = async (db, sql, ...args) => ((await db.prepare(sql).bind(...args).all().catch(() => ({results: []}))).results) || [];
export const day = (date, back = 0) => new Date(date.getTime() - back * 86400000).toISOString().slice(0, 10);
export const jobsOf = feed => Number(feed.jobs || feed.fresh?.jobs || 0);
// The employers an install shared with a route of its own (not read from the central list): the same set the Growth table counts as "From installs".
export async function pooledKeys(db) {
  return new Set((await all(db, "SELECT DISTINCT ats || ':' || slug AS k FROM contributions WHERE how IS NOT NULL AND how NOT IN ('index', 'own')")).map(row => row.k));
}
export const isPooled = (feed, keys) => keys.has(`${feed.ats}:${feed.slug}`);

// The day's extra snapshot columns (migration 0102), written beside the scouting snapshot when the list is published.
export function poolSnapshot(feeds, keys) {
  const pooled = feeds.filter(feed => isPooled(feed, keys));
  return {jobs_total: feeds.reduce((sum, feed) => sum + jobsOf(feed), 0), from_pool_jobs: pooled.reduce((sum, feed) => sum + jobsOf(feed), 0), pool_cells: cellsOf(pooled)};
}
export async function storePoolSnapshot(db, date, snap) {
  await db.prepare('UPDATE index_daily SET jobs_total = ?, from_pool_jobs = ?, pool_cells = ? WHERE day = ?')
    .bind(snap.jobs_total, snap.from_pool_jobs, JSON.stringify(snap.pool_cells || {}), date).run();
}
