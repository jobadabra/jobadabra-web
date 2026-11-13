// Guards the broker's claims (13 Nov 2026, owner via sa: "each workflow should take its necessary slots" · "First come, first serve" · "Not everyhting that's available"): FIFO, never more than asked, a run that stops asking frees its room, who comes from the verified token only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness, entry} from './harness.mjs';
import {ask, release, view, whoOf, CAPACITY, HELD_MS, WAITING_MS} from '../../../../workers/ai-broker/lib/claims.mjs';

const t0 = Date.parse('2026-11-13T04:00:00Z');
const run = (state, steps) => steps.reduce((acc, [who, need, at]) => { const r = ask(acc.state, who, need, at ?? t0); acc.state = r.state; acc.out.push([who, r.status]); return acc; }, {state: undefined, out: []});

test('first come, first served: each run holds only what it asked, the next waits until it fits, a smaller one never passes the head', () => {
  assert.equal(CAPACITY, 6);
  const {state, out} = run(undefined, [['bench#1', 4], ['pair#2', 4], ['night#3', 1]]);
  assert.deepEqual(out, [['bench#1', 200], ['pair#2', 202], ['night#3', 202]], 'night#3 fits in the 2 left but waits behind pair#2');
  assert.deepEqual(view(state, t0).held.map(c => [c.who, c.need]), [['bench#1', 4]]);
  const after = release(state, 'bench#1', t0 + 1000).state;
  assert.deepEqual(view(after, t0 + 1000).held.map(c => [c.who, c.need]), [['pair#2', 4], ['night#3', 1]], 'the line moves in order on release');
  assert.equal(view(after, t0 + 1000).used, 5);
});

test('asking again renews and never grows a claim; a place keeps its position', () => {
  let {state} = run(undefined, [['a#1', 5], ['b#2', 3]]);
  const renew = ask(state, 'a#1', 6, t0 + 60_000);
  assert.equal(renew.status, 200); assert.equal(renew.reply.need, 5);
  const wait = ask(renew.state, 'b#2', 3, t0 + 30_000);
  assert.equal(wait.status, 202); assert.equal(wait.reply.position, 1);
  assert.deepEqual(wait.reply.held, [{who: 'a#1', need: 5}]);
});

test('a cancelled run frees its room by itself: held after HELD_MS without an ask, a waiting place after WAITING_MS', () => {
  let {state} = run(undefined, [['gone#1', 6], ['next#2', 2], ['quiet#3', 1]]);
  state = ask(state, 'next#2', 2, t0 + WAITING_MS - 1).state;   // next keeps asking; quiet does not
  const later = ask(state, 'next#2', 2, t0 + HELD_MS);
  assert.equal(later.status, 200, 'gone#1 stopped renewing: its room went to the head of the line');
  assert.deepEqual(view(later.state, t0 + HELD_MS).waiting, [], 'quiet#3 left the line');
});

test('a need outside 1..CAPACITY is refused and changes nothing', () => {
  for (const need of [0, 7, 1.5, '2', undefined]) {
    const r = ask(undefined, 'x#1', need, t0);
    assert.equal(r.status, 400, String(need)); assert.equal(r.state, undefined);
  }
});

test('who is the verified workflow and run id, never a name the caller sends', () => {
  const ref = '{"job_workflow_ref":"jobadabra/jobadabra/.github/workflows/search-pair.yml@refs/heads/main","run_id":"43358409610"}';
  assert.equal(whoOf(JSON.parse(ref)), 'jobadabra/search-pair.yml#43358409610');
  assert.equal(whoOf({job_workflow_ref: 'x', run_id: '1; drop'}), 'unknown#unknown');
});

// Why (13 Nov 2026): the route is reached only through the Worker and the object; a missing import or header there would show only on CI's first claim.
test('through the Worker: a signed run claims, waits, releases, and /health shows the line', async t => {
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const jwk = {...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1'}, enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenFor = async (file, runId) => { const head = `${enc({alg: 'RS256', kid: 'k1'})}.${enc({iss: 'https://token.actions.githubusercontent.com', aud: 'jobadabra-ai-broker', repository: 'jobadabra/jobadabra', event_name: 'workflow_dispatch', exp: Math.floor(Date.now() / 1000) + 600, run_id: runId, job_workflow_ref: `jobadabra/jobadabra/.github/workflows/${file}@refs/heads/main`})}`; return `${head}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head))).toString('base64url')}`; };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({keys: [jwk]})));
  const {broker} = harness();
  const env = {BROKER_NEXT: {getByName: () => broker}};
  const claim = async (file, runId, method, need) => entry.fetch(new Request('https://broker/claim', {method, headers: {authorization: `Bearer ${await tokenFor(file, runId)}`, 'x-who': 'smuggled#1'}, body: method === 'POST' ? JSON.stringify({need}) : undefined}), env);
  assert.equal((await claim('search-pair.yml', '11', 'POST', 4)).status, 200);
  const waiting = await claim('search-personas.yml', '12', 'POST', 3);
  assert.equal(waiting.status, 202); assert.equal((await waiting.json()).position, 1);
  assert.equal((await entry.fetch(new Request('https://broker/claim', {method: 'POST', body: '{"need":1}'}), env)).status, 401, 'no token, no claim');
  assert.equal((await claim('search-pair.yml', '11', 'DELETE')).status, 200);
  const health = await (await entry.fetch(new Request('https://broker/health'), env)).json();
  assert.deepEqual(health.claims.held.map(c => [c.who, c.need]), [['jobadabra/search-personas.yml#12', 3]], 'the caller-sent x-who is never used');
  assert.equal(health.claims.capacity, CAPACITY);
});
