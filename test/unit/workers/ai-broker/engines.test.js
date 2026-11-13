// The ENGINE flag: which engine answers first and how the others follow (workers/ai-broker/lib/engines.mjs). Fakes only: no real provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, body, harness, containerError, switchboard, PARALLEL} from './harness.mjs';
import {chainOf, ORDER} from '../../../../workers/ai-broker/lib/engines.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const freeAnswer = () => ({response: 'free answer', usage: {prompt_tokens: 100, completion_tokens: 20}});
const claudeAnswer = () => Response.json({type: 'message', content: [{type: 'text', text: 'claude answer'}], stop_reason: 'end_turn', usage: {input_tokens: 100, output_tokens: 20}});
const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7, limits: {status: 'allowed', fiveHour: {utilization: 0.2}, sevenDay: {utilization: 0.05}}}));
const claudeFails = (error, extra = {}, status = 500) => () => containerError(error, extra, status);
// A fresh world per call: the env with a given ENGINE and fakes that count what each provider was asked.
function world(t, engine, {free = freeAnswer, extra = {}, claude = claudeOk, token = false, codex = null} = {}) {
  t.mock.method(Date, 'now', () => day);
  const sent = [], calls = {free: 0, paid: 0, get notes() { return sent.length; }, claudeCli: 0, claudeBodies: [], claudeNow: 0, claudeMax: 0};
  const env = {...config.vars, ...(engine === undefined ? {ENGINE: undefined} : {ENGINE: engine}), ...switchboard(sent),
    ...(token ? {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'} : {}), AI: {run: async () => { calls.free++; return free(); }}, ...extra};
  t.mock.method(globalThis, 'fetch', async () => { calls.paid++; return claudeAnswer(); });   // no paid provider exists any more: any fetch is a failure the asserts below catch
  const made = harness(undefined, env);
  const dispatched = [];
  const container = made.broker.containerFetch;
  made.broker.containerFetch = async (...args) => {
    dispatched.push(args[0]);
    if (!args[0].endsWith('/claude')) return codex ? codex(...args) : container(...args);
    calls.claudeCli++; calls.claudeBodies.push(JSON.parse(args[1].body)); calls.claudeNow++; calls.claudeMax = Math.max(calls.claudeMax, calls.claudeNow);
    try { return await claude(); } finally { calls.claudeNow--; }
  };
  return {...made, calls, dispatched, env, sent};
}
const answered = async response => (await response.json()).engine;
// Failures within one second count once (lib/adapt.mjs BURST_MS, 12 Nov 2026): a test that plays failures one after another moves the clock between them.
const later = (i, from = day) => Date.now.mock.mockImplementation(() => from + i * 2000);

test('the shipped default is ENGINE=codex and the order is the two subscriptions, then Free AI', () => {
  assert.equal(config.vars.ENGINE, 'codex');
  assert.deepEqual(ORDER, ['codex', 'claude', 'free-ai']);
});

test('the chain starts at ENGINE and keeps the fixed order after it; unset or unknown is codex, an unknown value is said, not guessed', () => {
  assert.deepEqual(chainOf({}).chain, ['codex', 'claude', 'free-ai']);
  assert.deepEqual(chainOf({ENGINE: 'codex'}).chain, ['codex', 'claude', 'free-ai']);
  assert.deepEqual(chainOf({ENGINE: 'claude'}).chain, ['claude', 'codex', 'free-ai']);
  assert.deepEqual(chainOf({ENGINE: 'free-ai'}).chain, ['free-ai', 'codex', 'claude']);
  const bad = chainOf({ENGINE: 'banana'});
  assert.deepEqual(bad.chain, ORDER); assert.equal(bad.first, 'codex'); assert.match(bad.warning, /unknown ENGINE "banana"/);
});

test('ENGINE=codex: Codex answers; its week used up, Free AI answers next (no paid API)', async t => {
  const {broker, storage, calls} = world(t, 'codex');
  assert.equal(await answered(await broker.call('pr', body)), 'codex');
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  broker.limits = null;
  assert.equal(await answered(await broker.call('pr', body)), 'free-ai');
  assert.equal(calls.free, 1); assert.equal(calls.paid, 0);
});

test('ENGINE=claude: the subscription engine is not built yet, so its step is skipped and Codex answers; the order after Codex is unchanged', async t => {
  const {broker, storage, calls} = world(t, 'claude');
  assert.equal(await answered(await broker.call('pr', body)), 'codex');
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  broker.limits = null;
  assert.equal(await answered(await broker.call('pr', body)), 'free-ai');
  assert.equal(calls.free, 1); assert.equal(calls.paid, 0);
  const health = await (await broker.health()).json();
  assert.equal(health.engine, 'claude'); assert.deepEqual(health.chain.map(e => e.name), ['claude', 'codex', 'free-ai']);
  assert.equal(health.chain[0].configured, false);   // not configured = skipped, never failed
});

test('ENGINE=free-ai: Free AI answers first without touching Codex; when it has nothing to give Codex answers', async t => {
  const first = world(t, 'free-ai');
  first.broker.containerFetch = async () => assert.fail('Free AI answers first: Codex must not be called');
  assert.equal(await answered(await first.broker.call('pr', body)), 'free-ai');
  assert.equal(first.calls.free, 1);
  const failing = world(t, 'free-ai', {free: () => { throw new Error('workers ai down'); }});
  assert.equal(await answered(await failing.broker.call('pr', body)), 'codex');   // a failed step moves on, Codex has not run out
  const off = world(t, 'free-ai', {extra: {FALLBACK_FREE_AI_DAY_USD: '0'}});
  assert.equal(await answered(await off.broker.call('pr', body)), 'codex');   // not configured = skipped
  assert.equal(off.calls.free, 0);
});

test('ENGINE=free-ai with a search request or without a Codex login: search goes to Codex, no login does not stop Free AI', async t => {
  const {broker, dispatched, calls} = world(t, 'free-ai');
  assert.equal(await answered(await broker.call('pr', {...body, search: true})), 'codex');
  assert.equal(calls.free, 0); assert.equal(dispatched.length, 1);
  const none = world(t, 'free-ai');
  await none.storage.put('login', undefined);
  assert.equal(await answered(await none.broker.call('pr', body)), 'free-ai');
});

test('Free AI first and nothing left after Codex: a Codex failure is Codex\'s own 502 (no engine is left to walk to)', async t => {
  const {broker, calls} = world(t, 'free-ai', {free: () => { throw new Error('down'); }});
  broker.containerFetch = async () => containerError('codex-failed:1 boom');
  const response = await broker.call('pr', body);
  assert.equal(response.status, 502); assert.match((await response.json()).why, /codex-failed:1 boom/);
  assert.equal(calls.paid, 0);   // nothing sits after Codex that could cover a plain failure
});

test('the drift daily cap holds whichever engine answers, and the answered calls are counted per engine in /health', async t => {
  const {broker, calls} = world(t, 'free-ai');
  broker.containerFetch = async () => assert.fail('not Codex');
  const replies = await Promise.all(Array.from({length: 26}, () => broker.call('drift', body)));
  assert.equal(replies.filter(r => r.status === 200).length, 24);
  for (const reply of replies.filter(r => r.status === 429)) assert.deepEqual(await reply.json(), {why: 'budget:daily 24 of 24 calls (drift)'});
  assert.equal(calls.free, 24);
  const health = await (await broker.health()).json();
  assert.equal(health.chain.find(e => e.name === 'free-ai').answeredToday, 24);
  assert.equal(health.chain.find(e => e.name === 'codex').answeredToday, 0);
  assert.equal(JSON.stringify(health).includes('fixture-not-a-key'), false);   // /health never carries a secret
});

test('an unknown ENGINE keeps today\'s behaviour and /health says why', async t => {
  const {broker} = world(t, 'banana');
  assert.equal(await answered(await broker.call('pr', body)), 'codex');
  const health = await (await broker.health()).json();
  assert.equal(health.engine, 'codex'); assert.match(health.warning, /unknown ENGINE "banana"/);
});

test('ENGINE=free-ai: a bad Free AI answer (invalid JSON for a schema, a cut-off reply) does not end the chain, Codex answers; after Codex the refusal stays final (Gitar on #289)', async t => {
  const schema = {type: 'object'};
  for (const bad of [() => ({response: 'not json', usage: {prompt_tokens: 100, completion_tokens: 20}}), () => ({choices: [{finish_reason: 'length', message: {content: 'cut'}}], usage: {prompt_tokens: 100, completion_tokens: 20}})]) {
    const {broker, calls} = world(t, 'free-ai', {free: bad});
    const response = await broker.call('pr', {...body, schema});
    assert.equal(response.status, 200); assert.equal(await answered(response), 'codex');
    assert.equal(calls.free, 1);   // it was asked and its answer was refused, then Codex answered
  }
  const last = world(t, 'codex');
  await last.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  last.broker.limits = null;
  t.mock.method(globalThis, 'fetch', async () => Response.json({type: 'message', content: [{type: 'text', text: 'not json'}], stop_reason: 'end_turn', usage: {input_tokens: 100, output_tokens: 20}}));
  const refused = await last.broker.call('pr', {...body, schema});
  assert.equal(refused.status, 503); assert.equal((await refused.json()).why, 'fallback:invalid-json');   // Claude after Codex: the same last-resort 503 as before the flag
});

const withToken = {token: true};

test('ENGINE=claude with a token: the Claude subscription answers at the tier\'s model, the token reaches the container only as an environment variable, /health shows its state and no secret', async t => {
  const {broker, calls, dispatched} = world(t, 'claude', withToken);
  const images = [{name: 'a.png', base64: 'QQ=='}];
  const response = await broker.call('pr', {...body, tier: 'large', schema: {type: 'object'}, images});
  const answer = await response.json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.model, 'claude-opus-5-5'); assert.equal(answer.reply, 'claude ok'); assert.deepEqual(answer.tokens, {input: 5, output: 3});
  assert.equal(answer.fellBack, undefined);
  assert.deepEqual(calls.claudeBodies[0], {prompt: body.prompt, schema: {type: 'object'}, images, model: 'claude-opus-5-5'});
  assert.deepEqual(dispatched.filter(url => url.endsWith('/call')), []);   // Codex was not asked
  assert.deepEqual(broker.envVars, {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'});
  for (const [tier, model] of [['small', 'claude-haiku-5-5'], ['mid', 'claude-sonnet-5-5']]) { await broker.call('pr', {...body, tier}); assert.equal(calls.claudeBodies.at(-1).model, model); }
  for (const effort of ['low', 'medium']) {   // the app's own efforts (src/ai/engine.py effort_for: Haiku low, Sonnet medium) reach the CLI as they do in the app
    await broker.call('pr', {...body, tier: 'small', effort});
    assert.deepEqual(calls.claudeBodies.at(-1), {prompt: body.prompt, model: 'claude-haiku-5-5', effort});
  }
  const health = await (await broker.health()).json(), entry = health.chain[0];
  assert.equal(entry.name, 'claude'); assert.equal(entry.state, 'ready'); assert.equal(entry.answeredToday, 5); assert.equal(entry.avgMs !== null, true); assert.equal(entry.limits.fiveHour.utilization, 0.2);
  assert.equal(JSON.stringify(health).includes('fixture-not-a-token'), false);
});

test('one call can choose its engine (a workflow trying claude) while every other call stays on the configured one; an unknown choice is a 400', async t => {
  const {broker, calls} = world(t, 'codex', withToken);
  assert.equal(await answered(await broker.call('pr', {...body, engine: 'claude'})), 'claude');
  assert.equal(await answered(await broker.call('pr', body)), 'codex');
  assert.equal(calls.claudeCli, 1);
  for (const engine of ['banana', 'claude-api', '', null, 1]) {
    const response = await broker.call('pr', {...body, engine});
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), {why: 'engine must be codex, claude or free-ai'});
  }
});

test('the chain with Codex first: Codex\'s week used up, the Claude subscription answers before Free AI, and the reply says what it fell back from', async t => {
  const {broker, storage, calls} = world(t, 'codex', withToken);
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  broker.limits = null;
  const answer = await (await broker.call('pr', body)).json();
  assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  assert.equal(calls.paid, 0);
  const health = await (await broker.health()).json();
  assert.equal(health.chain.find(e => e.name === 'codex').ranOutToday, 1);
});

test('an invalid token: the next engine answers, the owner is told once, /health says token-invalid, and Claude is not asked again until the hour is up', async t => {
  const {broker, calls, sent} = world(t, 'claude', {...withToken, claude: claudeFails('claude-auth')});
  const first = await (await broker.call('pr', body)).json();
  assert.equal(first.engine, 'codex'); assert.deepEqual(first.fellBack, [{engine: 'claude', why: 'token-invalid'}]);
  const second = await (await broker.call('pr', body)).json();
  assert.equal(second.engine, 'codex'); assert.deepEqual(second.fellBack, [{engine: 'claude', why: 'token-invalid'}]);
  assert.equal(calls.claudeCli, 1); assert.equal(calls.notes, 1); assert.equal(sent[0].event, 'ai-broker-claude-token');
  assert.equal((await (await broker.health()).json()).chain[0].state, 'token-invalid');
  Date.now.mock.mockImplementation(() => day + 3601_000);   // an hour later it is tried again
  await broker.call('pr', body); assert.equal(calls.claudeCli, 2);
});

test('the subscription used up: it waits for the reset time the CLI reported, then is tried again; an unknown failure is only a failure and is tried at once next time', async t => {
  const reset = day / 1000 + 7200;
  const limit = world(t, 'claude', {...withToken, claude: claudeFails('claude-limit', {resetsAt: reset})});
  assert.deepEqual((await (await limit.broker.call('pr', body)).json()).fellBack, [{engine: 'claude', why: 'ran-out'}]);
  await limit.broker.call('pr', body); assert.equal(limit.calls.claudeCli, 1);   // still waiting for the reset
  assert.equal((await (await limit.broker.health()).json()).chain[0].state, 'ran-out');
  Date.now.mock.mockImplementation(() => reset * 1000 + 1000);
  await limit.broker.call('pr', body); assert.equal(limit.calls.claudeCli, 2);
  const flaky = world(t, 'claude', {...withToken, claude: claudeFails('claude-failed:1 boom')});
  await flaky.broker.call('pr', body); await flaky.broker.call('pr', body);
  assert.equal(flaky.calls.claudeCli, 2);
  const health = await (await flaky.broker.health()).json();
  assert.equal(health.chain[0].failedToday, 2); assert.equal(health.chain[0].ranOutToday, 0); assert.equal(health.chain[0].state, 'ready');
});

test('search: Codex first while it has allowance; when it is used up Claude searches (owner, 2 Nov 2026: every Search check read 0 jobs); a token-shaped Claude reply never reaches the caller, and more parallel Claude calls than slots run at most PARALLEL at a time: Claude has no cap of its own (owner, 13 Nov 2026: "no isolate claude cap")', async t => {
  const first = world(t, 'codex', withToken);
  assert.equal(await answered(await first.broker.call('pr', {...body, search: true})), 'codex'); assert.equal(first.calls.claudeCli, 0);
  const out = world(t, 'codex', withToken);
  await out.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  out.broker.limits = null;
  const searched = await (await out.broker.call('pr', {...body, search: true})).json();
  assert.equal(searched.engine, 'claude'); assert.deepEqual(searched.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  assert.equal(out.calls.claudeBodies.at(-1).search, true, 'the container is told to search'); assert.equal(out.calls.free, 0, 'Free AI never takes a search');
  assert.equal(searched.reply, 'claude ok');
  const plain = world(t, 'claude', withToken);
  await plain.broker.call('pr', body);
  assert.ok(!plain.calls.claudeBodies.at(-1).search, 'a call without search does not enable the tool');
  const leaky = world(t, 'claude', {...withToken, claude: () => new Response(JSON.stringify({reply: 'sk-' + 'a'.repeat(30), tokens: {input: 1, output: 1}, ms: 1}))});
  assert.equal(await answered(await leaky.broker.call('pr', body)), 'codex');   // the guard refuses it and Codex, not yet run, answers
  const slow = world(t, 'claude', {...withToken, claude: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return claudeOk(); }});
  assert.equal((await Promise.all(Array.from({length: PARALLEL + 4}, () => slow.broker.call('pr', body)))).filter(r => r.status === 200).length, PARALLEL + 4);
  assert.equal(slow.calls.claudeMax, PARALLEL);
});

// JOB-202 (owner, 1 Nov 2026: "adapt or report if one is doing worse than the other"): an engine that fails half of its last calls goes behind the other subscription for 30 minutes.
const codexBroken = () => containerError('codex-failed:1 boom');

// The container's error for a Codex run the model's server turned away, as CI run 42040707448 printed it (5 Nov 2026, cut at "Selec" by the caller); the rest of the message is
// the server's capacity wording, a hypothesis until the broker's own detail shows it. Codex names this class server_overloaded ("Server overloaded; retry later.").
const capacity = message => `codex-failed:1 {"type":"thread.started","thread_id":"01a1ac05-5b58-7850-8433-3b742820d8cb"} {"type":"turn.started"} {"type":"error","message":"${message}"} {"type":"turn.failed","error":{"message":"${message}"}}`;
test('Codex turned away for capacity (run 42040707448): the Claude subscription answers instead of a 502, and fellBack carries the server\'s own words without the JSON around them', async t => {
  for (const [message, said = message] of [['Selected model is at capacity. Please try a different model.'], ['Server overloaded; retry later.'], ['We\'re currently experiencing high demand, which may cause temporary errors.'], ['server_overloaded: \\"gpt-6-astra\\" is busy', 'server_overloaded: "gpt-6-astra" is busy']]) {
    const {broker, calls} = world(t, 'codex', {...withToken, codex: () => containerError(capacity(message))});
    const reply = await broker.call('pr', body);
    assert.equal(reply.status, 200, message);
    const answer = await reply.json();
    assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'overloaded', detail: said}]);   // the server's words, unescaped
    assert.equal(calls.claudeCli, 1);
    assert.equal((await (await broker.health()).json()).chain.find(e => e.name === 'codex').failedToday, 1, 'still a Codex failure in /health');
    Date.now.mock.restore();
  }
  {   // nobody after Codex answers (Claude fails, Free AI is off): the caller gets Codex's own 502, not a budget or "unavailable" reason CI would read as a grey skip
    const error = capacity('Selected model is at capacity. Please try a different model.');
    const {broker} = world(t, 'codex', {...withToken, claude: claudeFails('boom'), extra: {FALLBACK_FREE_AI_DAY_USD: '0'}, codex: () => containerError(error)});
    const reply = await broker.call('pr', body);
    assert.equal(reply.status, 502); assert.equal((await reply.json()).why, error);
    Date.now.mock.restore();
  }
  const escapedKey = capacity('Selected model is at capacity \\u0073k-' + 'a'.repeat(30));   // Gitar on #406: token-shaped only once its JSON escape is decoded
  for (const error of ['codex-failed:1 boom', 'codex-failed:1 rate_limit_exceeded', capacity('Selected model is at capacity sk-' + 'a'.repeat(30)), escapedKey]) {   // any other failure or a token-shaped text: Claude answers (8 Nov 2026: a failure goes on), and the key never leaves the broker
    const {broker, calls} = world(t, 'codex', {...withToken, codex: () => containerError(error)});
    const answer = await (await broker.call('pr', body)).json();
    assert.equal(answer.engine, 'claude', error);
    assert.equal(calls.claudeCli, 1);
    assert.doesNotMatch(JSON.stringify(answer.fellBack), /sk-a{30}/, 'no key in fellBack');
    if (error === escapedKey) assert.deepEqual(answer.fellBack.map(e => e.detail), ['codex-failed (detail withheld: token-shaped)']);
    Date.now.mock.restore();
  }
});

