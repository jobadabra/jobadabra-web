// A busy Claude passes calls on, and PR checks keep 30% of the Codex week (owner, 3 Nov 2026: "Busy = next engine + PR reserve").
// Fakes only: the container is a promise the test releases, the clock is node's mock timers (setTimeout) plus a fixed Date.now. No provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, body, success, harness} from './harness.mjs';
import {slots} from '../../../../workers/ai-broker/lib/queue.mjs';
import {BUSY_MS} from '../../../../workers/ai-broker/lib/busy.mjs';
import {newMeter, TOKENS_PER_PERCENT} from '../../../../workers/ai-broker/lib/budget.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}));
const until = async condition => { for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(condition(), 'the state the test waits for never came'); };
const settles = promise => { const state = {done: false}; promise.then(() => { state.done = true; }, () => { state.done = true; }); return state; };
const quiet = () => new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)));

// A broker whose Claude calls stay in the container until the test releases them (`held`), so its 3 slots can be full. Codex's week is used up unless `week` says otherwise.
async function setup(t, {engine = 'codex', week = 100, hold = true, free = () => ({response: 'free answer', usage: {prompt_tokens: 100, completion_tokens: 20}}), extra = {}} = {}) {
  t.mock.method(Date, 'now', () => day);
  t.mock.timers.enable({apis: ['setTimeout']});
  const calls = {free: 0, claudeCli: 0}, held = [];
  const env = {...config.vars, ENGINE: engine, CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token', AI: {run: async () => { calls.free++; return free(); }}, ...extra};
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  const made = harness(undefined, env);
  made.broker.containerFetch = async url => {
    if (!String(url).endsWith('/claude')) return success();
    calls.claudeCli++;
    if (hold) await new Promise(resolve => held.push(resolve));
    return claudeOk();
  };
  await made.storage.put('limits', {usedPercent: week, resetsAt: day / 1000 + 3600});
  made.broker.limits = null;
  const releaseOne = () => held.shift()();
  const drain = async promise => { const state = settles(promise); for (let i = 0; i < 500 && !state.done; i++) { while (held.length) held.shift()(); await quiet(); } return promise; };   // lets every held container call finish until `promise` is settled
  const fill = async () => {   // three searches take Claude's three slots and stay there
    const running = Array.from({length: 3}, () => made.broker.call('pr', {...body, search: true, engine: 'claude', only: true}));   // pinned to Claude whatever Codex has left
    await until(() => calls.claudeCli === 3);
    return running;
  };
  const wait = async () => { await until(() => made.broker.claudeGate.stats().waiting.pr === 1); t.mock.timers.tick(BUSY_MS); await quiet(); };
  return {...made, calls, held, releaseOne, drain, fill, wait};
}
const json = async response => response.json();

test('a timed wait gives up after its time and leaves the line; an untimed one waits; a slot freed in time goes to the waiter', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const line = slots(1), first = await line.acquire('pr');
  const timed = line.acquire('scheduled', 500), untimed = line.acquire('scheduled');
  assert.deepEqual(line.stats().waiting, {pr: 0, scheduled: 2, bench: 0});
  t.mock.timers.tick(500);
  assert.equal(await timed, null);
  assert.deepEqual(line.stats().waiting, {pr: 0, scheduled: 1, bench: 0}, 'the one that gave up is out of the line');
  const inTime = line.acquire('pr', 500);
  first();
  const got = await inTime;
  assert.equal(typeof got, 'function', 'a PR check waiting with a deadline still goes first when a slot frees');
  t.mock.timers.tick(10_000);
  assert.equal(line.stats().active, 1);
  got();
  (await untimed)();
  assert.equal(line.stats().active, 0);
});

