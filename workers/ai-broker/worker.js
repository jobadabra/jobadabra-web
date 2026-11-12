// The AI broker (specs docs/superpowers/specs/2026-11-01-ai-broker-design.md here and 2026-10-28-ci-on-codex-subscription-design.md in the public repo): every CI, scheduled and benchmark AI call runs here, today on the owner's one ChatGPT/Codex login.
// Why (1 Nov 2026, owner): renamed from codex-broker. The Durable Object class is still `CodexBroker`: the namespace transfer from the old Worker needs the same class name on both sides (proven on a throwaway pair); the class is renamed in the cleanup PR.
// A job proves itself with GitHub's per-run OIDC token (lib/oidc.mjs); the login lives only in this Durable Object's storage and is written through after every call, before the reply is sent.
// One `ENGINE` var names the engine that answers first (codex by default); the others follow in a fixed order and answer only when the one before ran out or is not configured (lib/engines.mjs); Claude answers only while its seven-day window reads under 90% (lib/budget.mjs). Other refusals retain their existing controls.
import {Container, getContainer} from '@cloudflare/containers';
import {verifyRunToken, githubJwks} from './lib/oidc.mjs';
import {laneOf, queueOf, LANES} from './lib/lanes.mjs';
import {allow, linesOf, claudeAllow, claudeWeekPercent, newMeter, record, recordCall, callsToday} from './lib/budget.mjs';
import {refuseReply, loginValues} from './lib/guard.mjs';
import {slots} from './lib/queue.mjs';
import {BUSY_MS, mayPassOn} from './lib/busy.mjs';
import {modelOf, validEffort, weightOf, EFFORTS} from './lib/tiers.mjs';
import {tokenShaped, fallbackToday, newNote, apiPrecheck, freeAiStep, apiFinish, noteOnce} from './lib/fallback.mjs';
import {codexMessage, kindOf} from './container/kinds.mjs';
import {walk, answered, refused, unavailable, failed} from './lib/walk.mjs';
import {chainOf, configured, recordOutcome, engineHealth, CHOICES, SUBS} from './lib/engines.mjs';
import {CLAUDE_MODELS} from './lib/tiers.mjs';
import {demotedNow, recordPerf} from './lib/adapt.mjs';
import {addCall, addJobCall, jobKey, recentDays, tokensOf, workflowKey, workflowOf} from './lib/tally.mjs';
import {countedOf, keyedLock, markGap, planOf, sessionKey, sessionKeyOf, settle} from './lib/sessions.mjs';

export {ContainerProxy} from '@cloudflare/containers';   // required by the outbound host list below: without it every start fails with "ctx.exports.ContainerProxy is undefined" (28 Oct 2026)

