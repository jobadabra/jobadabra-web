// The broker says "ready" only once its container has answered (jobadabra-web #285; owner, 5 Nov 2026: "Fix readiness, no live test").
// The incident (1 Nov 2026, 21:39): the container application was replaced, /health said ready from the stored login alone, and the next 4 of 4 calls failed with Codex's "Transport channel closed".
import test from 'node:test';
import assert from 'node:assert/strict';
import {body, success, harness} from './harness.mjs';

const MCP_CLOSED = () => new Response(JSON.stringify({error: 'codex-failed:1 ps/mcp … Transport channel closed'}), {status: 500});
const stateOf = async broker => (await (await broker.health()).json()).state;

// A container whose /call answers with `answer()`; every request it receives is listed.
function container(broker, answer) {
  const seen = [];
  broker.containerFetch = async (url, init) => { seen.push(new URL(url).pathname); return url.endsWith('/call') ? answer(init) : new Response('{"ok":true}'); };
  return seen;
}

test('the incident: a login is stored, the fresh container has not answered: /health is not ready; after one answer it is', async () => {
  const {broker, settled} = harness();
  container(broker, MCP_CLOSED);
  await broker.onStart();
  await settled();
  assert.equal(await stateOf(broker), 'starting');
  broker.containerFetch = async () => success();
  assert.equal((await broker.call('scheduled', body)).status, 200);
  assert.equal(await stateOf(broker), 'ready');
});

test('a container start probes once, and /health hits never call the container', async () => {
  const {broker, settled} = harness();
  const seen = container(broker, () => success());
  await broker.onStart();
  await settled();
  for (let i = 0; i < 5; i++) await stateOf(broker);
  assert.deepEqual(seen, ['/auth', '/call']);   // the login back into the container, then one probe
  assert.equal(await stateOf(broker), 'ready');
});

test('a failed probe is not retried: /health stays starting and names why', async () => {
  const {broker, settled} = harness();
  const seen = container(broker, MCP_CLOSED);
  await broker.onStart();
  await settled();
  assert.equal(seen.filter(path => path === '/call').length, 1);
  const health = await (await broker.health()).json();
  assert.equal(health.state, 'starting');
  assert.match(health.probe.error, /Transport channel closed/);
});

test('a new container start (a deploy, a wake from sleep) is not ready until it has answered again', async () => {
  const {broker, settled} = harness();
  container(broker, () => success());
  await broker.onStart(); await settled();
  assert.equal(await stateOf(broker), 'ready');
  container(broker, MCP_CLOSED);
  await broker.onStart(); await settled();
  assert.equal(await stateOf(broker), 'starting');
});

test('a call that fails inside the container does not make it ready; Codex out of allowance does (the container ran Codex end to end)', async () => {
  const {broker, settled} = harness();
  container(broker, MCP_CLOSED);
  await broker.onStart(); await settled();
  assert.equal((await broker.call('scheduled', body)).status, 502);
  assert.equal(await stateOf(broker), 'starting');
  container(broker, () => new Response(JSON.stringify({error: "You've hit your usage limit. Try again at 9:00 AM."}), {status: 500}));
  await broker.call('scheduled', body);
  assert.equal(await stateOf(broker), 'ready');
});

test('no login, no probe: no-login and login-lost keep their own words, never starting', async () => {
  const {broker, storage, settled} = harness();
  const seen = container(broker, () => success());
  await storage.put('login', undefined);
  await broker.onStart(); await settled();
  assert.deepEqual(seen, []);
  assert.equal(await stateOf(broker), 'no-login');
  await storage.put('login', 'test login'); await storage.put('lost', true);
  assert.equal(await stateOf(broker), 'login-lost');
});

test('the probe is not a CI call: no meter, no tally, and a rotated login it brings back is stored', async () => {
  const {broker, storage, settled} = harness();
  container(broker, () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 9, output: 9}, ms: 1, authFile: 'rotated login'})));
  await broker.onStart(); await settled();
  assert.equal(await storage.get('meter'), undefined);
  assert.equal(await storage.get('tally'), undefined);
  assert.equal(await storage.get('login'), 'rotated login');   // the same write-through as a call: a refreshed token is never only in the container
  assert.equal((await (await broker.health()).json()).daily.drift, 0);
});
