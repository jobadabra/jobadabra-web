// The two routes the "Send to AI" run (ai-fixer.yml in the public repo; feedback-ai.yml before 5 Nov 2026) calls, proved by GitHub's own run token (OIDC), never by a shared secret:
//   GET  /api/feedback/brief?ref=<16 hex>      what the AI may read about one feedback (shared/feedback-ai.js briefOf)
//   POST /api/feedback/ai-status {ref, status: pr|none|failed|cap|busy|merged|closed, pr?, verdict?, why?}   the run reports; the card moves (shared/feedback-actions.js, internal actions)
// Spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md (PR 7/7). Guarded by test/unit/admin/feedback-ai.test.js.
// Authenticity (owner's rule: a run is trusted only when GitHub says so): the token's audience is `jobadabra-feedback`, its repository the public repo (env.TIMERS_REPO), its workflow_ref exactly
// `<repo>/.github/workflows/feedback-ai.yml@refs/heads/main` or ai-fixer.yml@refs/heads/main (the file as merged, never a branch's copy), its event workflow_dispatch (the run the owner's click started) or, for merged/closed,
// pull_request_target from feedback-ai-closed.yml (or feedback-ai.yml until it moves) (runs main's file, never a PR's). And the card must be in the state the step needs, inside the hour. A fork's run has no token at all.
import {act} from '../shared/feedback-actions.js';
import {readCardRun} from '../shared/feedback-runs.js';
import {AUDIENCE, CLOSE_WORKFLOW, FIXER_WORKFLOW, STALE_MS, WORKFLOW, briefOf} from '../shared/feedback-ai.js';
import {releasePr} from '../shared/feedback-reply.js';
import {githubJwks, verifyRunToken} from '../shared/github-oidc.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const jwks = githubJwks();   // GitHub's signing keys, cached an hour per isolate
// Why (5 Nov 2026, owner: "Yes, rename + fold"): merged and closed come only from feedback-ai-closed.yml since jobadabra's close job left feedback-ai.yml (plan 2026-11-05-check-names 3/4), so a normal PR's close draws one row, not seven.
const RUNNERS = [WORKFLOW, FIXER_WORKFLOW];   // the two workflows a card's click may start; each only as merged on main, only the dispatch event
const STEPS = {pr: ['ai_pr', 'workflow_dispatch', RUNNERS], none: ['ai_none', 'workflow_dispatch', RUNNERS], failed: ['ai_failed', 'workflow_dispatch', RUNNERS],
  cap: ['ai_failed', 'workflow_dispatch', [FIXER_WORKFLOW]], busy: ['ai_failed', 'workflow_dispatch', [FIXER_WORKFLOW]],
  merged: ['ai_merged', 'pull_request_target', [CLOSE_WORKFLOW]], closed: ['ai_closed', 'pull_request_target', [CLOSE_WORKFLOW]]};

/** The run's verified claims, or null (no token, wrong token, wrong repo/workflow/event). `events`: the event names this step accepts; `files`: the workflow files it trusts, each only as merged on main. Never says which check failed. */
async function claimsOf(request, env, events, deps, files = RUNNERS) {
  const jwt = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!jwt || !env.TIMERS_REPO) return null;
  try {
    const claims = await verifyRunToken(jwt, {jwks: deps.jwks || jwks, audience: AUDIENCE, repository: env.TIMERS_REPO, now: deps.now?.getTime() ?? Date.now()});
    return files.some(file => claims.workflow_ref === `${env.TIMERS_REPO}/.github/workflows/${file}@refs/heads/main`) && events.includes(claims.event_name) ? claims : null;
  } catch { return null; }
}

const fresh = (row, now) => row?.state_at && now.getTime() - new Date(row.state_at).getTime() < STALE_MS;

