// Guard: money — a stop that everyone hits in silence costs the owner users (they see "Free AI is busy today" and he is not told), and an alert that fails a call costs the call.
// Every cap of the registry (shared/cap-alerts.js): approaching -> one 🟠 card, reached -> one 🔴 card, a second crossing in the same period -> nothing, a failed send never fails the caller.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CAPS, capCheck} from '../../../shared/cap-alerts.js';

const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
// The vars as in force (workers/www/wrangler.toml) plus a Workers AI allowance, so the neuron line is a number; the old bot is the only way out (no switchboard in a unit test).
const env = () => ({WAITLIST: kv(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c', FREE_AI_NEURONS: '10000'});
const posting = sent => async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{"ok":true,"result":{"message_id":1}}'); };
const DAY = new Date('2026-11-13T10:00:00Z'), NEXT_DAY = new Date('2026-11-14T10:00:00Z'), NEXT_MONTH = new Date('2026-12-01T10:00:00Z');

test('every cap: 🟠 once when approaching, 🔴 once when reached, nothing more in the same period, both again in the next one', async () => {
  assert.ok(Object.keys(CAPS).length >= 4, 'positive control: the registry holds the Free AI lines');
  for (const [name, cap] of Object.entries(CAPS)) {
    const e = env(), sent = [], fetcher = posting(sent), line = cap.line(e), near = cap.approach(e);
    assert.ok(Number.isFinite(line) && near > 0 && near < line, `${name}: an approach line below its line (${near} of ${line})`);
    await capCheck(e, name, near - 1, {now: DAY, fetcher});
    assert.equal(sent.length, 0, `${name}: below the approach line, nothing`);
    await capCheck(e, name, near, {now: DAY, fetcher}); await capCheck(e, name, near + 1, {now: DAY, fetcher});
    assert.equal(sent.length, 1, `${name}: one medium card`); assert.match(sent[0], /^🟠/, `${name}: medium is orange\n${sent[0]}`);
    await capCheck(e, name, line, {now: DAY, fetcher}); await capCheck(e, name, line * 2, {now: DAY, fetcher});
    assert.equal(sent.length, 2, `${name}: one critical card`); assert.match(sent[1], /^🔴/, `${name}: critical is red\n${sent[1]}`);
    assert.match(sent[1], new RegExp(cap.fix.split(' ')[1]), `${name}: the card says what to raise`);
    await capCheck(e, name, line, {now: cap.period === 'day' ? NEXT_DAY : NEXT_MONTH, fetcher});
    assert.equal(sent.length, 3, `${name}: a new period tells again`); assert.match(sent[2], /^🔴/);
  }
});

test('a line reached with no approach card yet sends the critical card only', async () => {
  const e = env(), sent = [];
  await capCheck(e, 'free-ai-day', CAPS['free-ai-day'].line(e), {now: DAY, fetcher: posting(sent)});
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
