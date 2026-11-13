// The Always on LinkedIn trial, the site's side (jobadabra spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md, Caps; [lg] 4/4): before each GET of LinkedIn's
// PUBLIC job search, a cloud run asks here for a turn and afterwards says what LinkedIn answered. The site is the one gate: only the owner's install gets "go" (a run on our servers by its
// run token, a run in the owner's own GitHub repo by its repo key), every cap lives here, and the cloud never holds a cookie, a session or a password.
// Routes: POST /api/linkedin/turn {url} -> {answer: cached|go|wait|no, ...}; POST /api/linkedin/answer {lease, status, word, body?} -> {ok}. Switch: env.LINKEDIN_CLOUD_TRIAL = on | off (off: 404).
// Why (owner, 13 Nov 2026, asked via AskUserQuestion: "Try both, session with the spare account" then "Both ways" and "By hand, right after merge (Recommended)"; caps "Approve as written",
// "Yes, 6 h cache", "Start at 30/day, raise on clean days"): the owner's install only, until a week of answers without a block and the owner's yes. Guard: test/unit/api/linkedin-turn.test.js.
import {digestOf} from '../shared/guard.js';
import {runOf} from '../shared/hosted.js';
import {accountOf} from '../shared/pro.js';
import {installOfTrialKey} from '../shared/trial-key.js';

export const linkedinTrialOn = env => env.LINKEDIN_CLOUD_TRIAL === 'on' && !!env.READY_OWNER && !!env.STATS;
// Why (owner, 13 Nov 2026, "Start at 30/day, raise on clean days"): 30 requests a day for all cloud runs together to start; a raise is env.LINKEDIN_CLOUD_A_DAY, never above the 200 ceiling.
export const CLOUD_REQUESTS_START = 30, CLOUD_REQUESTS_A_DAY = 200;
// Why (owner, 13 Nov 2026, "20–40 s random (Recommended)" on the Mac): the cloud keeps at least the gap's low end between two GETs whatever run asks; a lease not answered in 90 s is free again.
export const GAP_S = 20, LEASE_S = 90, STOP_HOURS = 24;
// Why (owner, 13 Nov 2026, "Yes, 6 h cache"): search pages 6 h, job pages 24 h, served only to these cloud runs, never to the index, the pack or the benchmark.
export const KEEP_HOURS = {search: 6, job: 24};
export const BODY_MAX = 400_000;
// What ends LinkedIn in the cloud for a day: the same stop rule as the Mac's read (src/sources/linkedin_guest.py).
export const STOPS = new Set([401, 403, 429, 999]), STOP_WORDS = new Set(['signin', 'check', 'wall']);
// Why (Gitar on web #627): only a body the engine marked a page (its sign-in check passed: src/sources/linkedin_guest.py) is kept; any other or no word is never served from the cache.
export const CACHED_WORD = 'page';
const SEARCH = '/jobs-guest/jobs/api/seeMoreJobPostings/search', VIEW = /^\/jobs\/view\/\d+\/?$/;
const HOUR = 3600 * 1000;
const iso = ms => new Date(ms).toISOString();
const notFound = () => new Response('Not found', {status: 404});
const deny = () => Response.json({ok: false, error: 'unauthorized'}, {status: 401});

/** The kind of a LinkedIn address the cloud may read ('search' or 'job'), or null for anything else (another host, a page behind the login). */
export function kindOf(url) {
  let at;
  try { at = new URL(String(url)); } catch { return null; }
  if (at.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(at.hostname)) return null;
  return at.pathname === SEARCH ? 'search' : VIEW.test(at.pathname) ? 'job' : null;
}

/** Which way the request comes from: 'hosted' (a run token of the owner's account), 'github' (the owner's repo key), 'other' (a valid key of someone else), or null (no valid key). */
export async function wayOf(request, env, now = new Date()) {
  const bearer = request.headers.get('authorization');
  if (bearer) {
    const run = await runOf(env, bearer, now);
    if (!run) return null;
    const owner = await accountOf(env, env.READY_OWNER);
    return owner && owner.id === run.account ? 'hosted' : 'other';
  }
  const given = await installOfTrialKey(request.headers.get('x-api-key'), env);
  if (!given) return null;
  return given.install === env.READY_OWNER ? 'github' : 'other';
}

/** Today's cap: env.LINKEDIN_CLOUD_A_DAY (a raise the owner saw), else the start; never above the ceiling. */
export function capOf(env) {
  const raw = env.LINKEDIN_CLOUD_A_DAY, given = raw === undefined || raw === '' ? CLOUD_REQUESTS_START : Number(raw);
  return Number.isFinite(given) ? Math.max(0, Math.min(CLOUD_REQUESTS_A_DAY, given)) : CLOUD_REQUESTS_START;
}

async function stopOf(env, now) {
  const row = await env.STATS.prepare('SELECT until, why FROM linkedin_stop WHERE id = 1').first();
  return row && Date.parse(row.until) > now.getTime() ? row : null;
}

