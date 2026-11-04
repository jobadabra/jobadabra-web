// What the app reads about its own feedback (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7): the owner's "fixed" or "parked" answer, shown once on Home.
// GET /api/feedback/replies (header x-api-key: the app's JPF1 key) -> {replies: [{ref, on, excerpt, kind, fixedIn, message}]} (the install's replies not yet closed, newest first, at most 5);
// POST /api/feedback/replies/seen {ref} -> {ok} when the person closes one. The random install id is the key: only that device and our D1 hold it, and the answer holds nothing
// but the person's own first 80 characters, a date and the owner's one line. 60 requests an hour per install when the KV is there. Guarded by test/unit/shared/feedback-reply.test.js.
import {markSeen, repliesFor} from '../shared/feedback-reply.js';
import {parseKey} from '../shared/free-ai.js';
import {authorize} from '../shared/guard.js';

const PER_HOUR = 60;
const json = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

// Why (owner's coordinator asked, 3 Nov 2026; Gitar on #341): the install id alone is not a secret (admin shows 8 characters of it, rows and logs hold it), so the app proves itself with the
// key it already holds, JPF1.<install>.<token> (token = HMAC of the install, shared/guard.js authorize, purpose "ai"), the same proof the trial count and Free AI use. No key, no replies.
export async function replies(request, env, now = new Date()) {
  if (!env.STATS) return json(503, {ok: false, error: 'not configured'});
  const url = new URL(request.url), seen = url.pathname.endsWith('/seen');
  if (request.method !== (seen ? 'POST' : 'GET')) return new Response(null, {status: 405});
  const given = parseKey(request.headers.get('x-api-key'));
  const access = given && await authorize(env, given.install, given.token, 'ai');
  if (!access?.ok) return json(401, {ok: false, error: 'unauthorized'});
  const install = given.install;
  if (env.WAITLIST) {   // a stuck app must not hammer D1: the hour's count lives in KV
    const key = `fbr:${install}:${now.toISOString().slice(0, 13)}`, used = Number(await env.WAITLIST.get(key).catch(() => 0)) || 0;
    if (used >= PER_HOUR) return json(429, {ok: false, error: 'too many requests'});
    await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 3700}).catch(() => {});
  }
  if (seen) {
    const body = await request.json().catch(() => ({}));
    return json(200, {ok: await markSeen(env.STATS, install, String(body.ref || ''), now)});
  }
  return json(200, {ok: true, replies: await repliesFor(env.STATS, install)});
}