test('Codex failing half its last calls moves behind Claude for 30 minutes, the owner is told once, a call that names its engine is never moved, then Codex is first again', async t => {
  const {broker, calls} = world(t, 'codex', {...withToken, codex: codexBroken});
  for (let i = 0; i < 6; i++) { later(i); const answer = await (await broker.call('pr', body)).json(); assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].engine, 'codex'); }   // Codex first, fails, Claude answers each (8 Nov 2026: a failure goes on); each still counts as a Codex failure
  assert.equal(calls.notes, 1);
  const health = await (await broker.health()).json();
  assert.ok(health.chain.find(e => e.name === 'codex').demotedUntil);
  const next = await (await broker.call('pr', body)).json();
  assert.equal(next.engine, 'claude'); assert.equal(next.fellBack, undefined);   // Claude answers first now
  assert.equal((await (await broker.call('pr', {...body, engine: 'codex'})).json()).fellBack[0].engine, 'codex');   // an explicit choice is honoured: Codex is asked first
  Date.now.mock.mockImplementation(() => day + 31 * 60_000);
  assert.equal((await (await broker.call('pr', body)).json()).fellBack[0].engine, 'codex');   // Codex is first again, with a fresh window
  assert.equal(calls.notes, 1);
});

test('only real failures count: a few failures, a used-up week, or ENGINE_ADAPT=off never move an engine', async t => {
  const few = world(t, 'codex', {...withToken, codex: codexBroken});
  for (let i = 0; i < 3; i++) await few.broker.call('pr', body);
  const ok = world(t, 'codex', withToken);
  for (let i = 0; i < 4; i++) await ok.broker.call('pr', body);
  assert.equal((await (await few.broker.health()).json()).chain[0].demotedUntil, undefined);   // 3 failures are below the 6 recorded
  const used = world(t, 'codex', withToken);
  await used.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600}); used.broker.limits = null;
  for (let i = 0; i < 12; i++) await used.broker.call('pr', body);   // Claude answers each; Codex "ran out" is not "worse"
  assert.equal((await (await used.broker.health()).json()).chain[0].demotedUntil, undefined);
  const off = world(t, 'codex', {...withToken, codex: codexBroken, extra: {ENGINE_ADAPT: 'off'}});
  for (let i = 0; i < 8; i++) await off.broker.call('pr', body);
  assert.equal((await (await off.broker.call('pr', body)).json()).fellBack[0].engine, 'codex');   // still Codex first, still failing, never moved
  assert.equal(off.calls.claudeCli, 9);   // each of the 9 calls asked Codex first, then Claude
  assert.equal(config.vars.ENGINE_ADAPT, 'on');
});

