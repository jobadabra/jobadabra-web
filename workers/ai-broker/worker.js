// The AI broker (specs docs/superpowers/specs/2026-11-01-ai-broker-design.md here and 2026-10-28-ci-on-codex-subscription-design.md in the public repo): every CI, scheduled and benchmark AI call runs here, today on the owner's one ChatGPT/Codex login.
// Why (1 Nov 2026, owner): renamed from codex-broker. The Durable Object class is still `CodexBroker`: the namespace transfer from the old Worker needs the same class name on both sides (proven on a throwaway pair); the class is renamed in the cleanup PR.
// A job proves itself with GitHub's per-run OIDC token (lib/oidc.mjs); the login lives only in this Durable Object's storage and is written through after every call, before the reply is sent.
// One `ENGINE` var names the engine that answers first (codex by default); the others follow in a fixed order and answer only when the one before ran out or is not configured (lib/engines.mjs). Other refusals retain their existing controls.
import {Container, getContainer} from '@cloudflare/containers';
import {verifyRunToken, githubJwks} from './lib/oidc.mjs';
import {laneOf} from './lib/lanes.mjs';
import {allow, newMeter, record, recordCall, callsToday} from './lib/budget.mjs';
import {refuseReply} from './lib/guard.mjs';
import {slots} from './lib/queue.mjs';
import {modelOf, validEffort, weightOf, EFFORTS} from './lib/tiers.mjs';
import {exhausted, fallbackToday, newNote, apiPrecheck, apiStep, apiFinish, noteOnce} from './lib/fallback.mjs';
import {chainOf, configured, recordOutcome, engineHealth, CHOICES} from './lib/engines.mjs';
import {CLAUDE_MODELS} from './lib/tiers.mjs';
import {demotedNow, recordPerf} from './lib/adapt.mjs';
import {addCall, recentDays, tokensOf, workflowKey, workflowOf} from './lib/tally.mjs';

export {ContainerProxy} from '@cloudflare/containers';   // required by the outbound host list below: without it every start fails with "ctx.exports.ContainerProxy is undefined" (28 Oct 2026)