const record = (env, id, now, way, kind, hash, answer) => env.STATS.prepare(
  'INSERT INTO linkedin_turns (id, asked_at, day, way, kind, url_hash, answer) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, now.toISOString(), now.toISOString().slice(0, 10), way, kind, hash, answer).run();

/** POST /api/linkedin/turn {url}: cached (the cards, no request), go (a lease for ONE GET), wait (seconds), or no (why, said once in the run's log). */
export async function turn(request, env, now = new Date()) {
  if (!linkedinTrialOn(env)) return notFound();
  if (request.method !== 'POST') return Response.json({ok: false, error: 'POST only'}, {status: 405});
  const way = await wayOf(request, env, now);
  if (!way) return deny();
  if (way === 'other') return Response.json({answer: 'no', why: 'LinkedIn in Always on is a trial on one install for now'});
  const {url} = await request.json().catch(() => ({}));
  const kind = kindOf(url);
  if (!kind) return Response.json({ok: false, error: 'only LinkedIn\'s public job search and job pages'}, {status: 400});
  const stop = await stopOf(env, now);
  if (stop) return Response.json({answer: 'no', why: `LinkedIn answered ${stop.why}: the cloud reads none until ${stop.until}`});
  const hash = await digestOf(new URL(url).href), id = `lt_${crypto.randomUUID()}`;
  const kept = await env.STATS.prepare('SELECT body FROM linkedin_cache WHERE url_hash = ? AND kept_until > ?').bind(hash, now.toISOString()).first();
  if (kept) { await record(env, id, now, way, kind, hash, 'cached'); return Response.json({answer: 'cached', body: kept.body}); }
  const day = now.toISOString().slice(0, 10), cap = capOf(env);
  // One insert decides: a second run asking in the same moment finds the first one's row (the same pattern as shared/hosted.js startRun exclusive).
  const made = await env.STATS.prepare(
    `INSERT INTO linkedin_turns (id, asked_at, day, way, kind, url_hash, answer) SELECT ?, ?, ?, ?, ?, ?, 'go'
     WHERE (SELECT COUNT(*) FROM linkedin_turns WHERE day = ? AND answer = 'go') < ?
       AND NOT EXISTS (SELECT 1 FROM linkedin_turns WHERE answer = 'go' AND (asked_at > ? OR (answered_at IS NULL AND asked_at > ?)))`)
    .bind(id, now.toISOString(), day, way, kind, hash, day, cap, iso(now.getTime() - GAP_S * 1000), iso(now.getTime() - LEASE_S * 1000)).run();
  if ((made.meta?.changes ?? made.changes) > 0) return Response.json({answer: 'go', lease: id});
  const {n} = await env.STATS.prepare("SELECT COUNT(*) AS n FROM linkedin_turns WHERE day = ? AND answer = 'go'").bind(day).first();
  if (n >= cap) return Response.json({answer: 'no', why: `the cloud's ${cap} LinkedIn reads for today are used`});
  const last = await env.STATS.prepare("SELECT asked_at, answered_at FROM linkedin_turns WHERE answer = 'go' ORDER BY asked_at DESC LIMIT 1").first();
  const free = last ? Math.max(Date.parse(last.asked_at) + GAP_S * 1000, last.answered_at ? 0 : Date.parse(last.asked_at) + LEASE_S * 1000) : now.getTime();
  return Response.json({answer: 'wait', seconds: Math.max(1, Math.ceil((free - now.getTime()) / 1000))});
}

/** POST /api/linkedin/answer {lease, status, word, body?}: what LinkedIn answered to the lease's one GET. A stop answer stops the cloud for a day; a 200's cards are kept for the cache. */
export async function answer(request, env, now = new Date()) {
  if (!linkedinTrialOn(env)) return notFound();
  if (request.method !== 'POST') return Response.json({ok: false, error: 'POST only'}, {status: 405});
  const way = await wayOf(request, env, now);
  if (way !== 'hosted' && way !== 'github') return deny();
  const given = await request.json().catch(() => ({}));
  const status = Number.isInteger(given.status) ? given.status : null, word = /^[a-z0-9-]{1,20}$/.test(given.word || '') ? given.word : null;
  const lease = typeof given.lease === 'string' ? given.lease : '';   // Why (Gitar on web #627): one string for the lookup and the update, so a lease is answered once
  const row = await env.STATS.prepare("SELECT kind, url_hash FROM linkedin_turns WHERE id = ? AND answer = 'go' AND answered_at IS NULL").bind(lease).first();
  const done = row && await env.STATS.prepare('UPDATE linkedin_turns SET status = ?, word = ?, answered_at = ? WHERE id = ? AND answered_at IS NULL').bind(status, word, now.toISOString(), lease).run();
  if (!row || (done.meta?.changes ?? done.changes) === 0) return Response.json({ok: false, error: 'no open lease'}, {status: 409});
  if (STOPS.has(status) || STOP_WORDS.has(word)) {
    // Why (Gitar on web #627): a later stop never shortens a running one
    await env.STATS.prepare('INSERT INTO linkedin_stop (id, until, why) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET until = MAX(until, excluded.until), why = excluded.why')
      .bind(iso(now.getTime() + STOP_HOURS * HOUR), String(status && STOPS.has(status) ? status : word)).run();
  } else if (status === 200 && word === CACHED_WORD && typeof given.body === 'string' && given.body.length <= BODY_MAX) {
    await env.STATS.prepare('INSERT INTO linkedin_cache (url_hash, body, kept_until) VALUES (?, ?, ?) ON CONFLICT (url_hash) DO UPDATE SET body = excluded.body, kept_until = excluded.kept_until')
      .bind(row.url_hash, given.body, iso(now.getTime() + KEEP_HOURS[row.kind] * HOUR)).run();
  }
  await env.STATS.prepare('DELETE FROM linkedin_cache WHERE kept_until < ?').bind(now.toISOString()).run();
  return Response.json({ok: true});
}
