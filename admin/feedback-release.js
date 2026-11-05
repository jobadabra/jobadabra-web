// POST /api/feedback/released: the release workflows tell the site what a beta or stable build contains, and the site tells the reporters whose fix is in it (shared/feedback-release.js).
// Called by CI with Bearer SELFHEAL_PUBLISH_KEY, like the other uploads that feed /admin; no key configured = closed. Body {version, channel: beta|stable, prs: [numbers], cutAt: ISO}.
// -> {ok, told, waiting, matched: [{ref, told}], failed: [ref]} (refs only), which the workflow prints in its log. GET -> {ok, prs: [numbers]}: the PRs the waiting cards name (numbers only, no card). Guarded by test/unit/shared/feedback-release.test.js.
import {equal} from '../shared/guard.js';
import {tellRelease, waitingPrs} from '../shared/feedback-release.js';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

// The cut is an ISO time (what `git log --format=%cI` or Date#toISOString gives) and not in the future (a few minutes of clock skew allowed): a far-future cut would tell every card that has no link.
const cutOk = (value, now) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Date.parse(value) <= now.getTime() + 10 * 60 * 1000;

/** The route. POST tells a release's reporters; GET lists the PR numbers waiting cards name. 401 without the key, 405 for another method, 400 for a body that is not a release; nothing is told on a refusal. */
export async function released(request, env, now = new Date()) {
  if (!authorized(request, env)) return json({ok: false, error: 'unauthorized'}, 401);
  if (request.method !== 'POST' && request.method !== 'GET') return new Response(null, {status: 405});
  if (!env.STATS) return json({ok: false, error: 'not configured'}, 503);
  if (request.method === 'GET') return json({ok: true, prs: await waitingPrs(env)});   // -> {ok, prs: [numbers]}: which PRs the waiting cards name; CI checks each against the tag
  const body = await request.json().catch(() => null);
  const version = typeof body?.version === 'string' ? body.version.trim() : '';
  const prs = Array.isArray(body?.prs) && body.prs.length <= 2000 ? body.prs : null;   // over the cap is refused, never cut: a PR dropped here would never be told
  if (!/^[\w.+-]{1,40}$/.test(version) || !['beta', 'stable'].includes(body?.channel) || !prs || !prs.every(n => Number.isInteger(n) && n > 0) || !cutOk(body?.cutAt, now)) {
    return json({ok: false, error: 'give version, channel (beta or stable), prs (numbers) and cutAt'}, 400);
  }
  return json({ok: true, ...await tellRelease(env, {version, channel: body.channel, prs, cutAt: new Date(body.cutAt).toISOString()}, now)});
}
