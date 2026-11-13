// Guard: money — a stop that everyone hits in silence costs the owner users (they see "Free AI is busy today" and he is not told), and an alert that fails a call costs the call.
// Every cap of the registry (shared/cap-alerts.js): approaching -> one 🟠 card, a refusal (`reached`) -> one 🔴 card, a count past the line alone -> no 🔴 (13 Nov 2026, the drift card), a second crossing in the same period -> nothing, a failed send never fails the caller.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {CAPS, RUNNER_CEILING, capCheck, runnerCheck} from '../../../shared/cap-alerts.js';

const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
// The vars as in force (workers/www/wrangler.toml) plus a Workers AI allowance, so the neuron line is a number; the old bot is the only way out (no switchboard in a unit test).
const env = () => ({WAITLIST: kv(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c', FREE_AI_NEURONS: '10000'});
const posting = sent => async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{"ok":true,"result":{"message_id":1}}'); };
const DAY = new Date('2026-11-13T10:00:00Z'), NEXT_DAY = new Date('2026-11-14T10:00:00Z'), NEXT_MONTH = new Date('2026-12-01T10:00:00Z');

test('every cap: 🟠 once when approaching, 🔴 once when the line refuses, nothing more in the same period, both again in the next one', async () => {
  assert.ok(Object.keys(CAPS).length >= 4, 'positive control: the registry holds the Free AI lines');
  for (const [name, cap] of Object.entries(CAPS)) {
    const e = env(), sent = [], fetcher = posting(sent), line = cap.line(e), near = cap.approach(e);
    assert.ok(Number.isFinite(line) && near > 0 && near < line, `${name}: an approach line below its line (${near} of ${line})`);
    await capCheck(e, name, near - 1, {now: DAY, fetcher});
    assert.equal(sent.length, 0, `${name}: below the approach line, nothing`);
    await capCheck(e, name, near, {now: DAY, fetcher}); await capCheck(e, name, near + 1, {now: DAY, fetcher});
    assert.equal(sent.length, 1, `${name}: one medium card`); assert.match(sent[0], /^🟠/, `${name}: medium is orange\n${sent[0]}`);
    await capCheck(e, name, line, {now: DAY, fetcher}); await capCheck(e, name, line * 2, {now: DAY, fetcher});
    assert.equal(sent.length, 1, `${name}: a count at or past the line refused nothing: no critical card`);
    await capCheck(e, name, line, {now: DAY, fetcher, reached: true}); await capCheck(e, name, null, {now: DAY, fetcher, reached: true});
    assert.equal(sent.length, 2, `${name}: one critical card`); assert.match(sent[1], /^🔴/, `${name}: critical is red\n${sent[1]}`);
    assert.match(sent[1], new RegExp(cap.fix.split(' ')[1]), `${name}: the card says what to raise`);
    await capCheck(e, name, line, {now: cap.period === 'day' ? NEXT_DAY : NEXT_MONTH, fetcher, reached: true});
    assert.equal(sent.length, 3, `${name}: a new period tells again`); assert.match(sent[2], /^🔴/);
  }
});

test('a line that refuses with no approach card yet sends the critical card only', async () => {
  const e = env(), sent = [];
  await capCheck(e, 'free-ai-day', CAPS['free-ai-day'].line(e), {now: DAY, fetcher: posting(sent), reached: true});
  await capCheck(e, 'free-ai-day', CAPS['free-ai-day'].approach(e), {now: DAY, fetcher: posting(sent)});
  assert.deepEqual(sent.map(text => text.slice(0, 2)), ['🔴']);
});

test('a refusal with no counter (the platform says the allowance is spent) is a reached line', async () => {
  const e = env(), sent = [];
  await capCheck(e, 'free-ai-neurons', null, {now: DAY, fetcher: posting(sent), reached: true});
  assert.equal(sent.length, 1); assert.match(sent[0], /^🔴/);
});

test('a failed send never throws and gives the flag back, so the next crossing tries again', async () => {
  for (const fetcher of [async () => { throw new Error('network'); }, async () => new Response('nope', {status: 500})]) {
    const e = env(), line = CAPS['free-ai-day'].line(e);
    await assert.doesNotReject(capCheck(e, 'free-ai-day', line, {now: DAY, fetcher}));
    const sent = [];
    await capCheck(e, 'free-ai-day', line, {now: DAY, fetcher: posting(sent)});
    assert.equal(sent.length, 1, 'tried again after the failed send');
  }
});

test('an unknown cap or a missing store is a no-op, never a throw', async () => {
  await assert.doesNotReject(capCheck(env(), 'no-such-cap', 1, {now: DAY, fetcher: async () => { throw new Error('x'); }}));
  await assert.doesNotReject(capCheck({}, 'free-ai-day', 1e12, {now: DAY, fetcher: async () => { throw new Error('x'); }}));
});

// Why (13 Nov 2026, owner: "I should be alert if we're approaching the max_instnaces" · "80% warning and 100% critical"): the ceiling in the alert is the ceiling Cloudflare holds.
test('both cloud runners: max_instances in wrangler.jsonc is RUNNER_CEILING, and the queue starts exactly that many at most', () => {
  for (const runner of ['hosted-runner', 'ready-runner']) {
    const text = readFileSync(new URL(`../../../workers/${runner}/wrangler.jsonc`, import.meta.url), 'utf8');
    assert.equal(Number(text.match(/"max_instances":\s*(\d+)/)[1]), RUNNER_CEILING, runner);
    const batch = Number(text.match(/"max_batch_size":\s*(\d+)/)[1]), concurrency = Number(text.match(/"max_concurrency":\s*(\d+)/)[1]);
    // Why (Gitar on #635): each message of a batch starts its own container, so the queue can start batch x concurrency at once
    assert.ok(batch * concurrency <= RUNNER_CEILING, `${runner}: the queue starts at most ${batch * concurrency} containers, never past the ceiling ${RUNNER_CEILING}`);
    assert.equal(batch * concurrency, RUNNER_CEILING, `${runner}: and it can fill the ceiling`);
  }
});

test('the 5-minute runner check: nothing at 79 live, 🟠 at 80, 🔴 at 100 (a full runner refuses the next start), each runner on its own', async () => {
  const counts = {'hosted_runs': 0, 'ready_batches': 0};
  const e = {...env(), STATS: {prepare: sql => ({bind: () => ({first: async () => ({n: counts[sql.match(/FROM (\w+)/)[1]]})})})}};
  const sent = [], fetcher = posting(sent);
  counts.hosted_runs = RUNNER_CEILING * 0.8 - 1;
  assert.deepEqual(await runnerCheck(e, {now: DAY, fetcher}), {'find-jobs-runner': 79, 'apply-runner': 0});
  assert.equal(sent.length, 0);
  counts.hosted_runs = RUNNER_CEILING * 0.8;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 1); assert.match(sent[0], /^🟠[^]*Find jobs runner/);
  counts.hosted_runs = RUNNER_CEILING;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 2); assert.match(sent[1], /^🔴[^]*Find jobs runner/);
  counts.ready_batches = RUNNER_CEILING;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.deepEqual(sent.slice(2).map(text => text.slice(0, 2)), ['🔴'], 'the Apply runner tells on its own');
  assert.match(sent[2], /Apply runner/);
  const broken = {...e, STATS: {prepare: () => { throw new Error('D1 down'); }}};
  assert.deepEqual(await runnerCheck(broken, {now: NEXT_DAY, fetcher}), {'find-jobs-runner': null, 'apply-runner': null}, 'a failed count never fails the tick');
});
