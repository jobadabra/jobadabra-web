// The owner's /admin/feedback/inbox page: live, newest on top, with the actions on each message. Same key or cookie as /admin. The HTML is admin/feedback-page.js; the states are shared/feedback-actions.js.
// Guarded by test/shared/feedback.test.js, feedback-files.test.js and test/admin/feedback-actions.test.js.
import {viewer, isOwner, remember} from '../shared/auth.js';
import {feedbackList, undelivered, fileOf} from '../shared/feedback.js';
import {act, actionsFor, historyOf} from '../shared/feedback-actions.js';
import {expireStale, startRun} from '../shared/feedback-ai.js';
import {validAddress} from '../shared/mail.js';
import {PAGE} from './feedback-page.js';

// GET /feedback: the owner's live page (same key or cookie as /stats). It polls /feedback?json=1 every 60 s and puts
// new messages on top, marked, so feedback can be read as it arrives. Everything is escaped on the page (textContent).
// `canAct` is true only for the owner (guests read the list and see no buttons); `actions` per row is what the state table allows.
export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (url.searchParams.has('history')) {   // the owner's log of one feedback: who did what, when
    if (!await isOwner(request, env)) return new Response('Not found', {status: 404});
    const lines = await historyOf(env.STATS, url.searchParams.get('history')).catch(() => []);
    return Response.json({lines: lines.map(line => `${String(line.at).slice(0, 16).replace('T', ' ')} UTC · ${line.who} · ${line.action}${line.detail ? ` · ${line.detail}` : ''}`)}, {headers: {'Cache-Control': 'no-store'}});
  }
  if (url.searchParams.has('json')) {
    const owner = await isOwner(request, env);
    // Why (7/7 review, 3 Nov 2026): a run that never answered was only sent back to new when someone clicked Send to AI again; the page polls, so it now clears itself within the minute.
    await expireStale(env.STATS, now).catch(() => 0);
    const rows = (await feedbackList(env.STATS, 90, now).catch(() => [])).map(row => ({...row, actions: owner ? actionsFor(row.state) : [], mailable: validAddress(row.contact)}));
    return Response.json({rows, canAct: owner, undelivered: await undelivered(env.STATS, 90, now).catch(() => 0), now: now.toISOString()}, {headers: {'Cache-Control': 'no-store'}});
  }
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

// POST /admin/growth/feedback/act {ref, action, note?, impact?}: one action on one feedback, the owner only (guests and everyone else get a 404, as the page's other routes).
// Why (3 Nov 2026): the cookie is SameSite=Strict and the body must be JSON, so a form on another site cannot send it. Every change is logged with who made it (shared/feedback-actions.js).
export async function actRoute(request, env, now = new Date(), deps = {}) {
  if (request.method !== 'POST' || !env.STATS || !await isOwner(request, env)) return new Response('Not found', {status: 404});
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return Response.json({ok: false, error: 'Send JSON.'}, {status: 415});
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ok: false, error: 'Send JSON.'}, {status: 400});
  const byKey = request.headers.has('Authorization') || new URL(request.url).searchParams.has('key'), who = byKey ? 'owner (key)' : 'owner (session)';
  // Send to AI starts a run in the public repo with the timers' token; without the token or the dispatch the action says it is not set up (shared/feedback-actions.js).
  const start = deps.dispatch && env.TIMERS_GITHUB_TOKEN && env.TIMERS_REPO ? ref => startRun(env, ref, deps.dispatch) : undefined;
  const result = await act(env, body, who, now, {start});
  const {status = 200, ...answer} = result;
  return Response.json(answer, {status, headers: {'Cache-Control': 'no-store'}});
}

// GET /admin/growth/feedback/file?ref=<16 hex>&kind=screen|logs|page|profile: one kept file, for the owner only (the same login as the page). Served as an inert type, never cached.
export async function file(request, env) {
  if (!await viewer(request, env) || !env.STATS || !env.FEEDBACK_FILES) return new Response('Not found', {status: 404});
  const url = new URL(request.url), kept = await fileOf(env.STATS, url.searchParams.get('ref'), url.searchParams.get('kind')).catch(() => null);
  const object = kept && await env.FEEDBACK_FILES.get(kept.key);
  if (!object) return new Response('Not found', {status: 404, headers: {'Cache-Control': 'no-store'}});
  return new Response(object.body, {headers: {'Content-Type': kept.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"}});
}
