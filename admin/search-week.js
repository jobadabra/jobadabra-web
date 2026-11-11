// The Search check's week (owner, 11 Nov 2026, via AskUserQuestion in session sa: "2 runs nightly, 5 runs weekly (Recommended)"; "each of the runs should provide new jobs"): once a week the
// public search-personas.yml presses each of the 18 people 5 times in one install and says what each run added (jobadabra tools/persona-search/runs.py). PUT /search-check/weekly (Bearer
// REPLAYS_PUBLISH_KEY, as the night) stores it under ci_state 'search-weeks', the last KEEP_WEEKS, apart from the nights: it never replaces a night, never feeds the night's judge and never alerts.
// The same slim rows as a night (admin/search-night.js clean) plus each person's runs and the week's by_run. Counts only. Guard: test/unit/admin/search/search-week.test.js.
import {equal} from '../shared/guard.js';
import {readState, writeState} from './ci-state.js';
import {MAX_BYTES, clean} from './search-night.js';

export const WEEK_KEY = 'search-weeks', KEEP_WEEKS = 12, MAX_RUNS = 10;
const whole = value => (Number.isInteger(value) && value >= 0 && value <= 1e6 ? value : null);
const answer = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

/** A person's `runs` as CI sends them ([{run, new_listed, new_right, right_after, seconds}]) -> [{run, newListed, newRight, rightAfter, seconds}], or null unless they are runs 1..n in order. A count that is not whole is null, never 0. */
export function cleanRuns(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_RUNS) return null;
  const runs = raw.map((item, index) => (item && typeof item === 'object' && item.run === index + 1
    ? {run: index + 1, newListed: whole(item.new_listed), newRight: whole(item.new_right), rightAfter: whole(item.right_after), seconds: whole(item.seconds)} : null));
  return runs.every(Boolean) ? runs : null;
}

/** The verdict's `by_run` ([{run, measured, people_new, new_right}]) -> [{run, measured, peopleNew, newRight}], or null unless runs 1..n in order. */
export function cleanByRun(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_RUNS) return null;
  const runs = raw.map((item, index) => (item && typeof item === 'object' && item.run === index + 1
    ? {run: index + 1, measured: whole(item.measured), peopleNew: whole(item.people_new), newRight: whole(item.new_right)} : null));
  return runs.every(Boolean) ? runs : null;
}

/** The stored weeks, newest first: [{week, at, run, byHand, rows: [... night row, runs], byRun}]; [] when none or unreadable. */
export async function weeks(env) {
  const body = await readState(env, WEEK_KEY, null);
  return (Array.isArray(body?.weeks) ? body.weeks : []).filter(item => item && Array.isArray(item.rows) && /^\d{4}-\d\d-\d\d$/.test(item.week || '')).slice(0, KEEP_WEEKS);
}

/** Store one week's verdict -> {status, body}; the same week sent again replaces itself. */
export async function ingestWeek(env, verdict, {week, run, byHand}, now = new Date()) {
  const record = clean(verdict, {night: week, run}, now);
  if (record.error) return {status: 400, body: {ok: false, error: record.error}};
  const {night, ...rest} = record;
  const kept = {...rest, week: night, at: now.toISOString(), byHand, byRun: cleanByRun(verdict.by_run), rows: rest.rows.map((row, index) => ({...row, runs: cleanRuns(verdict.rows[index].runs)}))};
  const stored = [kept, ...(await weeks(env)).filter(item => item.week !== night)].sort((a, b) => b.week.localeCompare(a.week)).slice(0, KEEP_WEEKS);
  if (!stored.some(item => item.week === night)) return {status: 200, body: {ok: true, week: night, stored: false, why: `older than the last ${KEEP_WEEKS} weeks`}};   // Why (Gitar on #550): CI must tell a dropped week from a kept one, as the night's ingest does
  await writeState(env, WEEK_KEY, {weeks: stored}, now);
  return {status: 200, body: {ok: true, week: night, stored: stored.length}};
}

/** PUT /search-check/weekly?week=YYYY-MM-DD&run=<workflow run>[&by_hand=1]: the verdict as the body (Bearer REPLAYS_PUBLISH_KEY). A wrong or missing key and a missing store are a plain 404; the week defaults to today (UTC). */
export async function weekRoute(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > MAX_BYTES) return answer(413, {ok: false, error: `the verdict is over ${MAX_BYTES} bytes`});
  let verdict;
  try { verdict = JSON.parse(body); } catch { return answer(400, {ok: false, error: 'the body is not JSON'}); }
  const query = new URL(request.url).searchParams, flag = query.get('by_hand');
  if (flag !== null && flag !== '1') return answer(400, {ok: false, error: 'by_hand is 1 or absent'});
  const result = await ingestWeek(env, verdict, {week: query.get('week') || now.toISOString().slice(0, 10), run: query.get('run') || null, byHand: flag === '1'}, now);
  return answer(result.status, result.body);
}