const PARALLEL = 4;  // PR 0 (28 Oct 2026): 4 at once, 60 of 60 answered
const CLAUDE_PARALLEL = 3;
const HOSTS = ['chatgpt.com', 'auth.openai.com', 'api.openai.com', 'api.anthropic.com'];   // the only hosts the container may reach (the reply is the only way out); api.anthropic.com is the Claude engine's (1 Nov 2026), measured: telemetry is off, so nothing else is needed
const pass = req => fetch(req);
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export class CodexBroker extends Container {
  constructor(ctx, env) {
    super(ctx, env);
    this.brokerEnv = env;
    // Why (1 Nov 2026): the Claude subscription's token reaches the container as an environment variable and only the Claude call reads it (container/server.mjs passes explicit environments to every child); it is never in the image, a reply or a log.
    this.envVars = env.CLAUDE_CODE_OAUTH_TOKEN ? {CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN} : {};
  }
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = false;
  // Why (28 Oct 2026, Cloudflare docs): with the internet off, HTTPS fails unless it is intercepted; allowedHosts makes the list deny-by-default. The container trusts the platform CA (server.mjs builds the bundle).
  interceptHttps = true;
  allowedHosts = HOSTS;
  static outboundByHost = Object.fromEntries(HOSTS.map(h => [h, pass]));
  gate = slots(PARALLEL);
  claudeGate = slots(CLAUDE_PARALLEL);   // Why (1 Nov 2026): one Claude CLI call peaks near 210 MB (measured) and the container has 1 GiB, so at most 3 at once, and each also holds one of the 4 shared slots
  limits = null;   // the last whole-week reading from Codex: {usedPercent, resetsAt}

  // Start (and every restart after a sleep): put the stored login back into CODEX_HOME.
  async onStart() {
    const login = await this.ctx.storage.get('login');
    if (login) await this.containerFetch('http://c/auth', {method: 'POST', body: login});
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/login' && request.method === 'POST') return this.setLogin(await request.text());
    if (url.pathname === '/health') return this.health();
    if (url.pathname === '/call' && request.method === 'POST') return this.call(request.headers.get('x-lane'), await request.json(), workflowKey(request.headers.get('x-workflow')));
    if (url.pathname === '/stop' && request.method === 'POST') { await this.stop(); return json(200, {stopped: true}); }   // the owner's kill test (admin route in front)
    return json(404, {error: 'not found'});
  }

  // The owner's one-time upload. Refused once a login is stored unless it is the first one after "login-lost" cleared it.
  async setLogin(text) {
    if ((await this.ctx.storage.get('login')) && !(await this.ctx.storage.get('lost'))) return json(409, {error: 'a login is already stored and working'});   // an upload replaces it only after login-lost (Gitar #221: it could never be re-uploaded)
    try { if (!JSON.parse(text).tokens) throw new Error(); } catch { return json(400, {error: 'not a Codex auth.json'}); }
    await this.ctx.storage.put('login', text);
    await this.ctx.storage.delete('lost');
    await this.containerFetch('http://c/auth', {method: 'POST', body: text});
    return json(200, {ok: true});
  }

  async health() {
    const meter = (await this.ctx.storage.get('meter')) || newMeter(0);
    // Daily counts describe today, even before the first call after UTC midnight.
    return json(200, {state: (await this.ctx.storage.get('login')) ? ((await this.ctx.storage.get('lost')) ? 'login-lost' : 'ready') : 'no-login', limits: this.limits, own: meter.tokens, daily: {drift: callsToday(meter, 'drift')}, tally: recentDays(await this.ctx.storage.get('tally')), queue: this.gate.stats(), fallback: await fallbackToday(this.ctx.storage, this.brokerEnv), ...(await engineHealth(this.ctx.storage, this.brokerEnv, new Date(Date.now()).toISOString().slice(0, 10)))});
  }

  // The owner-visible refusals of the Codex login: they stand when Codex is reached, another engine does not hide them.
  async loginRefusal() {
    if (!(await this.ctx.storage.get('login'))) return json(503, {why: 'no-login'});
    if (await this.ctx.storage.get('lost')) return json(503, {why: 'login-lost'});
    return null;
  }

  // One call, answered and then counted for its workflow (lib/tally.mjs). The count never changes the answer: a tally that cannot be written is logged and the reply goes out.
  async call(lane, body, workflow = 'unknown') {
    const started = Date.now();
    const reply = await this.answer(lane, body);
    await this.countCall(workflow, reply, Date.now() - started).catch(error => console.log(`tally: ${String(error?.message || error).slice(0, 200)}`));
    return reply;
  }

  // Reads the finished reply's own tokens, engine and time (a refusal has none and still counts as a call), then adds them to today's row in one transaction.
  async countCall(workflow, reply, elapsed) {
    const data = reply.ok ? await reply.clone().json().catch(() => ({})) : {};
    const outcome = {ok: reply.ok, tokens: tokensOf(data.tokens), ms: Number.isFinite(data.ms) ? data.ms : elapsed, engine: reply.ok ? String(data.engine || '') : ''};
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    await this.ctx.storage.transaction(async storage => { await storage.put('tally', addCall(await storage.get('tally'), day, workflow, outcome)); });
  }

  async answer(lane, body) {
    if (Object.hasOwn(body, 'search') && typeof body.search !== 'boolean') return json(400, {why: 'search must be a boolean'});
    if (Object.hasOwn(body, 'effort') && !validEffort(body.effort)) return json(400, {why: `effort must be ${EFFORTS.slice(0, -1).join(', ')} or ${EFFORTS.at(-1)}`});
    if (Object.hasOwn(body, 'engine') && !CHOICES.includes(body.engine)) return json(400, {why: `engine must be ${CHOICES.slice(0, -1).join(', ')} or ${CHOICES.at(-1)}`});
    if (Object.hasOwn(body, 'only') && typeof body.only !== 'boolean') return json(400, {why: 'only must be a boolean'});
    if (body.only && !Object.hasOwn(body, 'engine')) return json(400, {why: 'only needs an engine: only this engine answers, or the call is refused'});
    const model = modelOf(body.tier);
    if (!model) return json(400, {why: `unknown tier "${String(body.tier).slice(0, 20)}" (small, mid or large)`});
    const env = this.brokerEnv, {chain} = chainOf(env, body.engine, body.engine === undefined ? await demotedNow(this.ctx.storage, env) : [], body.only === true);   // an engine doing worse is moved back (lib/adapt.mjs) unless this call names its own   // body.engine = this one call's own first choice (e.g. one workflow trying claude); admission and caps stay the same
    // Why (1 Nov 2026): with Codex first a refused login never counts toward the daily cap (as before the chain); with another engine first Codex's step checks it when reached.
    if (chain[0] === 'codex') { const refusal = await this.loginRefusal(); if (refusal) return refusal; }
    this.limits ||= (await this.ctx.storage.get('limits')) || null;   // kept in storage: an eviction must not switch the whole-week brake off (Gitar #221)
    if (this.limits?.resetsAt && this.limits.resetsAt <= Date.now() / 1000) this.limits = null;
    // `others` can answer when Codex has run out; `later` is the part of the chain after Codex.
    const others = chain.filter(engine => engine !== 'codex' && configured(engine, env));
    const later = chain.slice(chain.indexOf('codex') + 1).filter(engine => configured(engine, env));
    // Check and persist admission together: concurrent calls and reruns share one UTC allowance, whichever engine answers.
    // No refund on a queue/transport/model failure; the reservation commits before an engine is called.
    const verdict = await this.ctx.storage.transaction(async storage => {
      let meter = (await storage.get('meter')) || newMeter(0);
      const now = Date.now() / 1000;
      if (meter.resetsAt && meter.resetsAt <= now) meter = {...newMeter(0), daily: meter.daily};
      const check = allow(lane, meter, this.limits?.usedPercent ?? null, undefined, now);
      if (!check.ok && exhausted(check.why) && others.length) {
        await storage.put('meter', recordCall(meter, lane, now));
        return {...check, ranOut: true};   // the Codex week is used up: Codex's step passes, the others may answer
      }
      if (check.ok) await storage.put('meter', recordCall(meter, lane, now));
      return check;
    });
    if (!verdict.ok && !verdict.ranOut) return json(429, {why: verdict.why});   // the daily cap, or an exhausted week with nobody else configured: a control no other engine bypasses
    const note = newNote(), ctx = {storage: this.ctx.storage, env, body, lane, weekUsedPercent: this.limits?.usedPercent ?? null, note}, day = new Date(Date.now()).toISOString().slice(0, 10), skipped = [];
    const skip = async (engine, why, counted = true, detail = '') => { skipped.push({engine, why, ...(detail ? {detail} : {})}); if (why === 'failed') await recordPerf(this.ctx.storage, env, engine, false); return counted ? recordOutcome(this.ctx.storage, day, engine, why === 'ran-out' ? 'ranOut' : 'failed') : null; };
    for (const engine of chain) {
      const started = Date.now();
      let reply = null;
      if (engine === 'codex') { reply = await this.codexStep(lane, body, model, verdict, later.length > 0, chain[0] === 'codex'); if (!reply) await skip(engine, 'ran-out'); }
      else if (engine === 'claude') reply = await this.claudeStep(lane, body, skip);
      else if (engine === 'claude-api' || engine === 'free-ai') {
        reply = (!body.search && apiPrecheck(body)) || await apiStep(engine === 'claude-api' ? 'claude' : 'free-ai', ctx);
        if (!reply && !body.search && configured(engine, env)) await skip(engine, 'unavailable');
      }
      if (!reply) continue;
      // Why (1 Nov 2026, Gitar on #289): an engine that sits BEFORE Codex and answers badly (refused, truncated, invalid JSON) must not end the chain while Codex has not run; after Codex a refusal stays the last-resort answer it always was. A 400 (empty prompt) is nobody's answer to retry.
      if (!reply.ok && reply.status !== 400 && chain.indexOf(engine) < chain.indexOf('codex')) { await skip(engine, 'bad-answer'); continue; }
      await recordOutcome(this.ctx.storage, day, engine, reply.ok ? 'ok' : 'failed', Date.now() - started);
      if (reply.ok || reply.status === 502) await recordPerf(this.ctx.storage, env, engine, reply.ok);   // a real answer or a broken run; a refusal, a lost login or a 4xx says nothing about the engine
      // Why (1 Nov 2026, owner: CI jobs "need to be aware" which model answers, models behave differently): a reply names its engine and model, and `fellBack` lists the engines that were tried first and did not answer, with the reason.
      if (reply.ok && skipped.length) return json(200, {...(await reply.json()), fellBack: skipped});
      return reply;
    }
    if (body.only === true) {
      if (chain[0] === 'free-ai' || chain[0] === 'claude-api') return apiFinish(env, note);   // Why (Gitar on #296): their own reasons stay: fallback:search-unsupported, fallback:unavailable, the 429 day cap
      return json(503, {why: `only-${chain[0]}: ${skipped.find(entry => entry.engine === chain[0])?.why ?? (configured(chain[0], env) ? 'unavailable' : 'not-configured')}`, engine: chain[0], tried: skipped});   // strict call: nobody else answers, and the reason is named
    }
    return apiFinish(env, note);
  }

  // Codex's step: a Response when Codex answered or refused for good, null when it ran out and a later engine is configured.
  async codexStep(lane, body, model, verdict, hasLater, loginChecked) {
    if (!loginChecked) { const refusal = await this.loginRefusal(); if (refusal) return refusal; }
    if (verdict.ranOut) return hasLater ? null : json(429, {why: verdict.why});
    const release = await this.gate.acquire(lane === 'drift' ? 'scheduled' : lane);   // nightly drift shares scheduled queue priority
    try {
      const reply = await this.containerFetch('http://c/call', {method: 'POST', body: JSON.stringify({...body, engine: undefined, only: undefined, model})});
      const text = await reply.text();
      let answer;
      try { answer = JSON.parse(text); } catch { return json(502, {why: `container: ${text.slice(0, 300)}`}); }   // the platform's own error text (not our server's JSON): say it, never crash (a 1101 hid it, 28 Oct 2026)
      if (answer.authFile) await this.ctx.storage.put('login', answer.authFile);   // write-through BEFORE the reply goes out: a rotated token is never only in the container
      if (!reply.ok && exhausted(answer.error) && hasLater) return null;
      if (!reply.ok) { if (answer.error === 'login-lost') await this.ctx.storage.put('lost', true); return json(reply.status === 500 && answer.error === 'login-lost' ? 503 : 502, {why: refuseReply(answer.error) ? 'codex-failed (detail withheld: token-shaped)' : answer.error}); }
      if (answer.limits) { this.limits = answer.limits; await this.ctx.storage.put('limits', answer.limits); }
      const used = (answer.tokens.input + answer.tokens.output) * weightOf(body.effort);   // a higher effort counts for more of the week (lib/tiers.mjs EFFORT_WEIGHT)
      // Completions also transact: a token write must never overwrite a newer daily reservation.
      await this.ctx.storage.transaction(async storage => {
        const latest = (await storage.get('meter')) || newMeter(0);
        await storage.put('meter', record(latest, lane, used, Date.now() / 1000, answer.limits?.resetsAt));
      });
      const refused = refuseReply(answer.reply);
      if (refused) return json(422, {why: refused});
      return json(200, {reply: answer.reply, tokens: answer.tokens, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, weekUsedPercent: this.limits?.usedPercent ?? null, engine: 'codex'});
    } finally { release(); }
  }

  // Why (1 Nov 2026, first live Claude call failed with no reason shown): a failed Claude step says why in `fellBack[].detail` and /health `lastError`, scrubbed: nothing token-shaped, at most 200 characters.
  async claudeFailed(skip, text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const detail = (refuseReply(clean) ? '(detail withheld: token-shaped)' : clean).slice(0, 200);
    const state = (await this.ctx.storage.get('claude:state')) || {};
    await this.ctx.storage.put('claude:state', {...state, lastError: {at: Date.now(), text: detail}});
    await skip('claude', 'failed', true, detail);
  }

  // The Claude subscription's step: a Response when it answered (or refused a token-shaped reply), null when it is not configured, backing off, out of allowance (waits for the reset the CLI reports) or failed.
  // Why (1 Nov 2026): only measured signals say "ran out" (the CLI's own rate_limit_event or a limit message); an unknown failure is a plain failure and the chain moves on. An invalid token is shown in /health and sent to Telegram once a day.
  async claudeStep(lane, body, skip) {
    const env = this.brokerEnv, storage = this.ctx.storage;
    if (!env.CLAUDE_CODE_OAUTH_TOKEN) return null;   // no token = not configured (search is Claude's too since 2 Nov 2026: the WebSearch tool)
    const now = Date.now(), state = (await storage.get('claude:state')) || {};
    if ((state.invalidUntil || 0) > now) { skip('claude', 'token-invalid', false); return null; }
    if ((state.limitUntil || 0) > now) { skip('claude', 'ran-out', false); return null; }
    const model = CLAUDE_MODELS[body.tier ?? 'mid'];
    const priority = lane === 'drift' ? 'scheduled' : lane, releaseClaude = await this.claudeGate.acquire(priority), release = await this.gate.acquire(priority);
    try {
      const reply = await this.containerFetch('http://c/claude', {method: 'POST', body: JSON.stringify({prompt: body.prompt, schema: body.schema, images: body.images, model, ...(body.search === true ? {search: true} : {})})});
      let answer;
      let raw = '';
      try { raw = await reply.text(); answer = JSON.parse(raw); } catch { await this.claudeFailed(skip, 'platform: ' + raw); return null; }   // the platform's own error text, not our server's JSON
      if (answer.limits) await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), limits: answer.limits});
      if (!reply.ok) {
        const error = String(answer.error || '');
        if (error === 'claude-auth') {
          await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), invalidUntil: now + 3600_000});   // retried hourly: a new token needs no deploy of ours
          await noteOnce(storage, env, new Date(now).toISOString().slice(0, 10), 'claude-token-invalid', 'AI broker: the Claude subscription token is invalid or expired. Claude is skipped, the next engine answers. Fix: claude setup-token, then update the Worker secret CLAUDE_CODE_OAUTH_TOKEN.');
          await skip('claude', 'token-invalid');
        } else if (error === 'claude-limit') {
          const until = answer.resetsAt ? answer.resetsAt * 1000 : now + 600_000;   // the CLI's reset time, else ten minutes
          await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), limitUntil: Math.max(until, now + 60_000)});
          await skip('claude', 'ran-out');
        } else await this.claudeFailed(skip, error);
        return null;
      }
      const refused = refuseReply(answer.reply);
      if (refused) return json(422, {why: refused});
      return json(200, {reply: answer.reply, tokens: answer.tokens, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, weekUsedPercent: this.limits?.usedPercent ?? null, engine: 'claude'});
    } catch (e) { await this.claudeFailed(skip, 'call: ' + String(e?.message || e)); return null; }
    finally { release(); releaseClaude(); }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), broker = getContainer(env.BROKER);
    if (url.pathname === '/health') return broker.fetch(request);   // counts and states only, no secret
    if (url.pathname.startsWith('/admin/') && request.method === 'POST') {
      if (!env.BROKER_ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.BROKER_ADMIN_TOKEN}`) return json(401, {error: 'admin only'});
      // login = the one-time upload; call = a smoke call from the owner's Mac (lane x-lane, default scheduled); stop = kill the container to prove the login survives it
      const inner = {'/admin/login': '/login', '/admin/call': '/call', '/admin/stop': '/stop'}[url.pathname];
      if (!inner) return json(404, {error: 'not found'});
      return broker.fetch(new Request(`http://c${inner}`, {method: 'POST', body: await request.text(), headers: {'x-lane': request.headers.get('x-lane') || 'scheduled', 'x-workflow': 'admin'}}));
    }
    if (url.pathname === '/call' && request.method === 'POST') {
      let claims;
      try { claims = await verifyRunToken((request.headers.get('authorization') || '').replace(/^Bearer /, ''), {jwks: jwks(env), audience: audiences(env), repository: repositories(env)}); }
      catch (e) { return json(401, {why: String(e.message)}); }
      return broker.fetch(new Request('http://c/call', {method: 'POST', body: await request.text(), headers: {'x-lane': laneOf(claims), 'x-workflow': workflowOf(claims)}}));   // Why (3 Nov 2026, owner): built fresh from the verified claims; a header the caller sends is never forwarded
    }
    return json(404, {error: 'not found'});
  },
};

