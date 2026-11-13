// The job-search benchmark's read model: ONE row (benchmark_search_snapshot) built from every run (benchmark_search_runs), so a page load never scans the runs (D1 free plan).
// Three readers (the benchmark page, its publish step, the Admin home tile) go through `snapshotOf`; the writer (the PUT in admin/benchmark-search.js) goes through `saveSnapshot`.
import {summarize} from './benchmark-search-data.js';

/** Every stored run -> the snapshot {schema, rounds, at}. */
export async function buildSnapshot(db, now = new Date()) {
  const {results = []} = await db.prepare('SELECT * FROM benchmark_search_runs ORDER BY at').all();
  return {...summarize(results.map(row => ({...row}))), at: now.toISOString()};
}

/** Builds the snapshot from the runs and stores it as the one row. */
export async function saveSnapshot(db, now = new Date()) {
  const snapshot = await buildSnapshot(db, now);
  await db.prepare('INSERT INTO benchmark_search_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return snapshot;
}

/**
 * The stored snapshot, or null when the site has no database. A missing row is rebuilt from the runs and stored.
 * Why (13 Nov 2026, owner: remove "Jobadabra (with every source)"): the migration that deletes that line's 59 runs also deletes the snapshot row, so every reader sees the rounds without it
 * in the same deploy, with no manual PUT. Only a missing row triggers the build; a stored one is read as it is.
 */
export async function snapshotOf(db) {
  if (!db) return null;
  const row = await db.prepare('SELECT body FROM benchmark_search_snapshot WHERE id = 1').first();
  return row ? JSON.parse(row.body) : saveSnapshot(db);
}