// Why (11 Nov 2026, as; owner: "Let's increase the AI Broker's slot limit"): at 4 one Find jobs measure person already queued (after-1 run 43069240532: 55 of 303
// calls waited over 5 s, p90 wait 7.9 s, all 4 busy 29% of the time). On the 1 vCPU / 3 GiB container (#554) 4 at once peaked at 1.27 GiB and 0.52 CPU per minute
// (idle 0.53 GiB, so ~185 MiB a running call; Cloudflare container metrics, same window): 8 fits (~2.0 GiB); 12 (~2.75 GiB) left no room in 3 GiB. PR 0 (28 Oct 2026) measured 4.
// Since the resize to 2 vCPU / 6 GiB (11 Nov 2026) memory is no limit (8 calls = ~2.0 of 6 GiB, 12 = ~2.75).
// Why 12 (12 Nov 2026, sa; owner: "let's raise the slot count"): on 1 vCPU, 8 at once used the whole CPU (0.99 in the busiest minutes, web#558), so about 8 calls a vCPU; on 2 vCPU
// 12 is ~1.5 vCPU and leaves headroom, 16 would be the whole CPU again. Not yet measured at 12: read the container's CPU per minute and the calls' waits on the first by-hand
// Search check after the deploy, and go to 16 or back to 8 on that number, never on a guess.
const PARALLEL = 12;
const CLAUDE_PARALLEL = 3;   // Why (11 Nov 2026, as): kept at 3 though the container now has 6 GiB: more Claude calls at once were never measured on the subscription
const CALLER_WAIT_MS = 180_000, CODEX_GUARD_MS = 100_000, START_MS = 10_000;   // the callers' own wait (desktop/e2e/lib/broker-client.mjs: AbortSignal.timeout(180000), an abort is not retried), the container's Codex guard (container/server.mjs), a cold start
const DRAIN_WAIT_MS = CALLER_WAIT_MS - CODEX_GUARD_MS - START_MS;   // Why (8 Nov 2026, Gitar on #501): a call that waits for the next container must still have time to run in it before its caller gives up, or the hand-over only moves the loss; past this it is passed on like any start-up failure (Claude, Free AI) instead of answered to nobody. Calls the old container is still finishing are guarded at 100 s (Codex) and 150 s (Claude), so a drain longer than this wait costs the refused call its Codex turn, as every deploy did before
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
  claudeGate = slots(CLAUDE_PARALLEL);   // Why (1 Nov 2026): one Claude CLI call peaks near 210 MB (measured), so at most CLAUDE_PARALLEL at once, and each also holds one of the PARALLEL shared slots
  turns = keyedLock();   // one turn at a time per Codex conversation (lib/sessions.mjs); other keys and plain calls never wait
  drainWaitMs = DRAIN_WAIT_MS; drainPollMs = 1000;   // how long a call waits for a stopping container to hand over (toContainer); a test shortens both
  busyMs = BUSY_MS;   // how long a call that may pass on waits for a Claude slot (lib/busy.mjs); a test shortens it
  limits = null;   // the last whole-week reading from Codex: {usedPercent, resetsAt}

  /** The broker's own login values (the stored Codex auth.json, the Claude token) for the reply guard (lib/guard.mjs); read fresh, so a rotated token is guarded at once. Never logged or returned. */
  async login() { return loginValues(await this.ctx.storage.get('login'), this.brokerEnv.CLAUDE_CODE_OAUTH_TOKEN); }

  // Start (and every restart after a sleep): put the stored login back into CODEX_HOME.
  async onStart() {
    const login = await this.ctx.storage.get('login');
    // Why (#285, 5 Nov 2026, owner: "Fix readiness"; reworked the same day, owner: "pass on while starting"): a new container has answered nothing yet, so /health says `starting` until a real Codex call is answered (markIfAnswered), and until then a failed call is also recorded as `startError`. Since 8 Nov 2026 (bd, the walk) every failed Codex call goes to the next engine, proven container or not; "starting" only decides what /health shows. No start-up call of our own: it added a Codex call per start and protected no user.
    await this.ctx.storage.put('answered', false);
    await this.ctx.storage.put('startError', null);   // the last container's failure is not this one's
    if (login) await this.containerFetch('http://c/auth', {method: 'POST', body: login});
  }

  // A failed Codex turn as a verdict (lib/walk.mjs): the next engine answers, and if nobody does the call ends with this 502.
  // `source` is the text the detail is made of, `bodyWhy` what the 502 says (default: the same, scrubbed). Scrubbed whole, then cut: a key across the cut must not survive. A container that has not answered yet keeps the reason for /health `startError` (#285); a diagnostic write never decides the verdict.
  // Why (8 Nov 2026, bd): this replaces `whileStarting`, which passed a failure on only while the container was starting (#285, #435). Every failure goes on now, so "starting" only decides what /health shows.
  async codexFailure(source, bodyWhy, timeline, starting, why = 'failed') {
    const clean = String(source || '').replace(/\s+/g, ' ').trim(), login = await this.login().catch(() => null), withheld = !login || tokenShaped(clean, login), detail = (withheld ? '(detail withheld: token-shaped)' : clean).slice(0, 200);   // a login that cannot be read withholds the detail: the failure still moves on, nothing unchecked goes out
    if (starting) await this.ctx.storage.put('startError', {at: Date.now(), error: detail}).catch(() => {});
    return failed(why, detail, json(502, {why: withheld ? detail : bodyWhy ?? clean.slice(0, 300), ...(timeline ? {timeline} : {})}));   // Why (code-review, 10 Nov 2026): bodyWhy (the not-JSON container text) went out raw even when its detail was withheld
  }

  // "Answered" = Codex ran end to end in this container: a reply, or Codex's own "usage limit" / "at capacity" (it reached OpenAI and was told no). A start-up failure like "Transport channel closed" is not an answer.
  async markIfAnswered(reply, answer) {
    if (!(reply.ok || ['out-of-quota', 'at-capacity'].includes(kindOfReply(answer)))) return false;
    if (await this.ctx.storage.get('answered')) return true;   // one write per container start, not one per call
    await this.ctx.storage.put('answered', true);
    await this.ctx.storage.put('startError', null);
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/login' && request.method === 'POST') return this.setLogin(await request.text());
    if (url.pathname === '/health') return this.health();
    if (url.pathname === '/call' && request.method === 'POST') return this.call(request.headers.get('x-lane'), await request.json(), workflowKey(request.headers.get('x-workflow')), jobKey(request.headers.get('x-job')), sessionKey(request.headers.get('x-session')));
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
    await this.ctx.storage.put('answered', false);   // a login never tried is not proven by the answers of the one it replaces
    await this.ctx.storage.put('startError', null);
    return json(200, {ok: true});
  }

  // The last whole-week Codex reading, kept in storage: an eviction must not switch the whole-week brake off (Gitar #221). One reader for calls and /health.
  // Why (8 Nov 2026, gi): /health returned the in-memory field, which only a call loaded, so after the restart of a deploy it said `limits: null` (the Codex week unknown) until the next call, and gi's room check refused every recording.
  async weekReading() {
    this.limits ||= (await this.ctx.storage.get('limits')) || null;
    if (this.limits?.resetsAt && this.limits.resetsAt <= Date.now() / 1000) this.limits = null;
    return this.limits;
  }

  async health() {
    await this.weekReading();
    const meter = (await this.ctx.storage.get('meter')) || newMeter(0);
    // Daily counts describe today, even before the first call after UTC midnight.
    // `ready` = a login is stored AND the container has answered since its last start (a sleeping container keeps its last proof; its next wake starts over); `starting` = login stored, nothing answered yet (readers: the release gate accepts it, nobody else reads this field). `startError` = the last Codex failure passed on while starting.
    const state = !(await this.ctx.storage.get('login')) ? 'no-login' : (await this.ctx.storage.get('lost')) ? 'login-lost' : (await this.ctx.storage.get('answered')) ? 'ready' : 'starting';
    const startError = state === 'starting' ? await this.ctx.storage.get('startError') : null;
    return json(200, {state, ...(startError ? {startError} : {}), limits: this.limits, lines: linesOf(LANES, ((await this.ctx.storage.get('claude:state')) || {}).limits), own: meter.tokens, daily: {drift: callsToday(meter, 'drift'), byhand: callsToday(meter, 'byhand')}, tally: recentDays(await this.ctx.storage.get('tally')), jobs: recentDays(await this.ctx.storage.get('jobs')), queue: this.gate.stats(), fallback: await fallbackToday(this.ctx.storage, this.brokerEnv), ...(await engineHealth(this.ctx.storage, this.brokerEnv, new Date(Date.now()).toISOString().slice(0, 10)))});
  }

  // The owner-visible refusals of the Codex login: they stand when Codex is reached, another engine does not hide them.
  async loginRefusal() {
    if (!(await this.ctx.storage.get('login'))) return json(503, {why: 'no-login'});
    if (await this.ctx.storage.get('lost')) return json(503, {why: 'login-lost'});
    return null;
  }

  // One call, answered and then counted for its workflow (lib/tally.mjs). The count never changes the answer: a tally that cannot be written is logged and the reply goes out.
  async call(lane, body, workflow = 'unknown', job = '', session = '') {
    const started = Date.now();
    const reply = await this.answer(lane, body, session);
    if (session) await this.noteGap(session, reply).catch(error => console.log(`sessions: ${String(error?.message || error).slice(0, 200)}`));
    await this.countCall(workflow, reply, Date.now() - started, job).catch(error => console.log(`tally: ${String(error?.message || error).slice(0, 200)}`));
    return reply;
  }

  // Reads the finished reply's own tokens, engine and time (a refusal has none and still counts as a call), then adds them to today's row in one transaction.
  // Why ([bf] review, 5 Nov 2026): a conversation turn that Codex did not answer (another engine did, Codex was out or at capacity, it failed) is a turn the Codex thread never saw, or saw half of. The record says so and the next call restarts from the full prompt instead of resuming a thread with a hole.
  async noteGap(session, reply) {
    const engine = reply.ok ? String((await reply.clone().json().catch(() => ({}))).engine || '') : '';
    if (engine === 'codex') return;
    await this.ctx.storage.transaction(async storage => { const records = (await storage.get('sessions')) || {}; if (records[session]) await storage.put('sessions', markGap(records, session)); });
  }

  async countCall(workflow, reply, elapsed, job = '') {
    const data = reply.ok ? await reply.clone().json().catch(() => ({})) : {};
    const outcome = {ok: reply.ok, tokens: tokensOf(data.tokens), ms: Number.isFinite(data.ms) ? data.ms : elapsed, engine: reply.ok ? String(data.engine || '') : ''};
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    await this.ctx.storage.transaction(async storage => { await storage.put('tally', addCall(await storage.get('tally'), day, workflow, outcome)); });
    // Why (5 Nov 2026, review): the job count is display only and its own step. Inside the tally's transaction a failing write would roll the workflow count back too.
    // Why (5 Nov 2026, Gitar): a job row belongs to the tally row that counted its call. Past 60 workflows a day the tally folds a new one into "other", so the job counts under "other" too, never under a name with no row.
    if (job) await this.ctx.storage.transaction(async storage => { const row = (await storage.get('tally'))?.days?.[day]?.[workflow] ? workflow : 'other'; await storage.put('jobs', addJobCall(await storage.get('jobs'), day, row, job, outcome.tokens)); })
      .catch(error => console.log(`jobs: ${String(error?.message || error).slice(0, 200)}`));
  }

  // The door: everything that can end a call before any engine is asked. Returns {refusal} (the call ends here) or what the walk needs.
  async admit(lane, body) {
    if (Object.hasOwn(body, 'search') && typeof body.search !== 'boolean') return {refusal: json(400, {why: 'search must be a boolean'})};
    if (Object.hasOwn(body, 'effort') && !validEffort(body.effort)) return {refusal: json(400, {why: `effort must be ${EFFORTS.slice(0, -1).join(', ')} or ${EFFORTS.at(-1)}`})};
    if (Object.hasOwn(body, 'engine') && !CHOICES.includes(body.engine)) return {refusal: json(400, {why: `engine must be ${CHOICES.slice(0, -1).join(', ')} or ${CHOICES.at(-1)}`})};
    if (Object.hasOwn(body, 'only') && typeof body.only !== 'boolean') return {refusal: json(400, {why: 'only must be a boolean'})};
    if (body.only && !Object.hasOwn(body, 'engine')) return {refusal: json(400, {why: 'only needs an engine: only this engine answers, or the call is refused'})};
    if (Object.hasOwn(body, 'subs') && (typeof body.subs !== 'boolean' || (body.subs && (!SUBS.includes(body.engine) || body.only)))) return {refusal: json(400, {why: `subs needs an engine of ${SUBS.join(' or ')} and no only: the subscriptions answer, that one first, never Free AI`})};
    const model = modelOf(body.tier);
    if (!model) return {refusal: json(400, {why: `unknown tier "${String(body.tier).slice(0, 20)}" (small, mid or large)`})};
    const env = this.brokerEnv, {chain: asked} = chainOf(env, body.engine, body.engine === undefined ? await demotedNow(this.ctx.storage, env) : [], body.only === true, body.subs === true);   // an engine doing worse is moved back (lib/adapt.mjs) unless this call names its own   // body.engine = this one call's own first choice (e.g. one workflow trying claude); admission and caps stay the same
    // Why (1 Nov 2026): with Codex first a refused login never counts toward the daily cap (as before the chain); with another engine first Codex's step checks it when reached.
    if (asked[0] === 'codex') { const refusal = await this.loginRefusal(); if (refusal) return {refusal}; }
    await this.weekReading();
    // Why (8 Nov 2026, owner: "Actually, codex up to 100%, Claude up to 90%"; replaces the 5 Nov line that kept held lanes and by-hand checks off Claude): every lane passes on to Claude when Codex refuses, until Claude's own seven-day window reads 90% used. Past that no lane starts a Claude call, a call that names Claude included: Free AI answers, or the call gets `budget:claude-week`. The reading is the CLI's, stored with each Claude call (`claude:state`); an unknown or reset window is not a reason to stop.
    const claudeCheck = await this.claudeLine();
    const claudeShut = !claudeCheck.ok && asked.includes('claude') && configured('claude', env);
    // Why (5 Nov 2026, owner's brief: "A job refused here gets the normal refusal, and its items wait for the next run"; review; carried to the Claude line on 8 Nov 2026): with Claude shut a search or an image has nobody left, Free AI takes neither, so it is the line's own `budget:` refusal (ending), never `fallback:*`, which clients show red. A Free AI that really failed keeps its reason (owner, 4 Nov 2026: a fallback that cannot answer is a failure the job shows).
    const freeAiCannot = body.search === true || body.images?.length > 0;
    const chain = claudeShut ? asked.filter(engine => engine !== 'claude' && !(engine === 'free-ai' && freeAiCannot)) : asked;   // Why (8 Nov 2026, Gitar on #492): the engines left out are left out of the walk too, so Codex failing at runtime keeps its own 502 and Free AI never answers a search or an image with a red `fallback:unsupported`
    const others = chain.filter(engine => engine !== 'codex' && configured(engine, env));   // can answer when Codex has run out
    const hasLater = chain.slice(chain.indexOf('codex') + 1).some(engine => configured(engine, env));
    // Check and persist admission together: concurrent calls and reruns share one UTC allowance, whichever engine answers.
    // No refund on a queue/transport/model failure; the reservation commits before an engine is called.
    const verdict = await this.ctx.storage.transaction(async storage => {
      let meter = (await storage.get('meter')) || newMeter(0);
      const now = Date.now() / 1000;
      if (meter.resetsAt && meter.resetsAt <= now) meter = {...newMeter(0), daily: meter.daily};
      const check = allow(lane, meter, this.limits?.usedPercent ?? null, undefined, now);
      if (!check.ok && check.quota && others.length) {
        await storage.put('meter', recordCall(meter, lane, now));
        return {...check, ranOut: true};   // the Codex week is used up: Codex's step passes, the others may answer
      }
      if (check.ok) await storage.put('meter', recordCall(meter, lane, now));
      return check;
    });
    if (!verdict.ok && !verdict.ranOut) return {refusal: json(429, {why: claudeShut && verdict.quota ? claudeCheck.why : verdict.why})};   // the daily cap, or an exhausted week with nobody else configured: a control no other engine bypasses
    return {model, chain, first: asked[0], env, verdict, claudeCheck, claudeShut, freeAiCannot, hasLater};
  }

  // `session`: the conversation key the Worker built from the verified run token ('' = a plain call); only a call with one may use `delta` and `endSession`.
  async answer(lane, body, session = '') {
    const door = await this.admit(lane, body);
    if (door.refusal) return door.refusal;
    const {env, chain} = door, note = newNote(), day = new Date(Date.now()).toISOString().slice(0, 10);
    const ctx = {storage: this.ctx.storage, env, body, lane, weekUsedPercent: this.limits?.usedPercent ?? null, note};
    const waitMs = chain.includes('claude') && configured('claude', env) && await mayPassOn({chain, body, env, storage: this.ctx.storage, verdict: door.verdict}) ? this.busyMs : undefined;   // undefined = wait for a Claude slot as long as it takes
    const done = await walk(chain, (engine, left, last) => this.turn(engine, {door, ctx, lane, body, session, left, waitMs: last ? undefined : waitMs}), (engine, v, ms) => this.record(day, engine, v, ms));
    if (!done.reply) return this.ending(done, door, body, note);
    // Why (1 Nov 2026, owner: CI jobs "need to be aware" which model answers, models behave differently): a reply names its engine and model, and `fellBack` lists the engines that were tried first and did not answer, with the reason. Claude answering after its busy turn did answer.
    const fell = done.left.filter(entry => !(entry.engine === done.engine && entry.why === 'busy'));
    return done.reply.ok && fell.length ? json(200, {...(await done.reply.json()), fellBack: fell}) : done.reply;
  }

  // One engine's turn as a verdict (lib/walk.mjs); null = the engine is not asked for this call.
  // Why (1 Nov 2026, Gitar on #289; kept 8 Nov 2026, Gitar on #503): an engine that answers badly (a reply the guard refuses, an unusable one) before Codex has run is not the end of the call; after Codex it IS the last-resort answer, unless an engine that was only busy has not had its turn.
  async turn(engine, {door, ctx, lane, body, session, left, waitMs}) {
    const v = await this.step(engine, {door, ctx, lane, body, session, left, waitMs});
    const after = door.chain.includes('codex') && door.chain.indexOf(engine) > door.chain.indexOf('codex');
    return v?.why === 'bad-answer' && after && !left.some(entry => entry.why === 'busy') ? refused(v.reply) : v;
  }

  async step(engine, {door, ctx, lane, body, session, left, waitMs}) {
    if (engine === 'codex') return this.codexStep(lane, body, door.model, door.verdict, door.hasLater, door.first === 'codex', session);
    if (engine === 'claude') return this.claudeStep(lane, body, waitMs);
    if (door.freeAiCannot && left.some(entry => entry.engine === 'claude' && entry.why === 'budget')) return null;   // Why (8 Nov 2026, Gitar on #492): Claude's line closed while this call waited for a slot; Free AI takes neither a search nor an image, so the call reaches the budget refusal, not a red `fallback:unsupported`
    const reply = (!body.search && apiPrecheck(body)) || await freeAiStep({...ctx, login: await this.login()});   // read at its turn: a token Codex rotated earlier in this call is guarded too
    if (!reply) return !body.search && configured(engine, door.env) ? unavailable('unavailable') : null;
    return reply.ok ? answered(reply) : reply.status === 400 ? refused(reply) : failed('bad-answer', '', reply);   // a 400 (empty prompt) is nobody's answer to retry
  }

  // Records one turn: the engine's day counts and, for a real answer or a broken run, its record for demotion (lib/adapt.mjs). A refusal, a lost login or a 4xx says nothing about the engine.
  async record(day, engine, v, ms) {
    const storage = this.ctx.storage, env = this.brokerEnv;
    if (v.verdict === 'answered' || v.verdict === 'refused') {
      await recordOutcome(storage, day, engine, v.reply.ok ? 'ok' : 'failed', ms);
      if (v.reply.ok || v.reply.status === 502) await recordPerf(storage, env, engine, v.reply.ok);
      return;
    }
    if (v.why === 'failed' || v.why === 'overloaded') await recordPerf(storage, env, engine, false);
    if (v.counted) await recordOutcome(storage, day, engine, {'ran-out': 'ranOut', busy: 'busy'}[v.why] ?? 'failed');
  }

  // The one place a call that nobody answered ends. The first engine's own words win (its real failure, never Free AI's "budget" which CI reads as a grey skip); then a pinned engine's reason, the Claude line's own refusal, and Free AI's.
  ending({held, left}, door, body, note) {
    if (held) return held;
    const late = left.find(entry => entry.engine === 'claude' && entry.why === 'budget'), shut = door.claudeShut ? door.claudeCheck.why : late?.detail;   // the line closed at the door, or while this call waited for a slot
    if (body.only === true) {
      if (shut && door.first === 'claude') return json(429, {why: shut});
      if (door.first === 'free-ai') return apiFinish(door.env, note);   // Why (Gitar on #296): their own reasons stay: fallback:search-unsupported, fallback:unavailable, the 429 day cap
      return json(503, {why: `only-${door.first}: ${left.find(entry => entry.engine === door.first)?.why ?? (configured(door.first, door.env) ? 'unavailable' : 'not-configured')}`, engine: door.first, tried: left});   // strict call: nobody else answers, and the reason is named
    }
    if (body.subs === true) {   // neither subscription answered: each one's reason, never Free AI's, whose `budget:` CI reads as a grey skip
      const why = SUBS.map(engine => `${engine} ${left.find(entry => entry.engine === engine)?.why ?? (engine === 'claude' && shut ? shut : configured(engine, door.env) ? 'unavailable' : 'not-configured')}`);
      return json(503, {why: `subs: ${why.join(', ')}`, engine: door.first, tried: left});
    }
    if (shut && door.freeAiCannot) return json(429, {why: shut});   // Claude did not answer, its line is shut and Free AI takes neither a search nor an image
    return apiFinish(door.env, note);
  }

  // Codex's step as a verdict (lib/walk.mjs). `hasLater`: another engine is configured after Codex. A reply the container sends back carries a `kind` (container/kinds.mjs): out-of-quota, at-capacity, login-lost, stalled, failed.
  async codexStep(lane, body, model, verdict, hasLater, loginChecked, session = '') {
    if (!loginChecked) { const refusal = await this.loginRefusal(); if (refusal) return refused(refusal); }
    if (verdict.ranOut) return unavailable('ran-out');   // the Codex week is used up (the door found others to answer)
    const entered = Date.now();
    const unlock = session ? await this.turns(session) : () => {};   // before the slot: a waiting turn of one conversation must not hold a slot others need
    try {
      const release = await this.gate.acquire(queueOf(lane));   // nightly drift and by-hand Search checks share scheduled queue priority
      try {
        const delta = typeof body.delta === 'string' ? body.delta : '', now = Date.now();
        const plan = session ? planOf(((await this.ctx.storage.get('sessions')) || {})[session], {now, tier: body.tier ?? 'mid', delta}) : null;
        const sent = {prompt: body.prompt, schema: body.schema, images: body.images, search: body.search, effort: body.effort, model, ...(session ? {session: {key: session, ...plan, delta, end: body.endSession === true}} : {})};   // an allow-list, never the caller's body: nothing else of theirs reaches the container
        const sentAt = Date.now();
        // Why (5 Nov 2026, a8, owner via mac-32: "ONE timeline with timestamps on all 3 hops"; Gitar on #428: a throw or a non-JSON body left no line): what this Worker spent before the container (the conversation's lock, the gate slot, the session read), what the container leg took and what the container saw codex do. It is written to this Worker's log on EVERY exit of the container leg (a throw too, the deploy-swap signature) and returned in the 200 and 502 bodies. Logging only.
        const mark = (status, extra = {}) => {
          const line = {waitMs: sentAt - entered, containerMs: Date.now() - sentAt, status, model, effort: body.effort ?? 'default', ...extra};
          console.log(JSON.stringify({codexCall: lane, session: session ? 'conversation' : 'single', ...line}));
          return line;
        };
        let starting = !(await this.ctx.storage.get('answered').catch(() => true));   // a storage failure counts as answered: the failure stands, never hidden behind another engine
        let reply, text;
        try { reply = await this.toContainer('/call', JSON.stringify(sent), () => { starting = true; }); text = await reply.text(); }   // a call refused by a draining container lands on a NEW one, which has answered nothing yet
        catch (error) { const line = mark('threw', {error: String(error?.message || error).slice(0, 80)}); return this.codexFailure(`call: ${String(error?.message || error)}`, undefined, line, starting, 'cut'); }   // a cut call is a failed turn: the next engine answers, never the same call sent twice
        let answer;
        try { answer = JSON.parse(text); } catch { const line = mark(reply.status, {note: 'not JSON'}); return this.codexFailure(`container: ${text}`, `container: ${text.slice(0, 300)}`, line, starting, 'cut'); }   // the platform's own error text (not our server's JSON): say it, never crash (a 1101 hid it, 28 Oct 2026)
        const timeline = mark(reply.status, typeof answer.trace === 'string' ? {codex: answer.trace} : {});
        if (answer.authFile) await this.ctx.storage.put('login', answer.authFile);   // write-through BEFORE the reply goes out: a rotated token is never only in the container
        const login = await this.login();   // after the write-through: the guard knows the rotated token
        await this.markIfAnswered(reply, answer);
        if (!reply.ok) {
          const kind = kindOfReply(answer);
          if (answer.error === 'draining') return this.codexFailure('a draining container answered every try', undefined, timeline, starting, 'cut');   // a deploy, not the engine: not counted against it
          if (kind === 'out-of-quota' && hasLater && !tokenShaped(answer.error, login)) return unavailable('ran-out');
          const said = codexMessage(answer.error);
          if (kind === 'at-capacity' && !tokenShaped(said, login) && !tokenShaped(answer.error, login)) return failed('overloaded', said.slice(0, 200), json(502, {why: answer.error, timeline}));   // a text that looks like a key is a plain failure below (its detail is withheld)   // a failure for JOB-202's demotion, though another engine answers
          const lost = kind === 'login-lost', why = tokenShaped(answer.error, login) ? 'codex-failed (detail withheld: token-shaped)' : answer.error;
          if (lost) { await this.ctx.storage.put('lost', true); return refused(json(503, {why, timeline})); }   // the owner must see it: no other engine hides it
          return this.codexFailure(why, why, timeline, starting);
        }
        if (answer.limits) { this.limits = answer.limits; await this.ctx.storage.put('limits', answer.limits); }
        // Why ([bf], 5 Nov 2026, owner: "that context should be only once"): a conversation's call counts what it added (input minus cached, plus output); every other call counts in full, as before (lib/sessions.mjs countedOf).
        const counted = countedOf(answer.tokens, Boolean(session)), used = counted * weightOf(body.effort);   // a higher effort counts for more of the week (lib/tiers.mjs EFFORT_WEIGHT)
        // Completions also transact: a token write must never overwrite a newer daily reservation.
        await this.ctx.storage.transaction(async storage => {
          const latest = (await storage.get('meter')) || newMeter(0);
          await storage.put('meter', record(latest, lane, used, Date.now() / 1000, answer.limits?.resetsAt));
          if (session && answer.session?.mode) await storage.put('sessions', settle((await storage.get('sessions')) || {}, session, {now: Date.now(), tier: body.tier ?? 'mid', mode: answer.session.mode}));   // the clock after the turn: a slow one must not look idle
        });
        const bad = refuseReply(answer.reply, login);
        if (bad) return refused(json(422, {why: bad}));   // Why (code-review, 8 Nov 2026): a reply the guard refuses (the broker's login, a JWT, a key) ends the call as on main; another engine is not asked the same prompt
        return answered(json(200, {reply: answer.reply, tokens: {...answer.tokens, counted}, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, weekUsedPercent: this.limits?.usedPercent ?? null, engine: 'codex', timeline, ...(answer.session ? {session: answer.session} : {})}));
      } finally { release(); }
    } finally { unlock(); }
  }

  // The one door from this class to the container for a call. Design (8 Nov 2026, bd; the container half is in container/server.mjs):
  //   serving -> (deploy: SIGTERM) -> draining -> gone -> next container serving.
  //   Owner of a call: the container that ACCEPTED it, until it replies. A draining container accepts no new call: it answers `x-broker-draining` before starting anything, so that call has no owner yet and is sent again here, until a container accepts it (the next one starts on the first request after the old one is gone). Nothing is retried that a container accepted: a cut call is never sent twice. No counter moves on a refusal (the week and day counts are written once, from an answer).
  async toContainer(path, payload, refused = () => {}) {
    const until = Date.now() + this.drainWaitMs;
    for (;;) {
      const reply = await this.containerFetch(`http://c${path}`, {method: 'POST', body: payload});
      if (!reply.headers.get('x-broker-draining')) return reply;
      refused();   // the container this call goes to next is a new one, which has answered nothing yet
      if (Date.now() >= until) return reply;   // still draining after the wait: the 503 `draining` stands, and codexStep passes it on like any start-up failure
      await new Promise(resolve => setTimeout(resolve, this.drainPollMs));
    }
  }

  // Why (1 Nov 2026, first live Claude call failed with no reason shown): a failed Claude step says why in `fellBack[].detail` and /health `lastError`, scrubbed: nothing token-shaped, at most 200 characters.
  async claudeFailure(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const login = await this.login().catch(() => null), detail = (!login || refuseReply(clean, login) ? '(detail withheld: token-shaped)' : clean).slice(0, 200);   // a login that cannot be read withholds the detail, never throws
    const state = (await this.ctx.storage.get('claude:state')) || {};
    await this.ctx.storage.put('claude:state', {...state, lastError: {at: Date.now(), text: detail}});
    return failed('failed', detail);
  }

  // Whether Claude's own seven-day window allows a call now (lib/budget.mjs claudeAllow), read from the last Claude reply's limits.
  async claudeLine() { return claudeAllow(claudeWeekPercent(((await this.ctx.storage.get('claude:state')) || {}).limits)); }

  // The Claude subscription's step as a verdict (lib/walk.mjs); null when it is not configured.
  // Why (1 Nov 2026): only measured signals say "ran out" (the container's `kind` from the CLI's own rate_limit_event or a limit message); an unknown failure is a plain failure and the chain moves on. An invalid token is shown in /health and sent to Telegram once a day.
  // `waitMs` (set only for a call that may pass on, lib/busy.mjs): how long to wait for a free slot; past it the step is `busy` and nothing was sent to the container. Undefined = wait as long as it takes.
  async claudeStep(lane, body, waitMs) {
    const env = this.brokerEnv, storage = this.ctx.storage;
    if (!env.CLAUDE_CODE_OAUTH_TOKEN) return null;   // no token = not configured (search is Claude's too since 2 Nov 2026: the WebSearch tool)
    const now = Date.now(), state = (await storage.get('claude:state')) || {};
    if ((state.invalidUntil || 0) > now) return unavailable('token-invalid', '', false);
    if ((state.limitUntil || 0) > now) return unavailable('ran-out', '', false);
    const model = CLAUDE_MODELS[body.tier ?? 'mid'];
    const priority = queueOf(lane), waitStarted = Date.now();
    const releaseClaude = await this.claudeGate.acquire(priority, waitMs);
    if (!releaseClaude) return unavailable('busy');
    const release = await this.gate.acquire(priority, waitMs === undefined ? undefined : Math.max(0, waitMs - (Date.now() - waitStarted)));   // the PARALLEL shared slots count against the same deadline
    if (!release) { releaseClaude(); return unavailable('busy'); }
    try {
      // Why (8 Nov 2026, code-review): the line was read when the call came in, and a call waits for a slot with no deadline (searches, the retry turn); a Claude call that finished meanwhile may have moved the week to 90%. Read it again with the slot in hand, so no call starts past the line.
      const late = await this.claudeLine();
      if (!late.ok) return unavailable('budget', late.why, false);
      const reply = await this.toContainer('/claude', JSON.stringify({prompt: body.prompt, schema: body.schema, images: body.images, model, ...(body.search === true ? {search: true} : {})}));
      let answer;
      let raw = '';
      try { raw = await reply.text(); answer = JSON.parse(raw); } catch { return await this.claudeFailure('platform: ' + raw); }   // the platform's own error text, not our server's JSON
      if (answer.limits) {
        // Why (8 Nov 2026, code-review): a rate_limit_event may carry one window only; a missing seven-day window must not turn a known 95% into "unknown" and reopen Claude. The old reading stands until its own reset.
        const before = ((await storage.get('claude:state')) || {}).limits?.sevenDay;
        const kept = !answer.limits.sevenDay && before?.resetsAt > now / 1000 ? {...answer.limits, sevenDay: before} : answer.limits;
        await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), limits: kept});
      }
      if (!reply.ok) {
        const kind = kindOfReply(answer);
        if (kind === 'login-lost') {
          await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), invalidUntil: now + 3600_000});   // retried hourly: a new token needs no deploy of ours
          await noteOnce(storage, env, new Date(now).toISOString().slice(0, 10), 'claude-token-invalid', 'AI broker: the Claude subscription token is invalid or expired. Claude is skipped, the next engine answers. Fix: claude setup-token, then update the Worker secret CLAUDE_CODE_OAUTH_TOKEN.');
          return unavailable('token-invalid');
        }
        if (kind === 'out-of-quota') {
          const until = answer.resetsAt ? answer.resetsAt * 1000 : now + 600_000;   // the CLI's reset time, else ten minutes
          await storage.put('claude:state', {...((await storage.get('claude:state')) || {}), limitUntil: Math.max(until, now + 60_000)});
          return unavailable('ran-out');
        }
        return await this.claudeFailure(String(answer.error || ''));
      }
      const login = await this.login(), bad = refuseReply(answer.reply, login);
      if (bad) return failed('bad-answer', '', json(422, {why: bad}));   // whether it ends the call depends on its place in the chain: worker.js turn()
      return answered(json(200, {reply: answer.reply, tokens: answer.tokens, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, weekUsedPercent: this.limits?.usedPercent ?? null, engine: 'claude'}));
    } catch (e) { return await this.claudeFailure('call: ' + String(e?.message || e)); }
    finally { release(); releaseClaude(); }
  }
}

