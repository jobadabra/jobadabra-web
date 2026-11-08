// Guards "one Codex conversation per persona run" ([bf], 5 Nov 2026, spec docs/superpowers/specs/2026-11-05-broker-codex-resume-design.md): who may keep one, what a resumed turn costs, and that nobody else's counting moved.
// The numbers are the ones measured on 5 Nov 2026 with Codex 0.162.1 on five resumed "pong" turns (16,543 / 33,121 / 49,734 / 69,834 / 92,581 are the thread's RUNNING totals the CLI printed; the thread file's own per-turn figures are in TURNS).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {day, body, harness, entry} from './harness.mjs';
import {buildArgs} from '../../../../workers/ai-broker/lib/args.mjs';
import {weeklyWindow} from '../../../../workers/ai-broker/container/weekly.mjs';
import {readTurn, threadTable, turnUsage, IDLE_MS as THREAD_IDLE_MS, MAX_THREADS} from '../../../../workers/ai-broker/container/threads.mjs';
import {kindOf} from '../../../../workers/ai-broker/container/kinds.mjs';
import {IDLE_MS, TURN_CAP, countedOf, keyedLock, markGap, planOf, sessionKey, sessionKeyOf, settle} from '../../../../workers/ai-broker/lib/sessions.mjs';

const ref = (repository, file) => `${repository}/.github/workflows/${file}@refs/heads/main`;
const PERSONA = {repository: 'jobadabra/jobadabra', run_id: '987', run_attempt: '1', job_workflow_ref: ref('jobadabra/jobadabra', 'ai-user-agents.yml')};
const KEY = 'jobadabra/jobadabra#987.1#agent-g1';
const TOTALS = [[16543, 0, 18], [33121, 16384, 36], [49734, 32768, 54], [69834, 49152, 72], [92581, 69120, 90]];   // the CLI's running totals: input, cached, output
const TURNS = [{input: 16543, cached: 0, output: 18}, {input: 16578, cached: 16384, output: 18}, {input: 16613, cached: 16384, output: 18}, {input: 20100, cached: 16384, output: 18}, {input: 22747, cached: 19968, output: 18}];
const COUNTED = [16561, 212, 247, 3734, 2797];   // input - cached + output per turn

test('only the AI user agent workflow may keep a conversation, and the key comes from the verified token', () => {
  assert.equal(sessionKeyOf(PERSONA, 'agent-g1'), KEY);
  assert.equal(sessionKeyOf({...PERSONA, run_attempt: '2'}, 'agent-g1'), 'jobadabra/jobadabra#987.2#agent-g1', 'a rerun is another run');
  assert.equal(sessionKeyOf({...PERSONA, repository: 'GarryOne/jobadabra'}, 'agent-g1'), 'GarryOne/jobadabra#987.1#agent-g1');
  for (const file of ['ui-findings.yml', 'search-personas.yml', 'ai-fixer.yml', 'e2e.yml', 'daily-digest.yml']) assert.equal(sessionKeyOf({...PERSONA, job_workflow_ref: ref('jobadabra/jobadabra', file)}, 'agent-g1'), '', `${file} keeps fresh calls`);
  assert.equal(sessionKeyOf({...PERSONA, job_workflow_ref: ref('jobadabra/jobadabra-lab', 'ai-user-agents.yml')}, 'agent-g1'), '', 'the same file name in another repo is another workflow');
  for (const id of [undefined, null, 5, '', 'Agent', 'a b', 'x'.repeat(41), '../x', 'a#b']) assert.equal(sessionKeyOf(PERSONA, id), '', `id ${JSON.stringify(id)}`);
  for (const claims of [{...PERSONA, run_id: undefined}, {...PERSONA, run_id: 'abc'}, {...PERSONA, run_attempt: '1.5'}, {}, null]) assert.equal(sessionKeyOf(claims, 'agent-g1'), '');
  assert.equal(sessionKey(KEY), KEY); assert.equal(sessionKey('smuggled'), ''); assert.equal(sessionKey(null), ''); assert.equal(sessionKey(`${KEY}\nx`), '');
});