test('Claude failing half its last calls moves behind Codex and is not called for 30 minutes; with no other subscription configured nothing moves', async t => {
  const {broker, calls} = world(t, 'claude', {...withToken, claude: claudeFails('claude-failed:1 boom')});
  for (let i = 0; i < 6; i++) { later(i); assert.equal(await answered(await broker.call('pr', body)), 'codex'); }   // each fell through to Codex
  assert.equal(calls.claudeCli, 6);
  assert.equal(await answered(await broker.call('pr', body)), 'codex');
  assert.equal(calls.claudeCli, 6);   // demoted: Codex first, Claude not asked
  const alone = world(t, 'codex', {codex: codexBroken, extra: {FALLBACK_FREE_AI_DAY_USD: '0'}});   // no Claude token, Free AI off
  for (let i = 0; i < 7; i++) { later(i); assert.equal((await alone.broker.call('pr', body)).status, 502); }   // nowhere to move: still Codex
  assert.ok((await (await alone.broker.health()).json()).chain[0].demotedUntil);   // but the failure is reported
});

test('a failed Claude step says why, scrubbed: the reason is in fellBack and /health, never a token-shaped text, at most 200 characters', async t => {
  const failing = world(t, 'claude', {...withToken, claude: claudeFails('claude-failed:1 fetch failed: ECONNREFUSED api.anthropic.com')});
  const answer = await (await failing.broker.call('pr', body)).json();
  assert.deepEqual(answer.fellBack, [{engine: 'claude', why: 'failed', detail: 'claude-failed:1 fetch failed: ECONNREFUSED api.anthropic.com'}]);
  const entry = (await (await failing.broker.health()).json()).chain[0];
  assert.equal(entry.lastError.text, 'claude-failed:1 fetch failed: ECONNREFUSED api.anthropic.com'); assert.ok(entry.lastError.at);
  const platform = world(t, 'claude', {...withToken, claude: () => new Response('Container crashed while proxying request', {status: 500})});
  assert.equal((await (await platform.broker.call('pr', body)).json()).fellBack[0].detail, 'platform: Container crashed while proxying request');
  const leaky = world(t, 'claude', {...withToken, claude: claudeFails('claude-failed:1 sk-' + 'a'.repeat(40))});
  assert.equal((await (await leaky.broker.call('pr', body)).json()).fellBack[0].detail, '(detail withheld: token-shaped)');
  const long = world(t, 'claude', {...withToken, claude: claudeFails('x '.repeat(400))});
  assert.ok((await (await long.broker.call('pr', body)).json()).fellBack[0].detail.length <= 200);
});

