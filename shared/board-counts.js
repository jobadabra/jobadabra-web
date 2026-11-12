// The central scout's published job boards, counted per role family × country (12 Nov 2026, owner via sa: "how many job boards with 3+ local jobs the Scout has published, per country
// and kind of work, how that moved over time, and when board discovery last ran"). A board reaches sitefacts only with 3+ jobs located in its country (api/employers.js boardFactsOf,
// MIN_LOCAL_JOBS), one row per board and country under the install id `central-scout-<cc>`, its `day` the last day it was measured; a row not measured for 30 days leaves.
// Board discovery (jobadabra-lab board-discovery, session bd) feeds the same rows through the scout's next publish, so a country's newest `day` is when its boards were last measured.
// Counts only: no board address or name leaves this module. Drawn by admin/scouting-boards.js. Guard: test/unit/shared/board-counts.test.js.
import {reachOf} from './board-reach.js';
import {FAMILIES} from './pool-tags.js';
import PROFILES from './test-profiles.json' with {type: 'json'};

/** api/employers.js SCOUT_BOARD_PREFIX (shared/ may not import api/, test/guards/boundary.test.js); the test checks the two are equal. */
export const SCOUT_BOARD_PREFIX = 'central-scout-';

/**
 * The 30 test profiles of job search (shared/test-profiles.json, the owner's Trello board "GTM 6 · Job search: 30 profiles"): {id, country, family} each, the family in the pool's words.
 * A profile whose cell has no published board is a person we test with and no board for their work in their country: the page shows that cell red. Two profiles may share a cell (c04, c18).
 * Why (12 Nov 2026, owner forwarded sa: "the card should outline and count those 30 cells, or it will show a different number from the sketch for the same thing"): session bd counts the same 30.
 */
export const PROFILE_CELLS = PROFILES.profiles;

const CC = /^[a-z]{2}$/;
/**
 * The sitefacts rows ({countries, families, day}) as counts: {total: boards, cells: {'<family>|<cc>': boards}, last: {<cc>: 'YYYY-MM-DD'}, profiles: test profiles whose cell has 1+ board}.
 * A board that covers three families counts once in each of its three cells and once in `total`. Unknown families and malformed countries are skipped, never counted as "other".
 */
export function countsOf(rows) {
  const cells = {}, last = {};
  let total = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const country = String(row?.countries || '');
    if (!CC.test(country)) continue;
    total += 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.day || '') && !(last[country] >= row.day)) last[country] = row.day;
    for (const family of new Set(String(row.families || '').split(','))) if (FAMILIES.includes(family)) cells[`${family}|${country}`] = (cells[`${family}|${country}`] || 0) + 1;
  }
  return {total, cells, last, profiles: PROFILE_CELLS.filter(cell => cells[`${cell.family}|${cell.country}`]).length};
}

const ROWS_SQL = `SELECT host, countries, families, day FROM sitefacts WHERE install LIKE ? AND kind = 'board'`;
/** The scout's board rows ({host, countries, families, day}); the host stays server-side (shared/board-reach.js groups by it, never sends it). */
export const rowsOf = async db => ((await db.prepare(ROWS_SQL).bind(`${SCOUT_BOARD_PREFIX}%`).all()).results) || [];

/**
 * Keeps today's counts in index_daily.boards (migration 0150), after the publish wrote the day's row (shared/scouting-snapshot.js storeSnapshot): an UPDATE, so a day without that row stays without.
 * Called on every publish, also one without new board facts: boards leave after 30 days, and the trend must show that fall too.
 */
export async function storeBoardCounts(db, date) {
  const {total, cells, profiles} = countsOf(await rowsOf(db));
  await db.prepare('UPDATE index_daily SET boards = ? WHERE day = ?').bind(JSON.stringify({total, profiles, cells}), date).run();
}

/** One day's stored counts, or null for a day before migration 0150 or an unreadable value (a gap on the chart, never a zero). */
export function dayCounts(text) {
  try { const value = text ? JSON.parse(text) : null; return value && Number.isInteger(value.total) ? {total: value.total, profiles: Number(value.profiles) || 0} : null; } catch { return null; }
}

/** The lab workflow the Worker starts to find boards (session bd's proposal, 12 Nov 2026; shared/intel-start.js starts it and records each start in intel_start). */
export const DISCOVERY_WORKFLOW = 'board-discovery.yml';

/**
 * What the page draws: today's counts from sitefacts, the last 30 daily snapshots {day, total, profiles} oldest first ('daily' = index_daily rows, newest first, as gather reads them),
 * `start`: the Worker's last start of DISCOVERY_WORKFLOW {at, ok, reason}, null before the first (or before table intel_start), and `paused`: true when the hourly
 * Scheduled snapshot (schedules_snapshot, jobs/schedules-snapshot.mjs) reads the workflow as disabled in GitHub.
 * Why (12 Nov 2026, sa agreed with bw: "GitHub's Disable is the pause, and the chip says paused when the workflow is disabled"; no switch of our own): the Worker still tries
 * every 2 h and GitHub refuses, so without this the card would call a pause a refusal.
 */
export async function gatherBoards(db, daily = []) {
  const rows = await rowsOf(db).catch(() => []), now = countsOf(rows);
  const history = [...daily].reverse().map(row => ({day: row.day, ...(dayCounts(row.boards) || {total: null, profiles: null})}));
  const row = await db.prepare('SELECT at, ok, reason FROM intel_start WHERE workflow = ?').bind(DISCOVERY_WORKFLOW).first().catch(() => null);
  return {...now, reach: reachOf(rows), history, start: row ? {at: String(row.at), ok: Boolean(row.ok), reason: String(row.reason || '')} : null, paused: await pausedOf(db)};
}

/** Whether the Scheduled snapshot reads DISCOVERY_WORKFLOW as disabled in its repo; false when the snapshot is missing, unreadable or does not list it. */
async function pausedOf(db) {
  try {
    const snap = await db.prepare('SELECT body FROM schedules_snapshot WHERE id = 1').first();
    return Boolean(JSON.parse(snap?.body || '{}').jobs?.some(job => job.file === DISCOVERY_WORKFLOW && job.disabled));
  } catch { return false; }
}
