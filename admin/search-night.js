// The nightly Search check's store and its upload (owner, 6 Nov 2026: "the nightly search persona... I see nowhere in Admin... Am I getting alerted? I'm not alerted"): CI's search-personas.yml
// (six fictional candidates, tools/persona-search/gate.py) kept its verdict only as a GitHub artifact, so a night that measured 2 of 6 was green and unseen. PUT /search-check/night (Bearer REPLAYS_PUBLISH_KEY,
// the key every search-lab upload uses: no new secret) stores one slim record per UTC night, the last KEEP_NIGHTS, in ci_state under 'search-nights'; the Job search "Night search" tab and the Report only
// "Search" area read it back. Counts, seconds and the gate's fixed words only: no job, company or CV text. The Worker judges (admin/search-night-judge.js) and tells the owner (alert `search-check-dropped`,
// once a day by the switchboard), so CI sends nothing but the verdict. Guard: test/unit/admin/search/search-night.test.js.
import {equal} from '../shared/guard.js';
import {alertOwner} from '../shared/notify-send.js';
import {writeState} from './ci-state.js';
import {COUNTERS} from './search-night-counters.js';
import {alertText, judgeAll} from './search-night-judge.js';

export const STATE_KEY = 'search-nights', KEEP_NIGHTS = 30, MAX_BYTES = 65536, MAX_ROWS = 40;   // Why (6 Nov 2026): 18 fixed personas a night (owner: "6 personas is too narrow"); the cap was 12 and would have refused the first 18-persona verdict with a 400, silent again. 40 leaves room; 18 rows are about 20 KB of the 64 KB
// The row kinds of the gate (tools/persona-search/gate.py row_verdict): 🟢 measured, ⚪ none-right (scored, none right role and place), ⚪ nothing (no job scored), unmeasured (errored, refused or too slow), fault.
export const KINDS = ['measured', 'none-right', 'nothing', 'unmeasured', 'fault'];
const DAY = /^\d{4}-\d\d-\d\d$/, RUN = /^\d{1,20}$/, RAN_OUT = 'time ran out for: ';
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const count = value => (Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : null);
// The press's step counters (tools/persona-search/gate.py row 'counters'): whole numbers or null; no counters object = nothing claimed (null), never zeros.
const counters = raw => (raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(COUNTERS.map(({key}) => [key, count(raw[key])])) : null);

// The steps a press ran out of time for, from the gate's funnel note ("...; time ran out for: employer sites, job boards"): the gate writes the note's last part from a list, so a comma splits it.
// Why (6 Nov 2026): the verdict carries only this note, not the list; the real notes of 5 and 6 Nov are pinned in the test, so a wording change in the gate fails here instead of silently ending the alert.
export function ranOutOf(note) {
  const at = String(note ?? '').indexOf(RAN_OUT);
  return at < 0 ? [] : String(note).slice(at + RAN_OUT.length).split(';')[0].split(',').map(step => text(step, 40)).filter(Boolean).slice(0, 8);
}

/** A verdict.json as CI uploads it -> the record kept for one night: {night, run, state, head, rows: [{persona, label, kind, why, local, found, seconds, ranOut, counters}]}, or {error}. Counts are whole numbers or null. */
export function clean(verdict, {night, run = null} = {}, now = new Date()) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return {error: 'the verdict is an object'};
  if (!DAY.test(night || '') || Number.isNaN(Date.parse(night))) return {error: 'night is YYYY-MM-DD'};
  if (night > new Date(now.getTime() + 86400000).toISOString().slice(0, 10)) return {error: 'night is not in the future'};   // Why (6 Nov 2026, review): a night dated 2099 would sort newest for 30 nights and every real night after it would be "not the newest", so no alert
  if (run != null && !RUN.test(run)) return {error: 'run is the number of the workflow run'};
  const rows = verdict.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) return {error: `rows are 1 to ${MAX_ROWS} personas`};
  return {night, run, state: text(verdict.state, 20), head: text(verdict.head, 300), rows: rows.map((row, index) => ({
    persona: Number.isInteger(row.persona) && row.persona > 0 && row.persona < 100 ? row.persona : index + 1, label: text(row.label, 80), kind: KINDS.includes(row.kind) ? row.kind : 'unknown', why: text(row.why, 120),
    local: count(row.local), found: count(row.found), seconds: count(row.seconds), ranOut: ranOutOf(row.funnel_note), counters: counters(row.counters)}))};
}