/** The container's coded kind; an older container image (a deploy in flight) sends none, so the text is read the same way. */
const kindOfReply = answer => answer?.kind ?? kindOf(answer?.error);

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
      let text = await request.text();
      let asked; try { asked = JSON.parse(text); } catch { asked = null; }
      text = claudeOnly(claims, asked, text);   // the Durable Object refuses a body that is not JSON; the key just stays empty
      return broker.fetch(new Request('http://c/call', {method: 'POST', body: text, headers: {'x-lane': laneOf(claims), 'x-workflow': workflowOf(claims), 'x-job': jobKey(request.headers.get('x-jobadabra-job')), 'x-session': sessionKeyOf(claims, asked?.session)}}));   // Why (3 Nov 2026, owner): lane and workflow are built fresh from the verified claims; a header the caller sends is never forwarded. Why (5 Nov 2026, owner via mac-32: per-job AI cost): the one exception is the job label, a GitHub job id of a fixed shape that only names a row for display and never decides a lane or a cap
    }
    return json(404, {error: 'not found'});
  },
};

// Why (2 Nov 2026, owner: "After the lab scout proves it"; 7/7): run tokens carry the audience the caller asked for. The old name `jobadabra-codex-broker` was accepted beside this one while the callers moved; the public client (#2947) and jobadabra-lab's scout (run 41376186747, 40 of 40 AI calls answered) use the new one, so the old is gone. A list (comma-separated) stays possible.
const audiences = env => String(env.AUDIENCE || 'jobadabra-ai-broker').split(',').map(name => name.trim()).filter(Boolean);

