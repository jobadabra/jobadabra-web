// The life of one AI call (design approved by the owner, 8 Nov 2026: "Approve (Recommended)", "Yes, codes (Recommended)"): the container's coded kinds, the walk's four verdicts, and gi's two cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {body, success, harness, containerError} from './harness.mjs';
import {kindOf} from '../../../../workers/ai-broker/container/kinds.mjs';
import {walk, answered, refused, unavailable, failed} from '../../../../workers/ai-broker/lib/walk.mjs';
import {newMeter, record, TOKENS_PER_PERCENT, CODEX_LIMIT_PCT} from '../../../../workers/ai-broker/lib/budget.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const withToken = {...config.vars, ENGINE: 'codex', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token', FALLBACK_FREE_AI_DAY_USD: '0'};
const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}));
function world(t, {codex = success, claude = claudeOk, meter, env = withToken} = {}) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  const made = harness(meter, env), seen = [];
  made.broker.containerFetch = async url => { seen.push(new URL(url).pathname); return url.endsWith('/claude') ? claude() : url.endsWith('/call') ? codex() : new Response('{"ok":true}'); };
  return {...made, seen};
}

test('the container codes every failure it sends: one kind per cause, "failed" for the rest', () => {
  const table = [
    ['login-lost', 'login-lost'], ['claude-auth', 'login-lost'],
    ["codex-failed:1 You've hit your usage limit. Try again at 9:00 AM.", 'out-of-quota'], ['codex-failed:1 {"error":{"type":"usage_limit_reached"}}', 'out-of-quota'], ['claude-limit', 'out-of-quota'],
    ['codex-failed:null [killed after 100 s: codex did not finish] [codex events: 2, last: thread.started > turn.started]', 'stalled'], ['claude-failed:timeout', 'stalled'],
    ['codex-failed:1 Selected model is at capacity. Please try a different model.', 'at-capacity'], ['codex-failed:1 Server overloaded; retry later.', 'at-capacity'],
    ['codex-failed:1 boom', 'failed'], ['codex-failed:1 rate_limit_exceeded', 'failed'], ['claude-failed:1 fetch failed', 'failed'], ['', 'failed'],
  ];
  for (const [error, kind] of table) assert.equal(kindOf(error), kind, error);
});

test('walk: a failed or unavailable engine hands the call to the next, the first engine reply is held, and the left list names each', async () => {
  const order = [], verdicts = {a: failed('failed', 'boom', {status: 502}), b: unavailable('ran-out'), c: answered({status: 200})};
  const result = await walk(['a', 'b', 'c'], async engine => { order.push(engine); return verdicts[engine]; }, async () => {});
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(result.engine, 'c'); assert.deepEqual(result.left, [{engine: 'a', why: 'failed', detail: 'boom'}, {engine: 'b', why: 'ran-out'}]);
});

test('walk: a refused call ends there, nobody else is asked; an engine that is not asked (null) leaves no trace', async () => {
  const order = [];
  const result = await walk(['a', 'b', 'c'], async engine => { order.push(engine); return engine === 'a' ? null : engine === 'b' ? refused({status: 503}) : answered({}); }, async () => {});
  assert.deepEqual(order, ['a', 'b']); assert.equal(result.engine, 'b'); assert.deepEqual(result.left, []);
});

test('walk: nobody answers: the first engine reply is held for the caller, and an engine that was only busy gets one more turn at the back', async () => {
  const turns = [];
  const result = await walk(['a', 'b'], async (engine, left, last) => { turns.push([engine, last]); return engine === 'a' ? unavailable('busy') : failed('failed', 'x', {status: 502, from: 'b'}); }, async () => {});
  assert.deepEqual(turns, [['a', false], ['b', false], ['a', true]]);
  assert.equal(result.engine, null); assert.deepEqual(result.held, {status: 502, from: 'b'}); assert.deepEqual(result.left.map(e => e.why), ['busy', 'failed', 'busy']);
});