test('only: true pins a call to one engine for each of codex, claude and free-ai: it answers alone, and when it cannot the call is refused with the reason, never answered by another engine', async t => {
  // claude: answers alone; a failure, a missing token and a used-up allowance each refuse, and neither Codex nor Free AI nor the API is asked
  const ok = world(t, 'codex', withToken);
  const claude = await (await ok.broker.call('pr', {...body, engine: 'claude', only: true})).json();
  assert.equal(claude.engine, 'claude'); assert.equal(claude.fellBack, undefined);
  const broken = world(t, 'codex', {...withToken, claude: claudeFails('claude-failed:1 boom')});
  const refused = await broken.broker.call('pr', {...body, engine: 'claude', only: true});
  assert.equal(refused.status, 503);
  const answer = await refused.json();
  assert.equal(answer.why, 'only-claude: failed'); assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.tried, [{engine: 'claude', why: 'failed', detail: 'claude-failed:1 boom'}]);
  assert.equal(broken.calls.free, 0); assert.equal(broken.calls.paid, 0); assert.ok(!broken.dispatched.some(path => path.endsWith('/call')));
  const noToken = world(t, 'codex');
  assert.equal((await (await noToken.broker.call('pr', {...body, engine: 'claude', only: true})).json()).why, 'only-claude: not-configured');
  const limit = world(t, 'codex', {...withToken, claude: claudeFails('claude-limit', {resetsAt: day / 1000 + 600})});
  assert.equal((await (await limit.broker.call('pr', {...body, engine: 'claude', only: true})).json()).why, 'only-claude: ran-out');
  // codex: its week used up is a refusal, not Claude's or Free AI's answer
  const week = world(t, 'claude', withToken);
  await week.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  week.broker.limits = null;
  const codex = await week.broker.call('pr', {...body, engine: 'codex', only: true});
  assert.equal(codex.status, 429); assert.equal(week.calls.claudeCli, 0); assert.equal(week.calls.free, 0);
  // free-ai: answers alone without touching Codex; when it has nothing to give the call is refused
  const free = world(t, 'codex', withToken);
  assert.equal(await answered(await free.broker.call('pr', {...body, engine: 'free-ai', only: true})), 'free-ai');
  assert.ok(!free.dispatched.length);
  const dry = world(t, 'codex', {...withToken, free: () => { throw new Error('model down'); }});
  const none = await dry.broker.call('pr', {...body, engine: 'free-ai', only: true});
  assert.equal(none.status, 503); assert.equal((await none.json()).why, 'fallback:unavailable');
  assert.ok(!dry.dispatched.length);
  // the API engines keep their own specific refusals (Gitar on #296): search is not theirs, a used-up day is the budget answer
  const search = await free.broker.call('pr', {...body, engine: 'free-ai', only: true, search: true});
  assert.equal(search.status, 503); assert.equal((await search.json()).why, 'fallback:search-unsupported');
  const capped = world(t, 'codex', {...withToken, extra: {FALLBACK_FREE_AI_DAY_USD: '0'}});
  const spent = await capped.broker.call('pr', {...body, engine: 'free-ai', only: true});
  assert.equal(spent.status, 429); assert.match((await spent.json()).why, /^budget:fallback-day/);
  assert.ok(!capped.dispatched.length && capped.calls.free === 0);
  const claudeSearch = await ok.broker.call('pr', {...body, engine: 'claude', only: true, search: true});
  assert.equal(claudeSearch.status, 200); assert.equal((await claudeSearch.json()).engine, 'claude');   // 2 Nov 2026: Claude searches now
  assert.equal(ok.calls.claudeBodies.at(-1).search, true);
  // without only the same calls still fall back (unchanged)
  const open = world(t, 'codex', {...withToken, claude: claudeFails('claude-failed:1 boom')});
  assert.equal(await answered(await open.broker.call('pr', {...body, engine: 'claude'})), 'codex');   // the next engine in the chain, as before
});