// Why (1 Nov 2026, go-org-move): the repos are moving to the GitHub org `jobadabra` (created 21:34 UTC, owned by the owner), where the OIDC `repository` claim becomes `jobadabra/<repo>`; both owners are accepted until 7 days after the last repo has moved, then the two GarryOne names go.
// Why (1 Nov 2026, owner's pick via mac-07): central-scout.yml and product-brain.yml move to jobadabra-lab; without its name every scout AI call gets "oidc: wrong repository" and skips silently. Lanes read the workflow file, not the repo, so the two keep today's lane, tiers and caps.
// Why (12 Nov 2026, owner via bm: "Broker, Claude plan, Haiku"): jobadabra-benchmarks' form round asks the app's AI through the broker, since the app's CI engine lost its API-key path on 5 Nov (jobadabra #3177); its calls are forced to Claude alone (lib/lanes.mjs claudeOnly), so ours answers on the same Haiku 5.5 as the rivals. The repo is named only under the org (it never ran under GarryOne after the move).
// Why (31 Oct 2026, owner: "Move all 11 now"): the private site repo's changelog and digest jobs run on the Codex plan too, so the broker accepts run tokens of both repos (REPOSITORY is a comma list).
const repositories = env => String(env.REPOSITORY || 'GarryOne/jobadabra,GarryOne/jobadabra-web,GarryOne/jobadabra-lab,jobadabra/jobadabra,jobadabra/jobadabra-web,jobadabra/jobadabra-lab,jobadabra/jobadabra-benchmarks').split(',').map(name => name.trim()).filter(Boolean);
let jwksReader;
const jwks = () => (jwksReader ||= githubJwks());
