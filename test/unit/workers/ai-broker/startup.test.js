// The broker's first minutes (jobadabra-web #285; owner, 5 Nov 2026: "Fix readiness", then "Rework: pass on while starting").
// The incident (1 Nov 2026, 21:39): the container application was replaced, /health said ready from the stored login alone, and the next 4 of 4 calls failed with Codex's "Transport channel closed".
// Intended: `starting` until a real Codex call is answered; while starting, a failed Codex call goes to the next engine; once answered, a failure is a failure again. No call of our own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {body, success, harness} from './harness.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const MCP_CLOSED = () => new Response(JSON.stringify({error: 'codex-failed:1 ps/mcp … Transport channel closed'}), {status: 500});
const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}));
const healthOf = async broker => (await broker.health()).json();

// A freshly started container: onStart ran (nothing answered). `codex` answers /call, `claude` answers /claude; every request is listed.
async function fresh(t, {codex = MCP_CLOSED, claude = claudeOk, token = true} = {}) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  const made = harness(undefined, {...config.vars, ENGINE: 'codex', ...(token ? {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'} : {})});
  const seen = [];
  made.broker.containerFetch = async url => { seen.push(new URL(url).pathname); return url.endsWith('/claude') ? claude() : url.endsWith('/call') ? codex() : new Response('{"ok":true}'); };
  await made.broker.onStart();
  return {...made, seen, set codex(fn) { codex = fn; }};
}

test('the incident: login stored, fresh container: /health says starting; a failing Codex call is answered by the next engine; the first Codex answer makes it ready', async t => {
  const world = await fresh(t);
  const {broker} = world;
  assert.equal((await healthOf(broker)).state, 'starting');
  const answer = await (await broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.reply, 'claude ok');
  assert.equal(answer.fellBack[0].engine, 'codex'); assert.equal(answer.fellBack[0].why, 'failed'); assert.match(answer.fellBack[0].detail, /Transport channel closed/);
  const health = await healthOf(broker);
  assert.equal(health.state, 'starting');   // a Claude answer proves nothing about Codex's start-up
  assert.match(health.startError.error, /Transport channel closed/);
  world.codex = success;
  assert.equal((await (await broker.call('scheduled', body)).json()).engine, 'codex');
  const ready = await healthOf(broker);
  assert.equal(ready.state, 'ready'); assert.equal(ready.startError, undefined);
});

test('no call of our own: starting a container only puts the login back, and /health hits never reach the container', async t => {
  const {broker, seen} = await fresh(t);
  for (let i = 0; i < 5; i++) await healthOf(broker);
  assert.deepEqual(seen, ['/auth']);
});

test('once the container has answered, a Codex failure is a failure again (no pass-on, Claude is not asked)', async t => {
  const world = await fresh(t, {codex: success});
  await world.broker.call('scheduled', body);
  assert.equal((await healthOf(world.broker)).state, 'ready');
  world.codex = MCP_CLOSED;
  const failed = await world.broker.call('scheduled', body);
  assert.equal(failed.status, 502); assert.match((await failed.json()).why, /Transport channel closed/);
  assert.equal(world.seen.includes('/claude'), false);
});

test('a new container start (a deploy, a wake from sleep) passes failures on again until it has answered', async t => {
  const world = await fresh(t, {codex: success});
  await world.broker.call('scheduled', body);
  world.codex = MCP_CLOSED;
  await world.broker.onStart();
  assert.equal((await healthOf(world.broker)).state, 'starting');
  assert.equal((await (await world.broker.call('scheduled', body)).json()).engine, 'claude');
});

test('nobody after Codex, or a call pinned to Codex: the failure stands, nothing is passed on', async t => {
  const alone = await fresh(t, {token: false});
  assert.equal((await alone.broker.call('scheduled', body)).status, 502);   // ENGINE=codex with no Claude token and no Free AI binding
  const pinned = await fresh(t);
  const refused = await pinned.broker.call('scheduled', {...body, engine: 'codex', only: true});
  assert.equal(refused.status, 502); assert.equal(pinned.seen.includes('/claude'), false);
});

test('a container that is down or answers with the platform\'s own text is also passed on while starting', async t => {
  const down = await fresh(t, {codex: () => { throw new Error('container unavailable'); }});
  assert.equal((await (await down.broker.call('scheduled', body)).json()).engine, 'claude');
  const text = await fresh(t, {codex: () => new Response('Internal Server Error', {status: 500})});
  assert.equal((await (await text.broker.call('scheduled', body)).json()).engine, 'claude');
  assert.match((await healthOf(text.broker)).startError.error, /Internal Server Error/);
});

test('a lost login is never passed on: the owner sees login-lost, and Codex out of allowance counts as an answer', async t => {
  const lost = await fresh(t, {codex: () => new Response(JSON.stringify({error: 'login-lost'}), {status: 500})});
  const refused = await lost.broker.call('scheduled', body);
  assert.equal(refused.status, 503);
  assert.equal((await healthOf(lost.broker)).state, 'login-lost');
  const full = await fresh(t, {codex: () => new Response(JSON.stringify({error: "You've hit your usage limit. Try again at 9:00 AM."}), {status: 500})});
  assert.equal((await (await full.broker.call('scheduled', body)).json()).engine, 'claude');
  assert.equal((await healthOf(full.broker)).state, 'ready');
});

test('no login keeps no-login; a new login upload is proven again before ready', async t => {
  const world = await fresh(t, {codex: success});
  await world.broker.call('scheduled', body);
  await world.storage.put('lost', true);
  assert.equal((await world.broker.setLogin('{"tokens":{}}')).status, 200);
  assert.equal((await healthOf(world.broker)).state, 'starting');
  await world.storage.put('login', undefined);
  assert.equal((await healthOf(world.broker)).state, 'no-login');
});

test('a conversation turn passed on while starting leaves a hole, so the next turn restarts from the full prompt', async t => {
  const world = await fresh(t, {codex: () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 2, output: 3}, ms: 1, session: {mode: 'opened'}}))});
  const key = 'jobadabra/jobadabra#987.1#agent-g1';
  await world.broker.call('scheduled', {...body, tier: 'mid'}, 'wf', '', key);
  assert.equal((await world.storage.get('sessions'))[key].stale, undefined);
  world.codex = MCP_CLOSED;
  await world.broker.onStart();
  assert.equal((await (await world.broker.call('scheduled', {...body, tier: 'mid', delta: 'next'}, 'wf', '', key)).json()).engine, 'claude');
  assert.equal((await world.storage.get('sessions'))[key].stale, true);
});

