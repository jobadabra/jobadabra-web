// The Random draws tab's data (owner, 18 Oct 2026; tools/persona-search/draw.py): one row per daily CI draw, checked on the way in (fixed shapes, counts and seconds, no free text), uploaded with
// PUT /search-lab/draws (Bearer REPLAYS_PUBLISH_KEY, main only), read back newest first, and judged: FAILED (a step crashed), Weak (no 1st relevant job, fewer than WEAK_FLOOR jobs in places, or under
// half of the role family's median once MIN_HISTORY earlier draws exist), else Usual. Guard: test/unit/admin/search-lab-draws.test.js.
import {equal} from '../shared/guard.js';

export const KEEP_DRAWS = 400, WEAK_FLOOR = 10, MIN_HISTORY = 5, MIN_POOL = 10, LOW_SHARE = 0.1;
const FIELDS = ['first_s', 'tenth_s', 'fit_s', 'in_places', 'scored', 'fit70'];
const DAY = /^\d{4}-\d\d-\d\d$/, ID = /^[a-z0-9][a-z0-9_-]{0,39}$/, BUILD = /^[0-9a-f]{7,40}$/;
const text = (value, max) => String(value ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, max);
const count = value => (value == null ? null : Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : undefined);
// The search robot's draw (jobs/persona-search/draw_wide.py, 26 Oct 2026): what it drew and the funnel of the measured search (tools/persona-search/funnel.py), fixed words and counts only.
export const PLACE_KINDS = ['city', 'country', 'region', 'remote'], PATHS = ['first', 'field-change', 'again'], ENGINES = ['api', 'free'];
export const FUNNEL = ['employers_picked', 'employers_in_places', 'employer_sites_read', 'boards_read', 'board_jobs', 'board_relevant', 'web_searches', 'web_found', 'looked', 'matches', 'scored', 'good', 'ai_refused'];
const oneOf = (list, value) => (value == null ? null : list.includes(value) ? value : undefined);
const dollars = value => (value == null ? null : typeof value === 'number' && value >= 0 && value <= 100 ? Math.round(value * 1000) / 1000 : undefined);
function funnelOf(given) {
  if (given == null) return null;
  if (typeof given !== 'object') return undefined;
  const out = {};
  for (const key of FUNNEL) { const value = count(given[key]); if (value === undefined) return undefined; if (value != null) out[key] = value; }
  const kinds = Array.isArray(given.kinds) ? given.kinds.filter(kind => ID.test(kind)).slice(0, 12) : [];
  return JSON.stringify(kinds.length ? {...out, kinds} : out);
}
const WIDE = {place_kind: value => oneOf(PLACE_KINDS, value), path: value => oneOf(PATHS, value), engine: value => oneOf(ENGINES, value), ai_usd: dollars, funnel: funnelOf};

export function clean(row) {
  if (!row || typeof row !== 'object') return {error: 'a draw is an object'};
  if (!DAY.test(row.draw_date || '')) return {error: 'draw_date is YYYY-MM-DD'};
  if (!ID.test(row.family || '')) return {error: `${row.draw_date}: family is a short lower-case id`};
  if (row.build != null && !BUILD.test(row.build)) return {error: `${row.draw_date}: build is a git sha`};
  if (row.state !== 'ok' && row.state !== 'failed') return {error: `${row.draw_date}: state is ok or failed`};
  const out = {draw_date: row.draw_date, seed: text(row.seed, 40) || row.draw_date, family: row.family, city: text(row.city, 40), country: text(row.country, 40),
    source: 'ci', build: row.build ?? null, state: row.state, failed_step: row.state === 'failed' ? text(row.failed_step, 60) || 'unknown step' : null};
  if (!out.city || !out.country) return {error: `${row.draw_date}: city and country are short names`};
  for (const field of FIELDS) {
    const value = count(row[field]);
    if (value === undefined) return {error: `${row.draw_date}: ${field} is a count or null`};
    out[field] = value;
  }
  out.role = text(row.role, 60) || null;
  out.place = text(row.place, 60) || null;
  for (const [field, check] of Object.entries(WIDE)) {
    const value = check(row[field]);
    if (value === undefined) return {error: `${row.draw_date}: ${field} is not one the robot sends`};
    out[field] = value;
  }
  return out;
}

export async function ingest(db, row, now = new Date()) {
  const clear = clean(row);
  if (clear.error) return {ok: false, error: clear.error};
  const more = ['role', 'place', ...Object.keys(WIDE)];
  await db.prepare(`INSERT OR REPLACE INTO search_lab_draws (draw_date, seed, family, city, country, source, build, state, ${FIELDS.join(', ')}, failed_step, ${more.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ${more.map(() => '?').join(', ')})`)
    .bind(clear.draw_date, clear.seed, clear.family, clear.city, clear.country, clear.source, clear.build, clear.state, ...FIELDS.map(field => clear[field]), clear.failed_step, ...more.map(field => clear[field])).run();
  await db.prepare('DELETE FROM search_lab_draws WHERE draw_date NOT IN (SELECT draw_date FROM search_lab_draws ORDER BY draw_date DESC LIMIT ?)').bind(KEEP_DRAWS).run();
  const judged = judge(await draws(db)).find(row => row.draw_date === clear.draw_date) || {};   // the verdict with every earlier draw, for the search robot's alarm
  return {ok: true, stored: 1, at: now.toISOString(), verdict: judged.verdict, why: judged.why || [], alarm: judged.alarm || [], severity: judged.severity ?? null};
}

