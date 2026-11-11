// The weekly reference of the nightly Search check (owner, 6 Nov 2026: "how to know if it's a good or bad result?", chose "EURES direct + Google Jobs weekly"): once a week CI reads, outside the app, how many right-role
// jobs exist in each fictional candidate's city (EURES's public API and Google Jobs), and sends only counts here: PUT /search-check/reference?week=YYYY-Www (Bearer REPLAYS_PUBLISH_KEY, the key the night upload uses).
// The Night search tab shows each candidate's night against it ("found 7 of 31 on EURES"). The latest week replaces the one before: a reference is how the world is now, not a history. Counts only, no job,
// employer or link text. Read back by reference() in admin/search-night.js (same key). Guard: test/unit/admin/search/search-reference.test.js.
import {equal} from '../shared/guard.js';
import {writeState} from './ci-state.js';
import {REFERENCE_KEY} from './search-night.js';
import {cleanMarket} from './search-market.js';

export const MAX_BYTES = 32768,   // Why (10 Nov 2026, mc 5/5): 18 people x 6 sources with a status line each; 16 KB was for four counts a person
   MAX_PERSONAS = 40;
const WEEK = /^(\d{4})-W(\d\d)$/, RUN = /^\d{1,20}$/;
// A count is a whole number or null: null = that source was not read this week (no key, or it failed), never 0.
const count = value => (value == null ? null : Number.isInteger(value) && value >= 0 && value <= 1e6 ? value : undefined);

/** ISO week of a date as "YYYY-Www" (UTC), the label CI and this store agree on. */
export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const week = Math.ceil(((day - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The body CI sends -> the record kept: {week, run, personas: {<id>: {total, reachable, eures, google}}}, or {error}. `total` = right-role, right-place jobs found in both sources (one job counted once),
 * `reachable` = the part of them a person can open without signing in, `eures` / `google` = each source's own count (null = not read).
 */
export function clean(body, {week, run = null} = {}, now = new Date()) {
  const match = WEEK.exec(week || '');
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) return {error: 'week is YYYY-Www'};
  if (week > isoWeek(new Date(now.getTime() + 86400000))) return {error: 'week is not in the future'};   // Why (6 Nov 2026, review): one day of grace, not a week: a week sent ahead would be stored and the real week answered "stored: false" (a success to CI)
  if (run != null && !RUN.test(run)) return {error: 'run is the number of the workflow run'};
  const given = body?.personas;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return {error: 'personas is an object of persona id -> counts'};
  const ids = Object.keys(given);
  if (!ids.length || ids.length > MAX_PERSONAS || !ids.every(id => /^[1-9]\d?$/.test(id))) return {error: `personas are 1 to ${MAX_PERSONAS} ids, 1-99 without a leading zero`};   // Why (6 Nov 2026, review): "01" and "1" would collapse into one persona, the last one winning
  const personas = {};
  for (const id of ids) {
    const item = given[id];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {error: `persona ${id} is an object`};
    const row = {total: count(item.total), reachable: count(item.reachable), eures: count(item.eures), google: count(item.google)};
    if (Object.values(row).includes(undefined)) return {error: `persona ${id}: counts are whole numbers or null`};
    if (row.total == null || row.reachable == null) return {error: `persona ${id}: total and reachable are required`};   // Why (6 Nov 2026, review): the tab prints "N of X reachable"; with no X it would print "7 of –"
    if (row.reachable > row.total) return {error: `persona ${id}: reachable is part of total`};
    personas[Number(id)] = {...row, ...cleanMarket(item)};   // market, countedOn, sources (admin/search-market.js); a record from before 10 Nov has none
  }
  return {week, run, personas};
}

/** Stores the week's reference (it replaces the one before; an older week never replaces a newer one). -> {status, body} */
export async function ingest(env, body, {week, run}, now = new Date()) {
  const record = clean(body, {week, run}, now);
  if (record.error) return {status: 400, body: {ok: false, error: record.error}};
  const row = await env.STATS.prepare('SELECT body FROM ci_state WHERE key = ?').bind(REFERENCE_KEY).first();
  const kept = row ? JSON.parse(row.body)?.week : null;
  if (typeof kept === 'string' && kept > week) return {status: 200, body: {ok: true, week, stored: false, why: `the stored reference is from ${kept}, a newer week`}};
  await writeState(env, REFERENCE_KEY, {...record, at: now.toISOString()}, now);
  return {status: 200, body: {ok: true, week, stored: true, personas: Object.keys(record.personas).length}};
}

/** PUT /search-check/reference?week=YYYY-Www&run=<workflow run>: the counts as the body (Bearer REPLAYS_PUBLISH_KEY). A wrong or missing key and a missing store are a plain 404; the week defaults to this one (UTC). */
export async function ingestRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const text = await request.text();
  const answer = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
  if (text.length > MAX_BYTES) return answer(413, {ok: false, error: `the body is over ${MAX_BYTES} bytes`});
  let body;
  try { body = JSON.parse(text); } catch { return answer(400, {ok: false, error: 'the body is not JSON'}); }
  const query = new URL(request.url).searchParams;
  const result = await ingest(env, body, {week: query.get('week') || isoWeek(now), run: query.get('run') || null}, now);
  return answer(result.status, result.body);
}