/**
 * The stored nights, newest first. Throws when the store cannot be read (a page says "could not be read", never an empty list that looks like "no night yet"); no row is [].
 * @param {object} env the Worker env (STATS D1)
 */
export async function nights(env) {
  const row = await env.STATS.prepare('SELECT body FROM ci_state WHERE key = ?').bind(STATE_KEY).first();
  const list = row ? JSON.parse(row.body)?.nights : [];
  return (Array.isArray(list) ? list : []).filter(night => night && DAY.test(night.night || '') && Array.isArray(night.rows));
}

export const REFERENCE_KEY = 'search-reference';
/**
 * The latest weekly reference per persona id: {<persona>: {total, reachable, eures, google}} (counts of right local jobs that exist, read outside the app; no job or employer text), {} until the weekly job has stored one.
 * Why (6 Nov 2026, owner: "how to know if it's a good or bad result?"): the tab's "found N of X"; the record's shape is fixed here so the weekly job writes what the tab reads. Throws when the store cannot be read.
 * @param {object} env the Worker env (STATS D1)
 */
export async function reference(env) {
  const row = await env.STATS.prepare('SELECT body FROM ci_state WHERE key = ?').bind(REFERENCE_KEY).first();
  const personas = row ? JSON.parse(row.body)?.personas : null;
  if (!personas || typeof personas !== 'object' || Array.isArray(personas)) return {};
  return Object.fromEntries(Object.entries(personas).filter(([id]) => /^\d{1,3}$/.test(id)).map(([id, item]) => [Number(id), {total: count(item?.total), reachable: count(item?.reachable), eures: count(item?.eures), google: count(item?.google)}]));
}

const answer = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

/** Stores one night (an upload of the same night replaces it), keeps the newest KEEP_NIGHTS, judges the night, and tells the owner when the NEWEST night dropped (an older night filled in late is never news). */
export async function ingest(env, verdict, {night, run}, now = new Date(), fetcher = fetch) {
  const record = clean(verdict, {night, run}, now);
  if (record.error) return {status: 400, body: {ok: false, error: record.error}};
  const kept = [{...record, at: now.toISOString()}, ...(await nights(env)).filter(item => item.night !== night)].sort((a, b) => b.night.localeCompare(a.night)).slice(0, KEEP_NIGHTS);
  await writeState(env, STATE_KEY, {nights: kept}, now);
  const judged = judgeAll(kept).find(item => item.night === night);
  if (!judged) return {status: 200, body: {ok: true, night, stored: false, why: `older than the last ${KEEP_NIGHTS} nights`}};
  let alert = null;
  if (judged.dropped && kept[0].night === night) {
    const told = await alertOwner(env, 'search-check-dropped', {text: alertText(judged), link: `${env.SITE_URL || 'https://www.jobadabra.top'}/admin/job-search/lab?tab=night`, level: 'problem', state: `night ${night}`, fetcher, now})
      .catch(error => ({sent: false, via: 'none', why: `error: ${String(error?.message).slice(0, 80)}`}));
    alert = told.sent ? 'sent' : told.why || told.via;
  }
  return {status: 200, body: {ok: true, night, measured: judged.measured, total: judged.total, dropped: judged.dropped, reasons: judged.reasons, alert}};
}

/** PUT /search-check/night?night=YYYY-MM-DD&run=<workflow run>: the verdict as the body (Bearer REPLAYS_PUBLISH_KEY). A wrong or missing key and a missing store are a plain 404; the night defaults to today (UTC). */
export async function ingestRoute(request, env, now = new Date(), fetcher = fetch) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || !env.STATS) return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > MAX_BYTES) return answer(413, {ok: false, error: `the verdict is over ${MAX_BYTES} bytes`});
  let verdict;
  try { verdict = JSON.parse(body); } catch { return answer(400, {ok: false, error: 'the body is not JSON'}); }
  const query = new URL(request.url).searchParams;
  const result = await ingest(env, verdict, {night: query.get('night') || now.toISOString().slice(0, 10), run: query.get('run') || null}, now, fetcher);
  return answer(result.status, result.body);
}
