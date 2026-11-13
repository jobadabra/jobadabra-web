// Guard: money — CI's AI plans stop CI's judgments at their lines (the Codex week, the Claude week, the Free AI fallback's day, the drift lane); the owner hears 🟠 before and 🔴 at each.
// The broker's cap registry (workers/ai-broker/lib/cap-notes.mjs) on the one cap alert (shared/cap-check.js), through the site's switchboard. Fakes only.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it").
import test from 'node:test';
import assert from 'node:assert/strict';
import {body, harness, switchboard} from './harness.mjs';
import {BROKER_CAPS, brokerCap} from '../../../../workers/ai-broker/lib/cap-notes.mjs';
import {alertOf} from '../../../../shared/notify-registry.js';

const T = Date.parse('2026-11-13T10:00:00Z');
const quiet = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const storageOf = () => { const m = new Map(); return {m, get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };

test('every broker cap: 🟠 once when approaching, 🔴 once when reached, through /ops/notify as a wired registry event', async () => {
  assert.ok(Object.keys(BROKER_CAPS).length >= 4, 'positive control: the four broker lines are registered');
  for (const [name, cap] of Object.entries(BROKER_CAPS)) {
    const sent = [], env = {FALLBACK_FREE_AI_DAY_USD: '2', ...switchboard(sent)}, storage = storageOf(), line = cap.line(env), near = cap.approach(env);
    assert.ok(near > 0 && near < line, `${name}: an approach line below its line`);
    assert.equal(alertOf(cap.event)?.wired, true, `${name}: ${cap.event} is a wired switchboard event`);
    const at = used => brokerCap(storage, env, name, used, {period: 'p1', now: new Date(T)});
    await at(near - 1); await at(near); await at(near); await at(line); await at(line * 2);
    assert.deepEqual(sent.map(note => [note.event, note.state, note.text.slice(0, 2)]), [[cap.event, 'approaching', '🟠'], [cap.event, 'reached', '🔴']], name);
    assert.equal(sent[0].url, 'https://www/ops/notify'); assert.equal(sent[0].html, true);
  }
});

test('the Claude week at 79% of its 90% line: the next call sends one 🟠 card, the call itself unchanged', async t => {
  t.mock.method(Date, 'now', () => T);
  const sent = [], {broker, storage} = harness(undefined, {ENGINE: 'codex', FALLBACK_FREE_AI_DAY_USD: '0', ...switchboard(sent)});
  await storage.put('claude:state', {limits: {sevenDay: {utilization: 0.79, resetsAt: T / 1000 + 3 * 86400}}});
  assert.equal((await broker.call('pr', {...body})).status, 200);
  await broker.call('pr', {...body}); await quiet();
  const week = sent.filter(note => note.event === 'ai-broker-cap');
  assert.equal(week.length, 1); assert.match(week[0].text, /^🟠.*CI's Claude week is approaching its stop: 79% of 90%/);
});

test('the drift lane: its 20th call of 24 today sends 🟠, its 24th sends 🔴, the 25th is refused as before', async t => {
  t.mock.method(Date, 'now', () => T);
  const sent = [], {broker} = harness(undefined, {ENGINE: 'codex', FALLBACK_FREE_AI_DAY_USD: '0', ...switchboard(sent)});
  const drift = () => sent.filter(note => note.event === 'ai-broker-cap').map(note => note.text.slice(0, 2));
  for (let n = 1; n <= 19; n++) await broker.call('drift', {...body});
  await quiet(); assert.deepEqual(drift(), [], '19 of 24 is below 80%');
  await broker.call('drift', {...body}); await quiet();
  assert.deepEqual(drift(), ['🟠']);
  for (let n = 21; n <= 24; n++) await broker.call('drift', {...body});
  await quiet(); assert.deepEqual(drift(), ['🟠', '🔴']);
  assert.equal((await broker.call('drift', {...body})).status, 429);
});