test('a thrown container error is rethrown once the container has answered, and a token-shaped one is withheld while starting', async t => {
  const proven = await fresh(t, {codex: success});
  await proven.broker.call('scheduled', body);
  proven.codex = () => { throw new Error('container unavailable'); };
  await assert.rejects(() => proven.broker.call('scheduled', body), /container unavailable/);
  const leaky = await fresh(t, {codex: () => { throw new Error('boom sk-' + 'a'.repeat(30)); }});
  assert.equal((await (await leaky.broker.call('scheduled', body)).json()).engine, 'claude');
  assert.equal(JSON.stringify(await healthOf(leaky.broker)).includes('sk-aaaa'), false);
});

test('Codex failing before its first answer shows in /health: failed calls counted per engine, state still starting', async t => {
  const world = await fresh(t);
  for (let i = 0; i < 3; i++) await world.broker.call('scheduled', body);
  const health = await healthOf(world.broker);
  assert.equal(health.state, 'starting');
  assert.equal(health.chain.find(entry => entry.name === 'codex').failedToday, 3);
});

test('calls sent together in the first minute all pass on, even when another call is answered while they fail (code-review, 5 Nov 2026)', async t => {
  const world = await fresh(t);
  // The call is already on its way to the container when a neighbour's answer arrives: what counts is what the container had proven when THIS call was sent.
  world.codex = async () => { await world.storage.put('answered', true); return MCP_CLOSED(); };
  const answer = await (await world.broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].why, 'failed');
  world.codex = MCP_CLOSED;
  assert.equal((await world.broker.call('scheduled', body)).status, 502, 'the next call is sent after the proof: a failure stands');
});

test('when nobody answers after the pass-on, the 502 keeps the Worker leg timeline (a8\'s one timeline), also for a platform text', async t => {
  const refused = () => new Response(JSON.stringify({error: 'claude-failed: nope'}), {status: 500});
  for (const codex of [MCP_CLOSED, () => new Response('Internal Server Error', {status: 500})]) {
    const world = await fresh(t, {codex, claude: refused});
    const failed = await world.broker.call('scheduled', body);
    assert.equal(failed.status, 502);
    const answer = await failed.json();
    assert.equal(typeof answer.timeline?.waitMs, 'number'); assert.equal(answer.timeline.status, 500);
  }
});

test('a storage failure while reading the proof never hides the container\'s own failure behind another engine', async t => {
  const world = await fresh(t);
  const read = world.storage.get;
  world.storage.get = async key => { if (key === 'answered') throw new Error('storage down'); return read(key); };
  const failed = await world.broker.call('scheduled', body);
  assert.equal(failed.status, 502); assert.match((await failed.json()).why, /Transport channel closed/);
  assert.equal(world.seen.includes('/claude'), false);
});

test('a key across the 300th character of a platform text is not kept in startError or fellBack', async t => {
  const key = `sk-${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`, text = `${'word '.repeat(58)}${key}`;   // words, not a run of letters (that alone is token-shaped); the key starts at character 290 so the 300-cut keeps only its first 10
  const world = await fresh(t, {codex: () => new Response(text, {status: 500})});
  const answer = await (await world.broker.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude');
  const seen = JSON.stringify([answer.fellBack, (await healthOf(world.broker)).startError]);
  assert.equal(seen.includes('sk-'), false); assert.match(seen, /withheld/);
});
