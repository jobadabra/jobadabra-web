// The "Session checks" tab's data (owner, 24 Oct 2026): what a session's local search check found (local jobs, boards read, what broke) and concluded, uploaded by the session
// (PUT /search-lab/session-checks, Bearer SESSION_CHECKS_KEY: its own key, not the CI one) so other sessions read it. Checked on the way in: fixed shapes, counts and seconds, board names
// with counts, two short sentences; no job titles, company names or CV text. Guard: test/unit/admin/session-checks.test.js.
import {equal} from '../shared/guard.js';

export const KEEP_CHECKS = 300, MAX_ROWS = 5, MAX_BOARDS = 14;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/, BUILD = /^[0-9a-f]{7,40}$/, WHEN = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?Z$/;
const MODES = ['full', 'quick'], STATES = ['ok', 'failed'];
const COUNTS = ['seconds', 'first_s', 'local_jobs', 'in_places', 'scored', 'fit70', 'target'];   // target: the round's X, relevant local jobs counted outside the app (12 Nov 2026)
const text = (value, max) => String(value ?? '').replace(/[^\p{L}\p{N} ·.,;:()'#/%+=-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
/** A check's title without the separator a blank role leaves in front (", Toulouse" → "Toulouse"). Why (12 Nov 2026, owner's screenshot): 3 checks of 5 Nov showed ", Toulouse". */
export const labelOf = value => text(value, 60).replace(/^[\s,·;:-]+/u, '');
const count = value => (value == null ? null : Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : undefined);

export function clean(row) {
  if (!row || typeof row !== 'object') return {error: 'a check is an object'};
  if (!ID.test(row.session || '')) return {error: 'session: a short lower-case name'};
  if (!ID.test(row.case_id || '')) return {error: `${row.session}: case_id is a short lower-case id`};
  if (!WHEN.test(row.run_at || '')) return {error: `${row.case_id}: run_at is a UTC time`};
  if (row.build != null && !BUILD.test(row.build)) return {error: `${row.case_id}: build is a git sha`};
  if (!MODES.includes(row.mode)) return {error: `${row.case_id}: mode is full or quick`};
  if (!STATES.includes(row.state)) return {error: `${row.case_id}: state is ok or failed`};
  const out = {id: `${row.case_id}@${row.run_at}`, session: row.session, case_id: row.case_id, label: labelOf(row.label) || row.case_id, country: text(row.country, 40), role: text(row.role, 40),
    run_at: row.run_at, build: row.build ?? null, mode: row.mode, state: row.state, broke: text(row.broke, 400), conclusion: text(row.conclusion, 600), prs: text(row.prs, 80)};
  for (const field of COUNTS) {
    const value = count(row[field]);
    if (value === undefined) return {error: `${row.case_id}: ${field} is a count or null`};
    out[field] = value;
  }
  const boards = Array.isArray(row.boards) ? row.boards.slice(0, MAX_BOARDS) : [];
  out.boards = [];
  for (const board of boards) {
    const listed = count(board?.listed), relevant = count(board?.relevant);
    if (!board || typeof board !== 'object' || !text(board.name, 40) || listed === undefined || relevant === undefined) return {error: `${row.case_id}: a board is a name with listed and relevant counts`};
    out.boards.push({name: text(board.name, 40), listed, relevant, note: text(board.note, 60)});
  }
  return out;
}

export async function ingest(db, rows, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return {ok: false, error: `send 1 to ${MAX_ROWS} checks`};
  const clear = rows.map(clean), bad = clear.find(row => row.error);
  if (bad) return {ok: false, error: bad.error};
  for (const row of clear) {
    await db.prepare(`INSERT OR REPLACE INTO session_checks (id, session, case_id, label, country, role, run_at, build, mode, state, ${COUNTS.join(', ')}, boards_json, broke, conclusion, prs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${COUNTS.map(() => '?').join(', ')}, ?, ?, ?, ?)`)
      .bind(row.id, row.session, row.case_id, row.label, row.country, row.role, row.run_at, row.build, row.mode, row.state, ...COUNTS.map(field => row[field]), JSON.stringify(row.boards), row.broke, row.conclusion, row.prs).run();
  }
  await db.prepare('DELETE FROM session_checks WHERE id NOT IN (SELECT id FROM session_checks ORDER BY run_at DESC LIMIT ?)').bind(KEEP_CHECKS).run();
  return {ok: true, stored: clear.length, at: now.toISOString()};
}

export async function ingestRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.SESSION_CHECKS_KEY && equal(given, env.SESSION_CHECKS_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const result = await ingest(env.STATS, body?.rows, now);
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

// Newest first, boards parsed.
export async function checks(db) {
  const {results} = await db.prepare('SELECT * FROM session_checks ORDER BY run_at DESC LIMIT 300').all();
  return (results || []).map(row => ({...row, boards: (() => { try { return JSON.parse(row.boards_json || '[]'); } catch { return []; } })()}));
}
