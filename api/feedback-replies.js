// What the app reads about its own feedback (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7): the owner's "fixed" or "parked" answer, shown once on Home.
// GET /api/feedback/replies?install=<id> -> {replies: [{ref, on, excerpt, kind, fixedIn, message}]} (the install's replies not yet closed, newest first, at most 5);
// POST /api/feedback/replies/seen {install, ref} -> {ok} when the person closes one. The random install id is the key: only that device and our D1 hold it, and the answer holds nothing
// but the person's own first 80 characters, a date and the owner's one line. 60 requests an hour per install when the KV is there. Guarded by test/shared/feedback-reply.test.js.
import {markSeen, repliesFor} from '../shared/feedback-reply.js';

const INSTALL = /^[\w-]{8,64}$/, PER_HOUR = 60;
const json = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function replies(request, env, now = new Date()) {
  if (!env.STATS) return json(503, {ok: false, error: 'not configured'});
  const url = new URL(request.url), seen = url.pathname.endsWith('/seen');
  if (request.method !== (seen ? 'POST' : 'GET')) return new Response(null, {status: 405});
  const body = seen ? await request.json().catch(() => ({})) : {};
  const install = String(seen ? body.install : url.searchParams.get('install') || '');
  if (!INSTALL.test(install)) return json(400, {ok: false, error: 'give an install id'});
  if (env.WAITLIST) {   // a stuck app must not hammer D1: the hour's count lives in KV
    const key = `fbr:${install}:${now.toISOString().slice(0, 13)}`, used = Number(await env.WAITLIST.get(key).catch(() => 0)) || 0;
    if (used >= PER_HOUR) return json(429, {ok: false, error: 'too many requests'});
    await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 3700}).catch(() => {});
  }
  if (seen) return json(200, {ok: await markSeen(env.STATS, install, String(body.ref || ''), now)});
  return json(200, {ok: true, replies: await repliesFor(env.STATS, install)});
}