test('Claude busy for 10 s: a call without search is answered by Free AI, listed as busy, counted in /health, and never sent to the container', async t => {
  const {broker, calls, fill, wait, releaseOne} = await setup(t);
  const running = await fill();
  const passed = broker.call('pr', body);
  await wait();
  const answer = await json(await passed);
  assert.equal(answer.engine, 'free-ai'); assert.equal(answer.reply, 'free answer');
  assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}, {engine: 'claude', why: 'busy'}]);
  assert.equal(calls.claudeCli, 3, 'the busy call was never sent to the container');
  const health = await json(await broker.health()), claude = health.chain.find(e => e.name === 'claude');
  assert.equal(claude.busyToday, 1); assert.equal(claude.failedToday, 0); assert.equal(claude.ranOutToday, 0);
  assert.equal(claude.state, 'ready', 'busy is not a fault: Claude is not moved back or marked');
  for (let i = 0; i < 3; i++) releaseOne();
  assert.deepEqual((await Promise.all(running)).map(r => r.status), [200, 200, 200], 'calls already sent to the container finish');
});

test('Claude busy: a search call keeps waiting for Claude and Claude answers; Free AI is never asked', async t => {
  const {broker, calls, fill, wait, releaseOne, drain} = await setup(t);
  const running = await fill();
  const search = broker.call('pr', {...body, search: true}), state = settles(search);
  await wait();
  assert.equal(state.done, false, 'after 10 s the search still waits');
  releaseOne();   // the freed slot goes to the waiting search
  const answer = await json(await drain(search));
  assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  assert.equal(calls.free, 0); assert.equal(calls.claudeCli, 4);
  await drain(Promise.all(running));
});

test('Claude busy and Free AI at its daily cap: the call waits for Claude (no engine to pass on to)', async t => {
  const {broker, calls, storage, fill, releaseOne, drain} = await setup(t);
  const dayKey = new Date(day).toISOString().slice(0, 10);
  await storage.put(`fallback:${dayKey}`, {spent: {claude: 0, 'free-ai': 2_000_000}, held: {claude: 0, 'free-ai': 0}, notified: {}});
  const running = await fill();
  const call = broker.call('pr', body), state = settles(call);
  await quiet(); await quiet();
  assert.equal(broker.claudeGate.stats().waiting.pr, 1);
  t.mock.timers.tick(BUSY_MS); await quiet();
  assert.equal(state.done, false); assert.equal(calls.free, 0);
  releaseOne();
  const answer = await json(await drain(call));
  assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  await drain(Promise.all(running));
});

// Owner of the AI tester (ag), 3 Nov 2026: its judge calls must never go to Free AI. `engine: 'claude', only: true` is how a client says "no Free AI"; no new flag.
test('a call with engine "claude" and only: true waits for a busy Claude and never goes to Free AI', async t => {
  const {broker, calls, fill, releaseOne, drain} = await setup(t, {week: 10});
  const running = await fill();
  const call = broker.call('pr', {...body, engine: 'claude', only: true}), state = settles(call);
  await until(() => broker.claudeGate.stats().waiting.pr === 1);
  t.mock.timers.tick(BUSY_MS); await quiet();
  assert.equal(state.done, false, 'after 10 s it still waits: its chain is Claude alone');
  assert.equal(calls.free, 0);
  releaseOne();
  const answer = await json(await drain(call));
  assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack, undefined); assert.equal(calls.free, 0);
  await drain(Promise.all(running));
});

test('Claude busy and Free AI cannot give a usable answer (invalid JSON for a schema): the call goes back to Claude instead of ending with Free AI\'s refusal', async t => {
  const {broker, calls, fill, wait, releaseOne, drain} = await setup(t, {free: () => ({response: 'not json', usage: {prompt_tokens: 100, completion_tokens: 20}})});
  const running = await fill();
  const call = broker.call('pr', {...body, schema: {type: 'object'}});
  await wait();
  await until(() => calls.free === 1);
  const state = settles(call);
  await quiet();
  assert.equal(state.done, false, 'Free AI\'s refusal is held, not returned');
  releaseOne();
  const answer = await json(await drain(call));
  assert.equal(answer.engine, 'claude');
  assert.deepEqual(answer.fellBack.map(e => `${e.engine}:${e.why}`), ['codex:ran-out', 'free-ai:bad-answer']);
  await drain(Promise.all(running));
});

