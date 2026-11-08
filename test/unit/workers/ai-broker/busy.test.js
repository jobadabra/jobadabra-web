// A busy Claude passes calls on; every lane uses Codex to 100% and passes on to Claude until its seven-day window reads 90% (owner, 8 Nov 2026: "Actually, codex up to 100%, Claude up to 90%"; replaces the 3 Nov PR reserve).
// Fakes only: the container is a promise the test releases, the clock is node's mock timers (setTimeout) plus a fixed Date.now. No provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, body, success, harness} from './harness.mjs';
import {LANES} from '../../../../workers/ai-broker/lib/lanes.mjs';
import {slots} from '../../../../workers/ai-broker/lib/queue.mjs';
import {BUSY_MS} from '../../../../workers/ai-broker/lib/busy.mjs';
import {newMeter, TOKENS_PER_PERCENT} from '../../../../workers/ai-broker/lib/budget.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}));
const until = async condition => { for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(condition(), 'the state the test waits for never came'); };
const settles = promise => { const state = {done: false}; promise.then(() => { state.done = true; }, () => { state.done = true; }); return state; };
const quiet = () => new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)));

// A broker whose Claude calls stay in the container until the test releases them (`held`), so its 3 slots can be full. Codex's week is used up unless `week` says otherwise.
async function setup(t, {engine = 'codex', week = 100, claude = null, hold = true, free = () => ({response: 'free answer', usage: {prompt_tokens: 100, completion_tokens: 20}}), extra = {}} = {}) {
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
  if (claude !== null) await made.storage.put('claude:state', {limits: {status: 'allowed', fiveHour: null, sevenDay: {utilization: claude / 100, resetsAt: day / 1000 + 3600, status: 'allowed'}}});   // the CLI's own reading, a fraction
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

// Design (8 Nov 2026, owner: "Actually, codex up to 100%, Claude up to 90%"): Codex free -> Codex; Codex out -> Claude while its week reads under 90%; Claude at 90% -> Free AI, or `budget:claude-week` when Free AI cannot take the call. Every lane, one rule (budget.mjs).
const capacity = (broker) => { const fetcher = broker.containerFetch; broker.containerFetch = async (url, init) => String(url).endsWith('/call') ? new Response(JSON.stringify({error: 'codex-failed:1 Selected model is at capacity'}), {status: 502}) : fetcher(url, init); };

test('every lane x (Codex %, Claude %): Codex to 100%, then Claude until its week reads 90%, then Free AI', async t => {
  const states = [[0, 95, 'codex'], [99, 95, 'codex'], [100, null, 'claude'], [100, 50, 'claude'], [100, 89.9, 'claude'], [100, 90, 'free-ai'], [100, 97, 'free-ai']];
  for (const lane of LANES) for (const [week, claude, engine] of states) await t.test(`${lane}: Codex ${week}%, Claude ${claude}% -> ${engine}`, async t => {
    const {broker, calls} = await setup(t, {week, claude, hold: false});
    const answer = await json(await broker.call(lane, body));
    assert.equal(answer.engine, engine); assert.equal(calls.claudeCli, engine === 'claude' ? 1 : 0, 'Claude is asked only inside its line');
  });
});

test('Codex at capacity passes to Claude for every lane under the line, to Free AI at it', async t => {
  for (const lane of LANES) for (const [claude, engine] of [[50, 'claude'], [90, 'free-ai']]) await t.test(`${lane}: Claude ${claude}% -> ${engine}`, async t => {
    const {broker, calls} = await setup(t, {week: 40, claude, hold: false});
    capacity(broker);
    assert.equal((await json(await broker.call(lane, body))).engine, engine); assert.equal(calls.claudeCli, engine === 'claude' ? 1 : 0);
  });
});

test('the broker\'s own share at 100% passes on like the week reading; a stale or malformed Claude reading is not a reason to stop', async t => {
  const own = await setup(t, {week: null, claude: 50, hold: false});
  await own.storage.put('meter', {...newMeter(day / 1000 + 3600), tokens: {pr: 0, scheduled: 101 * TOKENS_PER_PERCENT, bench: 0, drift: 0}});
  assert.equal((await json(await own.broker.call('scheduled', body))).engine, 'claude');
  t.mock.timers.reset(); t.mock.reset();
  for (const [name, week] of Object.entries({'window already reset': {utilization: 0.99, resetsAt: day / 1000 - 1}, 'not a fraction': {utilization: 99, resetsAt: day / 1000 + 3600}, 'no seven-day window': null})) {
    const {broker, storage, calls} = await setup(t, {hold: false});
    await storage.put('claude:state', {limits: {status: 'allowed', sevenDay: week}});
    assert.equal((await json(await broker.call('scheduled', body))).engine, 'claude', name); assert.equal(calls.claudeCli, 1);
    t.mock.timers.reset(); t.mock.reset();
  }
});

test('Claude at 90%: a search, an image or no Free AI gets `budget:claude-week` (a skip, its items wait for the next run), Claude not asked', async t => {
  const cases = {search: [{search: true}, {}], image: [{images: [{name: 'a.png', base64: 'AAAA'}]}, {}], 'no Free AI configured': [{}, {extra: {FALLBACK_FREE_AI_DAY_USD: '0'}}]};
  for (const lane of ['scheduled', 'pr']) for (const [name, [asked, options]] of Object.entries(cases)) await t.test(`${lane}: ${name}`, async t => {
    const {broker, calls} = await setup(t, {claude: 91, hold: false, ...options});
    const refused = await broker.call(lane, {...body, ...asked});
    assert.equal(refused.status, 429); assert.equal((await json(refused)).why, 'budget:claude-week 91% of 90%');
    assert.equal(calls.claudeCli, 0); assert.equal(calls.free, 0);
  });
});

test('Claude at 90% and Codex at capacity: Codex\'s own failure stands for a search Free AI cannot take, and Claude is not asked', async t => {
  const {broker, calls} = await setup(t, {week: 40, claude: 90, hold: false});
  capacity(broker);
  const refused = await broker.call('scheduled', {...body, search: true});
  assert.equal(refused.status, 502, 'Codex\'s own failure stands when it was the engine that failed, as before'); assert.equal(calls.claudeCli, 0);
});

test('Claude at 90%: Free AI\'s day cap used up is a budget refusal too, and a Free AI that really failed keeps its own reason', async t => {
  const capped = await setup(t, {claude: 90, hold: false});
  await capped.storage.put(`fallback:${new Date(day).toISOString().slice(0, 10)}`, {spent: {'free-ai': 2_000_000}, held: {'free-ai': 0}, notified: {}});
  const refused = await capped.broker.call('scheduled', body);
  assert.equal(refused.status, 429); assert.match((await json(refused)).why, /^budget:fallback-day /);
  assert.equal(capped.calls.claudeCli, 0);
  const cases = {'invalid JSON': [{schema: {type: 'object'}}, () => ({response: 'not json', usage: {prompt_tokens: 100, completion_tokens: 20}}), 'fallback:invalid-json'], 'Workers AI down': [{}, () => { throw new Error('down'); }, 'fallback:unavailable']};
  for (const [name, [asked, free, why]] of Object.entries(cases)) await t.test(name, async t => {
    const {broker, calls} = await setup(t, {claude: 90, hold: false, free});
    const failed = await broker.call('scheduled', {...body, ...asked});
    assert.equal(failed.status, 503); assert.equal((await json(failed)).why, why);
    assert.equal(calls.claudeCli, 0);
  });
});

test('Claude at 90%: a lost login still stands when Codex is reached, and a demoted Codex does not put Claude in front', async t => {
  const lost = await setup(t, {claude: 95, hold: false});
  await lost.storage.put('adapt', {demoted: {codex: day + 60_000}});
  await lost.storage.put('lost', true);
  const refused = await lost.broker.call('scheduled', body);
  assert.equal(refused.status, 503); assert.equal((await json(refused)).why, 'login-lost'); assert.equal(lost.calls.free, 0); assert.equal(lost.calls.claudeCli, 0);
  t.mock.timers.reset(); t.mock.reset();
  for (const [claude, engine] of [[95, 'free-ai'], [50, 'claude']]) {
    const {broker, storage, calls} = await setup(t, {claude, hold: false});
    await storage.put('adapt', {demoted: {codex: day + 60_000}});
    assert.equal((await json(await broker.call('scheduled', body))).engine, engine); assert.equal(calls.claudeCli, engine === 'claude' ? 1 : 0);
    t.mock.timers.reset(); t.mock.reset();
  }
});

test('a call that names Claude is held to the line too: answered under 90%, Free AI or the budget refusal at it', async t => {
  const under = await setup(t, {week: 40, claude: 50, hold: false});
  assert.equal((await json(await under.broker.call('scheduled', {...body, engine: 'claude'}))).engine, 'claude');
  t.mock.timers.reset(); t.mock.reset();
  const over = await setup(t, {week: 100, claude: 90, hold: false});
  const named = await json(await over.broker.call('scheduled', {...body, engine: 'claude'}));
  assert.equal(named.engine, 'free-ai'); assert.equal(over.calls.claudeCli, 0);
  const strict = await over.broker.call('scheduled', {...body, engine: 'claude', only: true});
  assert.equal(strict.status, 429); assert.equal((await json(strict)).why, 'budget:claude-week 90% of 90%');
  t.mock.timers.reset(); t.mock.reset();
  const first = await setup(t, {engine: 'claude', week: 100, claude: 95, hold: false});
  assert.equal((await json(await first.broker.call('scheduled', body))).engine, 'free-ai'); assert.equal(first.calls.claudeCli, 0);
});

test('with no other engine to pass on to, Codex used up and Claude at 95% is refused with the Claude reason', async t => {
  const {broker} = await setup(t, {week: 100, claude: 95, hold: false, extra: {FALLBACK_FREE_AI_DAY_USD: '0'}});
  const refused = await broker.call('scheduled', body);
  assert.equal(refused.status, 429); assert.equal((await json(refused)).why, 'budget:claude-week 95% of 90%');
});

test('/health says each lane\'s lines: the Codex week per lane, the day caps and the Claude week', async t => {
  const {broker} = await setup(t, {hold: false});
  const {lines} = await json(await broker.health());
  assert.deepEqual(lines.week, {pr: 100, byhand: 100, scheduled: 100, bench: 100, drift: 100}); assert.deepEqual(lines.daily, {drift: 24, byhand: 800}); assert.equal(lines.claude, 90);
});