export async function ingestRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.json().catch(() => null);
  const result = body?.branch === 'main' ? await ingest(env.STATS, body.draw, now) : {ok: false, error: 'only a run on main reaches the page'};
  return Response.json(result, {status: result.ok ? 200 : 400, headers: {'Cache-Control': 'no-store'}});
}

export async function draws(db) {
  const {results} = await db.prepare('SELECT * FROM search_lab_draws ORDER BY draw_date DESC LIMIT 400').all();
  return results || [];
}

const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

// The value below which the lowest `share` of a list sits (nearest rank).
export const lowest = (values, share) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]; };

// Newest first in, same order out with {verdict: 'failed'|'weak'|'usual', why: [...], alarm: [...], severity}. A draw is compared with EARLIER draws only: the same family's
// median (5+), and every draw's lowest tenth of relevant jobs and slowest tenth to the first relevant job (10+). `alarm` holds the reasons the search robot files an issue for
// (jobs/persona-search/draw-alarm.mjs): 0 relevant jobs, a crash, or a floor from the draws' own numbers; the fixed "under 10 jobs" floor shows on the tab only (owner, 26 Oct 2026:
// floors come from data, not guesses).
export function judge(rows) {
  return rows.map(row => {
    if (row.state === 'failed') {
      const why = [`a step crashed: ${row.failed_step || 'unknown step'}`];
      return {...row, verdict: 'failed', why, alarm: why, severity: 'medium'};
    }
    const why = [], alarm = [], before = rows.filter(other => other.family === row.family && other.draw_date < row.draw_date && other.state === 'ok');
    const pool = rows.filter(other => other.draw_date < row.draw_date && other.state === 'ok');
    if (row.fit70 === 0) alarm.push('0 relevant jobs (fit 70+) in the places');
    if (pool.length >= MIN_POOL && row.fit70 > 0) {
      const floor = lowest(pool.map(other => other.fit70 ?? 0), LOW_SHARE);
      if (row.fit70 < floor) alarm.push(`${row.fit70} relevant jobs, under the lowest tenth of ${pool.length} draws (${floor})`);
      const times = pool.map(other => other.fit_s).filter(value => value != null);
      if (row.fit_s != null && times.length >= MIN_POOL) {
        const slow = -lowest(times.map(value => -value), LOW_SHARE);
        if (row.fit_s > slow) alarm.push(`first relevant job at ${row.fit_s} s, slower than the slowest tenth of ${times.length} draws (${slow} s)`);
      }
    }
    why.push(...alarm);
    if (row.first_s == null && (row.path || 'first') === 'first') why.push('no relevant job reached');   // a 2nd search has no first-press times
    if ((row.in_places ?? 0) < WEAK_FLOOR) why.push(`only ${row.in_places ?? 0} jobs in the places (under ${WEAK_FLOOR})`);
    if (before.length >= MIN_HISTORY) {
      const usual = median(before.map(other => other.in_places ?? 0));
      if ((row.in_places ?? 0) < usual / 2) why.push(`jobs in places ${row.in_places ?? 0}, this role's usual ${usual}`);
    }
    return {...row, verdict: why.length ? 'weak' : 'usual', why, alarm, severity: row.fit70 === 0 ? 'high' : alarm.length ? 'medium' : null};
  });
}

// The presses of tools/persona-search/presses.jsonl plus draw.json (draw.py's or draw_wide.py's) -> the row to upload. The measured search is the last press (a field change or a
// repeat is press 2); its times are the first press's (only press 1 has them); the AI dollars add up every press. A crash in any press fails the draw.
// A Free AI draw (engine 'free', jobs/persona-search/free-ai-local.mjs): its dollars and refused calls are the relay's own meter (info.free_ai), not the engine's Haiku prices.
export function rowFromDraw(info, presses, {build}) {
  const list = [presses].flat(), press = list.at(-1), ttfr = list[0].ttfr || {}, crash = list.flatMap(one => one.crashes || [])[0], free = info.free_ai;
  const spent = free ? [free.usd] : list.map(one => one.funnel?.ai_usd).filter(value => typeof value === 'number');
  const refused = free ? {ai_refused: Object.values(free.refused || {}).reduce((sum, n) => sum + n, 0)} : {};
  return {draw_date: info.seed, seed: info.seed, family: info.family || info.kind, city: info.city, country: info.country, build, state: crash ? 'failed' : 'ok', failed_step: crash?.step,
    first_s: list.length === 1 ? ttfr.first_in_places_s ?? null : null, tenth_s: list.length === 1 ? ttfr.tenth_in_places_s ?? null : null, fit_s: list.length === 1 ? ttfr.first_fit70_s ?? null : null,
    in_places: press.in_places ?? null, scored: press.scored_in_places ?? null, fit70: press.fit70_in_places ?? null,
    role: info.role?.title ?? null, place_kind: info.place_kind ?? null, place: info.place ?? null, path: info.path ?? null, engine: info.engine ?? null,
    ai_usd: spent.length ? Math.round(spent.reduce((sum, value) => sum + value, 0) * 1000) / 1000 : null, funnel: press.funnel ? {...Object.fromEntries(Object.entries(press.funnel).filter(([key]) => FUNNEL.includes(key) || key === 'kinds')), ...refused} : null};
}