test('only must be a boolean and needs an engine: otherwise a 400 that says so', async t => {
  const {broker} = world(t, 'codex', withToken);
  for (const only of ['yes', 1, null]) {
    const response = await broker.call('pr', {...body, engine: 'claude', only});
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), {why: 'only must be a boolean'});
  }
  const bare = await broker.call('pr', {...body, only: true});
  assert.equal(bare.status, 400); assert.match((await bare.json()).why, /only needs an engine/);
  assert.equal((await broker.call('pr', {...body, only: false})).status, 200);
});

test('chainOf with only: the one engine alone; without a request only is ignored', () => {
  assert.deepEqual(chainOf({}, 'claude', [], true).chain, ['claude']);
  assert.deepEqual(chainOf({ENGINE: 'claude'}, undefined, [], true).chain, chainOf({ENGINE: 'claude'}).chain);
});

test('subs: true is the two subscriptions alone, the named one first: Claude answers when Codex fails, and when both fail the call is refused with each reason, never by Free AI', async t => {
  assert.deepEqual(chainOf({}, 'codex', [], false, true).chain, ['codex', 'claude']);
  assert.deepEqual(chainOf({}, 'claude', [], false, true).chain, ['claude', 'codex']);
  const fails = world(t, 'codex', {...withToken, codex: () => containerError('codex-failed:1 boom')});
  const claude = await (await fails.broker.call('pr', {...body, engine: 'codex', subs: true})).json();
  assert.equal(claude.engine, 'claude'); assert.equal(claude.fellBack[0].engine, 'codex');
  const both = world(t, 'codex', {...withToken, codex: () => containerError('codex-failed:1 boom'), claude: claudeFails('claude-failed:1 boom')});
  const refused = await both.broker.call('pr', {...body, engine: 'codex', subs: true});
  assert.equal(refused.status, 502, 'Codex\'s own failure stands (the first engine\'s words win), never Free AI\'s');
  assert.doesNotMatch(JSON.stringify(await refused.json()), /budget:|fallback:/, 'CI reads `budget:` as a grey skip');
  assert.equal(both.calls.free, 0);
  const week = world(t, 'codex', {...withToken, claude: claudeFails('claude-failed:1 boom')});
  await week.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  week.broker.limits = null;
  const spent = await week.broker.call('pr', {...body, engine: 'codex', subs: true});
  assert.equal(spent.status, 503); assert.equal((await spent.json()).why, 'subs: codex ran-out, claude failed');
  assert.equal(week.calls.free, 0);
  const noToken = world(t, 'codex');
  await noToken.storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  noToken.broker.limits = null;
  const alone = await noToken.broker.call('pr', {...body, engine: 'codex', subs: true});
  assert.equal(alone.status, 429); assert.match((await alone.json()).why, /^budget:week/, 'a used-up week with no Claude stays the door\'s control (unchanged): CI shows it as not run');
  assert.equal(noToken.calls.free, 0);
  const open = world(t, 'codex', {codex: () => containerError('codex-failed:1 boom')});
  assert.equal(await answered(await open.broker.call('pr', {...body, engine: 'codex'})), 'free-ai', 'without subs the chain still ends at Free AI (unchanged)');
});

test('subs must be a boolean, with a subscription engine and without only: otherwise a 400 that says so', async t => {
  const {broker} = world(t, 'codex', withToken);
  for (const wrong of [{engine: 'codex', subs: 'yes'}, {subs: true}, {engine: 'free-ai', subs: true}, {engine: 'codex', only: true, subs: true}]) {
    const response = await broker.call('pr', {...body, ...wrong});
    assert.equal(response.status, 400, JSON.stringify(wrong)); assert.match((await response.json()).why, /^subs needs an engine of codex or claude/);
  }
  assert.equal((await broker.call('pr', {...body, engine: 'codex', subs: false})).status, 200);
});