test('Claude busy and the call has images: Free AI cannot take them, so the call waits for Claude without passing on', async t => {
  const {broker, calls, fill, releaseOne, drain} = await setup(t);
  const running = await fill();
  const call = broker.call('pr', {...body, images: [{name: 'a.png', base64: 'QQ=='}]}), state = settles(call);
  await until(() => broker.claudeGate.stats().waiting.pr === 1);
  t.mock.timers.tick(BUSY_MS); await quiet();
  assert.equal(state.done, false); assert.equal(calls.free, 0, 'Free AI was not tried');
  releaseOne();
  const answer = await json(await drain(call));
  assert.equal(answer.engine, 'claude'); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  await drain(Promise.all(running));
});

test('Claude busy while Codex still has allowance (Claude first, Codex behind it): Codex takes the call', async t => {
  const {broker, calls, fill, wait, releaseOne} = await setup(t, {engine: 'claude', week: 10});
  const running = await fill();
  const call = broker.call('pr', body);
  await wait();
  const answer = await json(await call);
  assert.equal(answer.engine, 'codex'); assert.deepEqual(answer.fellBack, [{engine: 'claude', why: 'busy'}]);
  assert.equal(calls.free, 0);
  for (let i = 0; i < 3; i++) releaseOne();
  await Promise.all(running);
});

test('PR reserve: at 71% of the Codex week scheduled, bench and drift work goes to Free AI, never to Claude, while a PR check still gets Codex', async t => {
  const {broker, calls} = await setup(t, {week: 71, hold: false});
  for (const lane of ['scheduled', 'bench', 'drift']) {
    const answer = await json(await broker.call(lane, body));
    assert.equal(answer.engine, 'free-ai', `${lane} stops at 70%`); assert.deepEqual(answer.fellBack, [{engine: 'codex', why: 'ran-out'}]);
  }
  assert.equal(calls.claudeCli, 0, 'the owner\'s Claude plan was not asked');
  const pr = await json(await broker.call('pr', body));
  assert.equal(pr.engine, 'codex'); assert.equal(pr.fellBack, undefined);
  assert.equal((await json(await broker.health())).limits.usedPercent, 71);
});

test('PR reserve: the broker\'s own share reaching the line stops Claude the same way as the week reading', async t => {
  const {broker, storage, calls} = await setup(t, {week: null, hold: false});
  await storage.put('meter', {...newMeter(day / 1000 + 3600), tokens: {pr: 0, scheduled: 71 * TOKENS_PER_PERCENT, bench: 0, drift: 0}});
  assert.equal((await json(await broker.call('scheduled', body))).engine, 'free-ai');
  assert.equal(calls.claudeCli, 0);
});

test('PR reserve: at the line a search, an image or no Free AI gets the line\'s budget reason (a skip, its items wait for the next run), Claude not asked', async t => {
  const cases = {search: [{search: true}, {}], image: [{images: [{name: 'a.png', base64: 'AAAA'}]}, {}], 'no Free AI configured': [{}, {extra: {FALLBACK_FREE_AI_DAY_USD: '0'}}]};
  for (const [name, [asked, options]] of Object.entries(cases)) await t.test(name, async t => {
    const {broker, calls} = await setup(t, {week: 71, hold: false, ...options});
    const refused = await broker.call('scheduled', {...body, ...asked});
    assert.equal(refused.status, 429); assert.equal((await json(refused)).why, 'budget:week 71% of 70% (scheduled)');
    assert.equal(calls.claudeCli, 0); assert.equal(calls.free, 0);
  });
});

test('PR reserve: at the line Free AI\'s day cap used up is a budget refusal too, Claude not asked', async t => {
  const {broker, storage, calls} = await setup(t, {week: 71, hold: false});
  await storage.put(`fallback:${new Date(day).toISOString().slice(0, 10)}`, {spent: {'free-ai': 2_000_000}, held: {'free-ai': 0}, notified: {}});
  const refused = await broker.call('scheduled', body);
  assert.equal(refused.status, 429); assert.match((await json(refused)).why, /^budget:fallback-day /);
  assert.equal(calls.claudeCli, 0);
});