/** GET /api/feedback/brief: binds the run to the card (the first run id to ask wins) and serves the brief. */
export async function brief(request, env, now = new Date(), deps = {}) {
  if (request.method !== 'GET' || !env.STATS) return new Response(null, {status: 405});
  const claims = await claimsOf(request, env, ['workflow_dispatch'], {...deps, now});
  if (!claims) return json({ok: false, error: 'unauthorized'}, 401);
  const ref = new URL(request.url).searchParams.get('ref') || '';
  if (!/^[0-9a-f]{16}$/.test(ref)) return json({ok: false, error: 'unknown feedback'}, 400);
  const row = await env.STATS.prepare('SELECT state, state_at, ai_run FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row || row.state !== 'ai_running' || !fresh(row, now)) return json({ok: false, error: 'this feedback is not waiting for a run'}, 409);
  const run = String(claims.run_id || '');
  if (!run) return json({ok: false, error: 'unauthorized'}, 401);
  const at = now.toISOString();
  await env.STATS.batch([
    env.STATS.prepare("UPDATE feedback SET ai_run = ?, ai_run_url = ? WHERE ref = ? AND state = 'ai_running' AND ai_run = ''").bind(run, `https://github.com/${claims.repository}/actions/runs/${run}`, ref),
    env.STATS.prepare("INSERT INTO feedback_log (at, ref, who, action, detail) SELECT ?, ?, ?, 'ai_brief', 'run bound' WHERE changes() > 0").bind(at, ref, `ai (run ${run})`),
  ]);
  const bound = await env.STATS.prepare('SELECT ai_run FROM feedback WHERE ref = ?').bind(ref).first();
  if (bound?.ai_run !== run) return json({ok: false, error: 'another run took this feedback'}, 409);
  const body = await briefOf(env, ref);
  return body ? json({ok: true, brief: body}) : json({ok: false, error: 'unknown feedback'}, 404);
}

/** POST /api/feedback/ai-status: the run reports a step; the card moves with its log line (who: `ai (run N)`). */
export async function status(request, env, now = new Date(), deps = {}) {
  if (request.method !== 'POST' || !env.STATS) return new Response(null, {status: 405});
  const body = await request.json().catch(() => null);
  const step = body && typeof body === 'object' && Object.hasOwn(STEPS, body.status) ? STEPS[body.status] : null;
  if (!step) return json({ok: false, error: 'status is pr, none, failed, cap, busy, merged or closed'}, 400);
  const [action, event, files] = step, claims = await claimsOf(request, env, [event], {...deps, now}, files);
  if (!claims) return json({ok: false, error: 'unauthorized'}, 401);
  const ref = String(body.ref || '');
  if (!/^[0-9a-f]{16}$/.test(ref)) return json({ok: false, error: 'unknown feedback'}, 400);
  const row = await env.STATS.prepare('SELECT state, state_at, ai_run, pr_url FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row) return json({ok: false, error: 'unknown feedback'}, 404);
  const refusal = body.status === 'cap' || body.status === 'busy';
  if (event === 'workflow_dispatch') {   // refusals happen before the brief; other reports must own the bound run
    if (!fresh(row, now) || !claims.run_id || (refusal ? row.state !== 'ai_running' || row.ai_run !== '' : row.ai_run !== String(claims.run_id))) return json({ok: false, error: 'this run does not own that feedback'}, 409);
  } else if (!releasePr(row.pr_url) || releasePr(row.pr_url) !== releasePr(body.pr)) {   // merged/closed: only for the PR the card holds
    return json({ok: false, error: 'that is not the pull request of this feedback'}, 409);
  }
  if (refusal && !await readCardRun(env, {...row, ref}, String(claims.run_id), deps.fetch).catch(() => null)) return json({ok: false, error: 'this run is not the current feedback attempt'}, 409);
  const why = body.status === 'cap' ? 'the daily AI run limit was reached; try again when the limit resets.'
    : body.status === 'busy' ? 'another AI run is still going; try again when it finishes.' : body.why;
  const done = await act(env, {ref, action, pr: body.pr, verdict: body.verdict, why}, `ai (${event === 'workflow_dispatch' ? `run ${claims.run_id}` : `PR ${releasePr(body.pr)}`})`, now, {trusted: true, run: refusal ? row : undefined});
  const {status: code = 200, ...answer} = done;
  return json(answer, code);
}