// Why (2 Nov 2026, owner: "After the lab scout proves it"; 7/7): run tokens carry the audience the caller asked for. The old name `jobadabra-codex-broker` was accepted beside this one while the callers moved; the public client (#2947) and jobadabra-lab's scout (run 41376186747, 40 of 40 AI calls answered) use the new one, so the old is gone. A list (comma-separated) stays possible.
const audiences = env => String(env.AUDIENCE || 'jobadabra-ai-broker').split(',').map(name => name.trim()).filter(Boolean);

// Why (1 Nov 2026, go-org-move): the repos are moving to the GitHub org `jobadabra` (created 21:34 UTC, owned by the owner), where the OIDC `repository` claim becomes `jobadabra/<repo>`; both owners are accepted until 7 days after the last repo has moved, then the two GarryOne names go.
// Why (1 Nov 2026, owner's pick via mac-07): central-scout.yml and product-brain.yml move to jobadabra-lab; without its name every scout AI call gets "oidc: wrong repository" and skips silently. Lanes read the workflow file, not the repo, so the two keep today's lane, tiers and caps.
// Why (31 Oct 2026, owner: "Move all 11 now"): the private site repo's changelog and digest jobs run on the Codex plan too, so the broker accepts run tokens of both repos (REPOSITORY is a comma list).
const repositories = env => String(env.REPOSITORY || 'GarryOne/jobadabra,GarryOne/jobadabra-web,GarryOne/jobadabra-lab,jobadabra/jobadabra,jobadabra/jobadabra-web,jobadabra/jobadabra-lab').split(',').map(name => name.trim()).filter(Boolean);
let jwksReader;
const jwks = () => (jwksReader ||= githubJwks());