test('what the next call of a conversation does: open, resume, or replace it from the full prompt', () => {
  const record = {tier: 'mid', turns: 3, openedAt: 0, lastUsed: 1000}, now = 1000 + 1000;
  assert.deepEqual(planOf(undefined, {now, tier: 'mid', delta: 'x'}), {expect: 'none'});
  assert.deepEqual(planOf(record, {now, tier: 'mid', delta: 'x'}), {expect: 'warm'});
  assert.deepEqual(planOf(record, {now, tier: 'large', delta: 'x'}), {expect: 'none', restart: 'tier'});
  assert.deepEqual(planOf(record, {now: 1000 + IDLE_MS + 1, tier: 'mid', delta: 'x'}), {expect: 'none', restart: 'idle'});
  assert.deepEqual(planOf(record, {now: 1000 + IDLE_MS, tier: 'mid', delta: 'x'}), {expect: 'warm'}, 'exactly 5 minutes is still warm');
  assert.deepEqual(planOf({...record, turns: TURN_CAP}, {now, tier: 'mid', delta: 'x'}), {expect: 'none', restart: 'turn-cap'});
  for (const delta of [undefined, '', 5, null]) assert.deepEqual(planOf(record, {now, tier: 'mid', delta}), {expect: 'none', restart: 'no-delta'});
  assert.deepEqual(planOf(markGap({[KEY]: record}, KEY)[KEY], {now, tier: 'mid', delta: 'x'}), {expect: 'none', restart: 'gap'}, 'a turn Codex did not answer leaves a hole');
});

test('records: a turn opens, grows, restarts or ends a conversation; old and surplus ones are forgotten', () => {
  let records = settle({}, KEY, {now: 10, tier: 'mid', mode: 'opened'});
  assert.deepEqual(records[KEY], {tier: 'mid', turns: 1, openedAt: 10, lastUsed: 10});
  records = settle(records, KEY, {now: 20, tier: 'mid', mode: 'resumed'});
  assert.deepEqual(records[KEY], {tier: 'mid', turns: 2, openedAt: 10, lastUsed: 20});
  records = settle(records, KEY, {now: 30, tier: 'mid', mode: 'restarted'});
  assert.deepEqual(records[KEY], {tier: 'mid', turns: 1, openedAt: 30, lastUsed: 30});
  assert.deepEqual(settle(records, KEY, {now: 40, tier: 'mid', mode: 'ended'}), {});
  const hour = 60 * 60_000;
  assert.deepEqual(Object.keys(settle({old: {tier: 'mid', turns: 1, openedAt: 0, lastUsed: 0}}, KEY, {now: hour + 1, tier: 'mid', mode: 'opened'})), [KEY], 'an hour idle is forgotten');
  let many = {}; for (let i = 0; i < 60; i++) many = settle(many, `k${i}`, {now: 1000 + i, tier: 'mid', mode: 'opened'});
  assert.equal(Object.keys(many).length, 50); assert.ok(many.k59 && !many.k0, 'the longest idle go first');
});

test('a conversation call counts what it added; every other call counts in full', () => {
  assert.equal(countedOf({input: 16578, cached: 16384, output: 18}, true), 212);
  assert.equal(countedOf({input: 16578, cached: 16384, output: 18}, false), 16596, 'a plain call ignores cached, as before');
  assert.equal(countedOf({input: 100, output: 5}, true), 105, 'no cached figure (an old container) counts everything');
  assert.equal(countedOf({input: 10, cached: 50, output: 5}, true), 5, 'never negative');
  assert.equal(countedOf(undefined, true), 0);
});

test('one turn at a time per key, other keys never wait', async () => {
  const lock = keyedLock(), log = [];
  const turn = async (key, name, ms) => { const release = await lock(key); log.push(`${name}+`); await new Promise(resolve => setTimeout(resolve, ms)); log.push(`${name}-`); release(); };
  await Promise.all([turn('a', 'a1', 15), turn('a', 'a2', 1), turn('b', 'b1', 1)]);
  assert.deepEqual(log.filter(line => line.startsWith('a')), ['a1+', 'a1-', 'a2+', 'a2-']);
  assert.ok(log.indexOf('b1-') < log.indexOf('a1-'), 'key b ran while key a was busy');
});