test('gi case (a), p2 run 42463982100: Codex stalled 100 s after the container was proven, and the call went to Claude (it got a 503 in 1 of 1,107 calls)', async t => {
  const stalled = 'codex-failed:null [killed after 100 s: codex did not finish] [codex events: 2, last: thread.started > turn.started]';
  const {broker, seen} = world(t);
  await broker.onStart();
  assert.equal((await broker.call('scheduled', body)).status, 200);   // Codex answers: the container is proven
  broker.containerFetch = async url => url.endsWith('/claude') ? claudeOk() : containerError(stalled);
  const answer = await (await broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].why, 'failed'); assert.match(answer.fellBack[0].detail, /killed after 100 s/);
  assert.equal(seen.filter(p => p === '/call').length, 1);
});

test('gi case (b), night search 42427805860: a scheduled call refused by Codex\'s own-share line (any line) is answered by Claude, not measured as a refusal', async t => {
  const meter = record(newMeter(2000000000), 'scheduled', (CODEX_LIMIT_PCT + 1) * TOKENS_PER_PERCENT, 1);   // the broker's own share is over Codex's line (the 70% reserve of the night search is gone since #492)
  const {broker, seen} = world(t, {meter});
  const answer = await (await broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.match(answer.fellBack[0].why, /budget|ran-out/);
  assert.equal(seen.includes('/call'), false, 'Codex is not asked past its line');
});

test('a call that names its engine with only: true is never walked: the failure ends it', async t => {
  const {broker, seen} = world(t, {codex: () => containerError('codex-failed:1 boom')});
  const reply = await broker.call('scheduled', {...body, engine: 'codex', only: true});
  assert.equal(reply.status, 502); assert.equal(seen.includes('/claude'), false);
});

const plain = (error, status = 500) => () => new Response(JSON.stringify({error}), {status});   // an older container image (a deploy in flight) sends no `kind`

test('code-review 8 Nov 2026: a container image without `kind` is read by its words, so a deploy in flight changes no verdict', async t => {
  const lost = world(t, {codex: plain('login-lost')});
  assert.equal((await lost.broker.call('scheduled', body)).status, 503);   // the owner sees it, Claude does not hide it
  const full = world(t, {codex: plain("codex-failed:1 You've hit your usage limit. Try again at 9:00 AM.")});
  const answer = await (await full.broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].why, 'ran-out');
  const claudeFull = world(t, {codex: plain('codex-failed:1 boom'), claude: plain('claude-limit')});
  assert.equal((await claudeFull.broker.call('scheduled', body)).status, 502);
  assert.ok((await claudeFull.storage.get('claude:state')).limitUntil, 'Claude\'s limit is remembered');
});

test('code-review 8 Nov 2026: calls cut by a deploy are failed turns that go on, but never count against the engine (no demotion, no Telegram)', async t => {
  const cut = world(t, {codex: () => { throw new Error('Container suddenly disconnected'); }});
  for (let i = 0; i < 8; i++) { const answer = await (await cut.broker.call('scheduled', body)).json(); assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].why, 'cut'); }
  assert.equal((await (await cut.broker.health()).json()).chain[0].demotedUntil, undefined);
  const drained = world(t, {codex: () => new Response(JSON.stringify({error: 'draining'}), {status: 503, headers: {'x-broker-draining': '1'}})});
  drained.broker.drainWaitMs = 20; drained.broker.drainPollMs = 5;
  assert.equal((await (await drained.broker.call('scheduled', body)).json()).fellBack[0].why, 'cut');
});

test('code-review 8 Nov 2026: a reply the guard refuses (key-shaped, prompt echoed) ends the call: no other engine is asked the same prompt', async t => {
  const leaky = world(t, {codex: () => new Response(JSON.stringify({reply: 'sk-' + 'a'.repeat(30), tokens: {input: 1, output: 1}, ms: 1}))});
  assert.equal((await leaky.broker.call('scheduled', body)).status, 422);
  assert.equal(leaky.seen.includes('/claude'), false);
});