test('PR reserve: at the line a Free AI that really failed keeps its own reason, a failure the job shows (owner, 4 Nov 2026), Claude not asked', async t => {
  const cases = {'invalid JSON': [{schema: {type: 'object'}}, () => ({response: 'not json', usage: {prompt_tokens: 100, completion_tokens: 20}}), 'fallback:invalid-json'], 'Workers AI down': [{}, () => { throw new Error('down'); }, 'fallback:unavailable']};
  for (const [name, [asked, free, why]] of Object.entries(cases)) await t.test(name, async t => {
    const {broker, calls} = await setup(t, {week: 71, hold: false, free});
    const failed = await broker.call('scheduled', {...body, ...asked});
    assert.equal(failed.status, 503); assert.equal((await json(failed)).why, why);
    assert.equal(calls.claudeCli, 0);
  });
});

test('PR reserve: at the line a lost login still stands when Codex is reached, Free AI does not hide it (review)', async t => {
  const {broker, storage, calls} = await setup(t, {week: 71, hold: false});
  await storage.put('adapt', {demoted: {codex: day + 60_000}});
  await storage.put('lost', true);
  const refused = await broker.call('scheduled', body);
  assert.equal(refused.status, 503); assert.equal((await json(refused)).why, 'login-lost');
  assert.equal(calls.free, 0); assert.equal(calls.claudeCli, 0);
});

test('PR reserve: a demoted Codex does not put Claude in front of scheduled work at the line', async t => {
  const {broker, storage, calls} = await setup(t, {week: 71, hold: false});
  await storage.put('adapt', {demoted: {codex: day + 60_000}});
  assert.equal((await json(await broker.call('scheduled', body))).engine, 'free-ai');
  assert.equal(calls.claudeCli, 0);
});

test('PR reserve: a call that names Claude, or a broker set to Claude first, is a choice and not a spill: Claude answers at the line', async t => {
  for (const asked of [{engine: 'claude'}, {engine: 'claude', only: true}]) {
    const {broker, calls} = await setup(t, {week: 71, hold: false});
    assert.equal((await json(await broker.call('scheduled', {...body, ...asked}))).engine, 'claude');
    assert.equal(calls.claudeCli, 1);
    t.mock.timers.reset(); t.mock.reset();
  }
  const {broker} = await setup(t, {engine: 'claude', week: 71, hold: false});
  assert.equal((await json(await broker.call('scheduled', body))).engine, 'claude');
});

test('PR reserve: below the line Codex at capacity still passes scheduled work to Claude (the line changes only the line)', async t => {
  const {broker} = await setup(t, {week: 69, hold: false});
  const fetcher = broker.containerFetch;
  broker.containerFetch = async (url, init) => String(url).endsWith('/call') ? new Response(JSON.stringify({error: 'codex-failed:1 Selected model is at capacity'}), {status: 502}) : fetcher(url, init);
  assert.equal((await json(await broker.call('scheduled', body))).engine, 'claude');
});

test('PR reserve: a PR check passes on only when the whole week is used up (100%), as before', async t => {
  const {broker} = await setup(t, {week: 100, hold: false});
  const pr = await json(await broker.call('pr', body));
  assert.equal(pr.engine, 'claude'); assert.equal(pr.fellBack[0].why, 'ran-out');
});

test('PR reserve: with no other engine to pass on to, scheduled work at 71% is refused with the reason (a control no engine bypasses)', async t => {
  const {broker} = await setup(t, {week: 71, hold: false, extra: {CLAUDE_CODE_OAUTH_TOKEN: undefined, FALLBACK_FREE_AI_DAY_USD: '0'}});
  const refused = await broker.call('scheduled', body);
  assert.equal(refused.status, 429); assert.equal((await json(refused)).why, 'budget:week 71% of 70% (scheduled)');
});