test('the trap: five resumed turns whose running totals reach 92,581 are counted as 16,561 + 212 + 247 + 3,734 + 2,797, never 92k', () => {
  const stream = total => `{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":${total[0]},"cached_input_tokens":${total[1]},"output_tokens":${total[2]}}}\n`;
  let before = null;
  const turns = TOTALS.map(total => { const read = readTurn(stream(total)); assert.equal(read.thread, 't1'); const turn = turnUsage(read.usage, before); before = read.usage; return turn; });
  assert.deepEqual(turns, TURNS);
  assert.deepEqual(turns.map(turn => countedOf(turn, true)), COUNTED);
  assert.equal(COUNTED.reduce((a, b) => a + b), 23551);
  assert.deepEqual(readTurn('not json\n{"usage":{"input_tokens":2,"output_tokens":3}}'), {thread: null, usage: {input: 2, cached: 0, output: 3}}, 'the old reader took any usage object');
  assert.deepEqual(readTurn(''), {thread: null, usage: null});
  assert.deepEqual(turnUsage({input: 5, cached: 0, output: 1}, {input: 9, cached: 2, output: 1}), {input: 0, cached: 0, output: 0}, 'never negative');
});

test('the container keeps at most 8 conversations, drops the idle ones, and never one that is in the middle of a turn', () => {
  let clock = 0; const table = threadTable(() => clock);
  for (let i = 0; i < MAX_THREADS; i++) { clock = i; assert.deepEqual(table.set(`k${i}`, {thread: `t${i}`, dir: `d${i}`}), []); }
  clock = 100; table.touch('k0');
  const evicted = table.set('k8', {thread: 't8', dir: 'd8'});
  assert.deepEqual(evicted.map(entry => entry.thread), ['t1'], 'the longest idle goes, not the one just used');
  table.get('k2').busy = true;   // a turn is running on k2
  clock = 100 + THREAD_IDLE_MS + 1;
  const swept = table.sweep();
  assert.equal(swept.length, MAX_THREADS - 1, 'every idle one but the busy one');
  assert.ok(table.get('k2') && !swept.some(entry => entry.thread === 't2'), 'a slow turn is not swept from under itself');
  table.get('k2').busy = false;
  const busy = threadTable(() => 0);
  for (let i = 0; i < MAX_THREADS; i++) { busy.set(`b${i}`, {thread: `t${i}`, dir: `d${i}`}); busy.get(`b${i}`).busy = true; }
  assert.deepEqual(busy.set('b8', {thread: 't8', dir: 'd8'}), [], 'nothing idle to drop: the table is briefly over its size, no running turn is evicted');
  assert.equal(busy.size(), MAX_THREADS + 1);
});

// The call server loaded offline with a stand-in Codex that prints the CLI's running totals (TOTALS) turn after turn on one thread.
async function serverWithCodex(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-resume-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const seen = [], state = {turn: 0, fail: null};
  let handler;
  const spawn = (binary, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    if (args[0] === 'app-server') {   // the week figure the server reads after a call: answered at once
      child.stdin = {write(line) { const {id} = JSON.parse(line); if (id) queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({id, result: {rateLimits: {}}})}\n`)); }};
      return child;
    }
    child.stdin = Object.assign(new EventEmitter(), {end(input) {
      seen.push({args, input, cwd: options.cwd});
      if (state.fail) { queueMicrotask(() => { child.stderr.emit('data', state.fail); child.emit('close', 1); }); return; }
      const total = TOTALS[Math.min(state.turn++, 4)], resumed = args[1] === 'resume';
      fs.writeFileSync(path.join(options.cwd, 'out.txt'), `{"answer":"turn ${state.turn}"}`);
      const thread = resumed ? args[2] : `thread-${seen.length}`;
      queueMicrotask(() => { child.stdout.emit('data', `{"type":"thread.started","thread_id":"${thread}"}\n{"type":"turn.completed","usage":{"input_tokens":${total[0]},"cached_input_tokens":${total[1]},"output_tokens":${total[2]}}}\n`); child.emit('close', 0); });
    }});
    return child;
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../../../workers/ai-broker/container/server.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), {
    http: {createServer(fn) { handler = fn; return {listen() {}}; }},
    fs, os: {tmpdir: () => dir}, path, spawn, buildArgs, weeklyWindow, readTurn, threadTable, turnUsage, kindOf, Buffer, setTimeout, clearTimeout, setInterval,
    process: {on() {}, env: {CODEX_HOME: path.join(dir, 'home'), HOME: dir, PATH: ''}},
  });
  const post = payload => new Promise(resolve => {
    const request = new EventEmitter(); request.url = '/call'; request.method = 'POST';
    handler(request, {setHeader() {}, once() {}, end(text) { resolve({status: this.statusCode, body: JSON.parse(text)}); }});
    request.emit('data', Buffer.from(JSON.stringify(payload))); request.emit('end');
  });
  return {dir, seen, state, post};
}

test('the container resumes one conversation, reports each turn\'s own tokens, and deletes it when told it was the last', async t => {
  const {dir, seen, post} = await serverWithCodex(t);
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await post({prompt: `FULL ${i}`, model: 'gpt-6.1-sol', schema: {type: 'object'}, session: {key: KEY, expect: i ? 'warm' : 'none', delta: i ? `NEW ${i}` : '', end: i === 4}}));
  assert.deepEqual(out.map(r => r.status), [200, 200, 200, 200, 200]);
  assert.deepEqual(out.map(r => r.body.tokens), TURNS, 'each turn is the difference of the running totals');
  assert.deepEqual(out.map(r => r.body.session.mode), ['opened', 'resumed', 'resumed', 'resumed', 'ended']);
  assert.ok(!seen[0].args.includes('--ephemeral') && seen[0].args.includes('-s') && seen[0].args[0] === 'exec' && seen[0].args[1] !== 'resume', 'the first turn opens a conversation that stays on disk');
  assert.deepEqual(seen.map(call => call.input), ['FULL 0', 'NEW 1', 'NEW 2', 'NEW 3', 'NEW 4'], 'only the new turn travels once it is warm');
  for (const call of seen.slice(1)) { assert.deepEqual(call.args.slice(0, 3), ['exec', 'resume', 'thread-1']); assert.ok(call.args.includes('sandbox_mode="read-only"') && !call.args.includes('-s') && call.args.at(-1) === '-' && !call.args.includes('--')); }
  assert.equal(new Set(seen.map(call => call.cwd)).size, 1, 'one folder for the whole conversation');
  assert.deepEqual(fs.readdirSync(dir), ['home'], 'the last turn deleted the folder');
});

test('a conversation the container no longer has restarts from the full prompt and says why; a tier change and a missing delta do too', async t => {
  const {seen, post} = await serverWithCodex(t);
  let reply = await post({prompt: 'FULL', model: 'gpt-6.1-sol', session: {key: KEY, expect: 'warm', delta: 'NEW'}});
  assert.deepEqual(reply.body.session, {mode: 'restarted', reason: 'lost'}, 'a sleep or a redeploy emptied the container');
  assert.equal(seen[0].input, 'FULL'); assert.notEqual(seen[0].args[1], 'resume');
  reply = await post({prompt: 'FULL 2', model: 'gpt-6-astra', session: {key: KEY, expect: 'warm', delta: 'NEW'}});
  assert.deepEqual(reply.body.session, {mode: 'restarted', reason: 'tier'});
  reply = await post({prompt: 'FULL 3', model: 'gpt-6-astra', session: {key: KEY, expect: 'warm', delta: ''}});
  assert.deepEqual(reply.body.session, {mode: 'restarted', reason: 'no-delta'});
  reply = await post({prompt: 'FULL 4', model: 'gpt-6-astra', session: {key: KEY, expect: 'none', restart: 'idle'}});
  assert.deepEqual(reply.body.session, {mode: 'restarted', reason: 'idle'}, 'the Worker\'s word is kept');
  assert.equal(seen.at(-1).input, 'FULL 4');
});

test('a failed turn deletes its conversation, whatever the cause, so the next call starts again; no folder or entry is left behind', async t => {
  const {dir, seen, state, post} = await serverWithCodex(t);
  const turn = (extra = {}) => post({prompt: 'FULL', model: 'gpt-6.1-sol', session: {key: KEY, expect: 'warm', delta: 'NEW'}, ...extra});
  await post({prompt: 'FULL', model: 'gpt-6.1-sol', session: {key: KEY, expect: 'none'}});
  for (const failure of ['Selected model is at capacity. Please try a different model.', 'boom']) {
    state.fail = failure;
    assert.equal((await turn()).status, 500, failure);
    state.fail = null;
    assert.deepEqual((await turn()).body.session, {mode: 'restarted', reason: 'lost'}, `after "${failure.slice(0, 20)}" the next call restarts from the full prompt`);
  }
  await post({prompt: 'FULL', model: 'gpt-6.1-sol', session: {key: KEY, expect: 'warm', delta: 'NEW'}, images: [{name: 'a.png'}]});   // no image data: the turn throws before Codex runs
  assert.deepEqual((await turn()).body.session, {mode: 'restarted', reason: 'lost'}, 'a turn that threw before Codex ran is not trusted either');
  state.fail = 'boom';
  await post({prompt: 'FULL', model: 'gpt-6.1-sol', session: {key: 'other#1.1#x', expect: 'none'}});   // a conversation that never opened
  assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('thread-')).length, 1, 'only the one live conversation is on disk');
  assert.ok(seen.length >= 6);
});

test('a call with no session is what it always was: an ephemeral thread, tokens as printed, nothing kept', async t => {
  const {dir, seen, post} = await serverWithCodex(t);
  const reply = await post({prompt: 'ONE', model: 'gpt-6.1-sol'});
  assert.deepEqual(reply.body.tokens, {input: 16543, cached: 0, output: 18});
  assert.equal(reply.body.session, undefined);
  assert.ok(seen[0].args.includes('--ephemeral') && seen[0].args.includes('-s'));
  assert.deepEqual(fs.readdirSync(dir), ['home']);
});

// The Durable Object with a stand-in container that answers like the real one: per-turn tokens and the conversation's mode.
function conversation(broker) {
  const sent = [], answers = TURNS.map(turn => ({...turn})); let n = 0, live = 0, peak = 0, mode = null;
  broker.containerFetch = async (url, init) => {
    const payload = JSON.parse(init.body); sent.push(payload); live++; peak = Math.max(peak, live);
    await new Promise(resolve => setTimeout(resolve, 2)); live--;
    const turn = answers[Math.min(n++, 4)], session = payload.session && {mode: mode || (payload.session.end ? 'ended' : payload.session.expect === 'warm' ? 'resumed' : payload.session.restart ? 'restarted' : 'opened')};
    return new Response(JSON.stringify({reply: 'ok', tokens: turn, ms: 1, ...(session ? {session} : {})}));
  };
  return {sent, peak: () => peak, force: value => { mode = value; }};
}
const ask = (broker, extra = {}, session = KEY, workflow = 'jobadabra/ai-user-agents.yml') => broker.call('scheduled', {...body, tier: 'mid', ...extra}, workflow, '', session);

test('the Durable Object counts five resumed turns as 23,551 tokens in the week, never 92k, and each reply says what it counted', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness(), seen = conversation(broker);
  const replies = [];
  for (let i = 0; i < 5; i++) replies.push(await (await ask(broker, {prompt: `FULL ${i}`, ...(i ? {delta: `NEW ${i}`} : {})})).json());
  assert.deepEqual(replies.map(r => r.tokens.counted), COUNTED);
  assert.deepEqual(replies.map(r => r.tokens.input), TURNS.map(turn => turn.input), 'input stays the turn\'s own, so a caller never sees the thread total');
  assert.equal((await storage.get('meter')).tokens.scheduled, 23551);
  assert.deepEqual(replies.map(r => r.session.mode), ['opened', 'resumed', 'resumed', 'resumed', 'resumed']);
  assert.deepEqual((await storage.get('sessions'))[KEY], {tier: 'mid', turns: 5, openedAt: day, lastUsed: day});
  assert.deepEqual(seen.sent[0].session, {key: KEY, expect: 'none', delta: '', end: false});
  assert.deepEqual(seen.sent[1].session, {key: KEY, expect: 'warm', delta: 'NEW 1', end: false});
  for (const payload of seen.sent) { assert.equal(payload.delta, undefined); assert.equal(payload.endSession, undefined); assert.equal(typeof payload.prompt, 'string', 'the full prompt always travels, for a restart'); }
  const tally = (await (await broker.health()).json()).tally.days['2026-10-30']['jobadabra/ai-user-agents.yml'];
  assert.equal(tally.tokens, 23551, 'the workflow row shows what the meter counted');
});

test('only a persona call keeps a conversation: every other caller\'s call stays fresh and is counted in full', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness();
  const sent = [];
  broker.containerFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({reply: 'ok', tokens: {input: 100, cached: 90, output: 3}, ms: 1})); };
  const reply = await (await ask(broker, {session: 'agent-g1', delta: 'NEW', endSession: true}, '', 'jobadabra/ui-findings.yml')).json();
  assert.deepEqual(sent[0].session, undefined); assert.equal(sent[0].delta, undefined); assert.equal(sent[0].endSession, undefined, 'the caller\'s words never reach the container');
  assert.deepEqual(reply.tokens, {input: 100, cached: 90, output: 3, counted: 103}, 'cached is shown, not discounted');
  assert.equal(reply.session, undefined);
  assert.equal((await storage.get('meter')).tokens.scheduled, 103, 'the week meter counts input plus output, as before');
  assert.equal(await storage.get('sessions'), undefined, 'no record for a plain call');
});

test('a conversation restarts from the full prompt when it is idle, full, of another tier, or called without a new turn', async t => {
  let clock = day; t.mock.method(Date, 'now', () => clock);
  const {broker, storage} = harness(), seen = conversation(broker);
  await ask(broker, {prompt: 'A'}); await ask(broker, {prompt: 'B', delta: 'b'});
  clock += IDLE_MS + 1;
  await ask(broker, {prompt: 'C', delta: 'c'});
  assert.deepEqual(seen.sent.at(-1).session, {key: KEY, expect: 'none', restart: 'idle', delta: 'c', end: false});
  assert.equal((await storage.get('sessions'))[KEY].turns, 1, 'the replacement is a conversation of one turn');
  await ask(broker, {prompt: 'D'});
  assert.equal(seen.sent.at(-1).session.restart, 'no-delta');
  await ask(broker, {prompt: 'E', delta: 'e', tier: 'large'});
  assert.equal(seen.sent.at(-1).session.restart, 'tier');
  await storage.put('sessions', {[KEY]: {tier: 'mid', turns: TURN_CAP, openedAt: clock, lastUsed: clock}});
  await ask(broker, {prompt: 'F', delta: 'f'});
  assert.equal(seen.sent.at(-1).session.restart, 'turn-cap');
});

test('a failed turn leaves the record alone, an ended one deletes it, and one conversation never runs two turns at once', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness(), seen = conversation(broker);
  await ask(broker, {prompt: 'A'});
  const good = broker.containerFetch;
  broker.containerFetch = async () => new Response(JSON.stringify({error: 'codex-failed:1 boom'}), {status: 500});
  assert.equal((await ask(broker, {prompt: 'B', delta: 'b'})).status, 502);
  assert.deepEqual({...(await storage.get('sessions'))[KEY]}.turns, 1, 'a failed turn is not a turn');
  assert.equal((await storage.get('sessions'))[KEY].stale, true, 'and it leaves a hole: the next call restarts from the full prompt');
  broker.containerFetch = good;
  await Promise.all([ask(broker, {prompt: 'C', delta: 'c'}), ask(broker, {prompt: 'D', delta: 'd'})]);
  assert.equal(seen.peak(), 1, 'the second turn waited for the first');
  assert.equal((await storage.get('sessions'))[KEY].turns, 2, 'C restarted the conversation (gap), D resumed it');
  await Promise.all([ask(broker, {prompt: 'E', delta: 'e'}, `${KEY.slice(0, -2)}g2`), ask(broker, {prompt: 'F', delta: 'f'})]);
  assert.equal(seen.peak(), 2, 'two goals of one run do not wait for each other');
  await ask(broker, {prompt: 'G', delta: 'g', endSession: true});
  assert.equal(seen.sent.at(-1).session.end, true);
  assert.equal((await storage.get('sessions'))[KEY], undefined, 'the last turn deleted the record');
});

test('a turn another engine answered leaves a hole: the next call restarts from the full prompt; one Codex answered does not', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness(), seen = conversation(broker);
  await ask(broker, {prompt: 'A'}); await ask(broker, {prompt: 'B', delta: 'b'});
  const codex = broker.containerFetch;
  broker.containerFetch = async () => new Response(JSON.stringify({reply: 'from claude', tokens: {input: 5, output: 5}, ms: 1, engine: 'claude'}));
  broker.answer = async () => new Response(JSON.stringify({reply: 'from claude', engine: 'claude', tokens: {input: 5, output: 5}}));
  await ask(broker, {prompt: 'C', delta: 'c'});
  assert.equal((await storage.get('sessions'))[KEY].stale, true);
  delete broker.answer; broker.containerFetch = codex;
  await ask(broker, {prompt: 'D', delta: 'd'});
  assert.deepEqual(seen.sent.at(-1).session, {key: KEY, expect: 'none', restart: 'gap', delta: 'd', end: false});
  assert.equal((await storage.get('sessions'))[KEY].stale, undefined, 'the replacement is a clean conversation');
});

test('the idle clock starts when a turn ends, and the container only gets what the Worker chose to send', async t => {
  let clock = day; t.mock.method(Date, 'now', () => clock);
  const {broker, storage} = harness(), seen = conversation(broker), slow = broker.containerFetch;
  broker.containerFetch = async (url, init) => { clock += 4 * 60_000; return slow(url, init); };   // a turn that takes 4 minutes
  await ask(broker, {prompt: 'A'});
  assert.equal((await storage.get('sessions'))[KEY].lastUsed, clock, 'stamped when the turn ended, not when it started');
  clock += 90_000;
  await ask(broker, {prompt: 'B', delta: 'b'});
  assert.equal(seen.sent.at(-1).session.expect, 'warm', '90 seconds after the answer is warm, not idle');
  await ask(broker, {prompt: 'C', delta: 'c', schema: {type: 'object'}, tier: 'mid', engine: 'codex', only: true, smuggled: 'x', tools: ['x']});
  assert.deepEqual(Object.keys(seen.sent.at(-1)).sort(), ['model', 'prompt', 'schema', 'session'], 'an allow-list: nothing else of the caller\'s body reaches the container');
});

test('the Worker builds the conversation key from the verified token: persona runs get one, nobody else does, and a caller-sent header is never forwarded', async t => {
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const jwk = {...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1'}, enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenFor = async claims => { const head = `${enc({alg: 'RS256', kid: 'k1'})}.${enc({iss: 'https://token.actions.githubusercontent.com', aud: 'jobadabra-ai-broker', event_name: 'schedule', exp: Math.floor(Date.now() / 1000) + 600, ...claims})}`; return `${head}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head))).toString('base64url')}`; };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({keys: [jwk]})));
  const seen = [], env = {BROKER: {fetch: async request => { seen.push(request.headers.get('x-session')); return new Response('{}'); }}};
  const post = async (claims, payload, headers = {}) => entry.fetch(new Request('https://broker/call', {method: 'POST', headers: {authorization: `Bearer ${await tokenFor(claims)}`, ...headers}, body: typeof payload === 'string' ? payload : JSON.stringify(payload)}), env);
  await post(PERSONA, {...body, session: 'agent-g1'});
  await post({...PERSONA, job_workflow_ref: ref('jobadabra/jobadabra', 'ui-findings.yml')}, {...body, session: 'agent-g1'}, {'x-session': KEY});
  await post(PERSONA, {...body, session: 'Bad Id'}, {'x-session': KEY});
  await post(PERSONA, '{not json', {'x-session': KEY});
  await post(PERSONA, body, {'x-session': KEY});
  assert.deepEqual(seen, [KEY, '', '', '', ''], 'null would mean a caller header got through; every refusal is the empty string');
});
