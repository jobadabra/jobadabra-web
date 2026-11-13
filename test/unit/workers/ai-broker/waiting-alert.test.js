// Telegram alert when CI calls wait too long for a broker slot (owner, 13 Nov 2026: "do we get any telegram alerts if the queeuing is raising too much" · "That means we can lose jobs in the find jobs"; asked via AskUserQuestion: "Waits over 30 s (Recommended)").
// Fakes only: the container is a promise the test releases, Date.now is fixed per step. 12 Nov 23:20-23:55Z the Claude-only benchmark waited p90 180 s and gave up on 92 calls with no note.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {body, success, harness, switchboard, PARALLEL} from './harness.mjs';
import {waiting, served, left} from '../../../../workers/ai-broker/lib/waiting.mjs';
import {alertOf} from '../../../../shared/notify-registry.js';
import {windowOf} from '../../../../shared/streak.js';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const T = Date.parse('2026-11-13T00:00:00Z'), MIN = 60_000;
const BENCH = 'jobadabra-benchmarks/search-round.yml';
const quiet = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const until = async condition => { for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(condition(), 'the state the test waits for never came'); };

// Codex only; every container call is held until the test releases it, so PARALLEL calls fill the one gate and the next ones wait.
function world(t) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  let now = T;
  t.mock.method(Date, 'now', () => now);
  const sent = [], held = [];
  const made = harness(undefined, {...config.vars, ENGINE: 'codex', FALLBACK_FREE_AI_DAY_USD: '0', ...switchboard(sent)});
  made.broker.containerFetch = async () => { await new Promise(resolve => held.push(resolve)); return success(); };
  const waits = () => sent.filter(note => note.event === 'ai-broker-waiting');
  const at = ms => { now = T + ms; };
  const call = (signal = null) => made.broker.call('bench', {...body}, BENCH, '', '', signal);   // each request parses its own body, and the wait is kept per body
  const fill = async () => { const running = Array.from({length: PARALLEL}, () => call()); await until(() => held.length === PARALLEL); return running; };
  const releaseAll = async () => { for (let i = 0; i < 200 && (held.length || made.broker.gate.stats().active); i++) { while (held.length) held.shift()(); await quiet(); } };
  return {...made, sent, held, waits, at, call, fill, releaseAll};
}
/** The fewest starved calls that reach 1 in 10 of a window whose other calls are one full gate: k / (PARALLEL + k) >= WAIT_SHARE (2 at 16 slots, 3 at 24). */
const STARVE = Math.ceil(PARALLEL / 9);

test('the alert is a registry event on Engineering, wired, on by default, "changes only" with its modes', () => {
  const alert = alertOf('ai-broker-waiting');
  assert.deepEqual([alert?.channel, alert?.wired, alert?.on, alert?.mode], ['engineering', true, true, 'changes']);
  assert.deepEqual(alert.modes, ['every', 'changes']);
});

test('calls that wait over 30 s for a slot open one 🔴 as soon as they are 1 in 10 of the window (the window\'s p90 over 30 s), naming the engine, the share, who waited and the slots; 3 more send nothing; a calm window sends one 🟢', async t => {
  const w = world(t);
  const running = await w.fill();
  const waiting = Array.from({length: STARVE + 3}, () => w.call());
  await until(() => w.broker.gate.stats().waiting.bench === STARVE + 3);
  w.at(31_000);
  for (let i = 0; i < STARVE + 3; i++) { w.held.shift()(); await quiet(); }
  await until(() => w.broker.gate.stats().waiting.bench === 0);
  await quiet();
  assert.equal(w.waits().length, 1, 'one note for the streak');
  const [down] = w.waits();
  assert.equal(down.state, 'down'); assert.equal(down.level, 'problem');
  assert.match(down.text, new RegExp(`^🔴 AI broker queue: ${STARVE} of ${PARALLEL + STARVE} Codex calls in 5 min waited over 30 s for a slot`));
  assert.match(down.text, new RegExp(`search-round\\.yml ×${STARVE}`)); assert.match(down.text, new RegExp(`Codex slots: ${PARALLEL}`));
  await w.releaseAll(); await Promise.all([...running, ...waiting]);
  const times = [];
  for (let m = 1; m <= 14; m++) { w.at(m * MIN); const before = w.waits().length; const one = w.call(); await until(() => w.held.length === 1); w.held.shift()(); await one; await quiet(); if (w.waits().length > before) times.push(m); }
  assert.equal(times.length, 1, 'one recovery');
  const up = w.waits().at(-1);
  assert.equal(up.state, 'up'); assert.match(up.text, /^🟢 AI broker queue: Codex calls get a slot within 30 s again/);
});

test('waits under 30 s are no starvation: a full gate whose calls get a slot in 20 s sends nothing', async t => {
  const w = world(t);
  const running = await w.fill();
  const waiting = Array.from({length: 8}, () => w.call());
  await until(() => w.broker.gate.stats().waiting.bench === 8);
  w.at(20_000);
  await w.releaseAll(); await Promise.all([...running, ...waiting]); await quiet();
  assert.deepEqual(w.waits(), []);
});

test('a caller that gives up after waiting over 30 s is a starved call, counted once (not again when its call later gets the slot); one that left within 30 s counts nothing', async t => {
  const w = world(t);
  const running = await w.fill();
  const callers = Array.from({length: STARVE + 1}, () => new AbortController());
  const waiting = callers.map(c => w.call(c.signal));
  const late = w.call();
  await until(() => w.broker.gate.stats().waiting.bench === STARVE + 2);
  w.at(10_000); callers[0].abort();   // left after 10 s: no starvation
  w.at(40_000); for (const c of callers.slice(1)) c.abort();
  await quiet();
  assert.equal(w.waits().length, 1);
  assert.match(w.waits()[0].text, new RegExp(`^🔴 AI broker queue: ${STARVE} of ${PARALLEL + STARVE} Codex calls`)); assert.match(w.waits()[0].text, new RegExp(`caller gave up ×${STARVE}`));
  w.at(80_000);
  await w.releaseAll(); await Promise.all([...running, ...waiting, late]); await quiet();
  const window = windowOf(await w.storage.get('waiting:codex'), T + 80_000);
  assert.deepEqual([window.ok, window.bad], [PARALLEL, STARVE + 1], 'the left calls add nothing when they get their slot; the late call that waited 80 s is the last');
  assert.deepEqual(window.whys, [['caller gave up', STARVE], ['waited', 1]]);
  assert.equal(w.waits().length, 1, 'still one note');
});

test('Gitar on #605: a call whose caller left counts nothing on its later engine turns (Claude busy, then Codex, then Claude again)', () => {
  const asked = {...body};
  waiting(asked, 'claude', T);
  assert.equal(left(asked, T + 40_000)?.gaveUp, true, 'counted once, as given up');
  assert.equal(served(asked, T + 41_000), null);
  waiting(asked, 'codex', T + 41_000);
  assert.equal(served(asked, T + 90_000), null, 'the Codex turn of the abandoned call is no wait');
  const quick = {...body};
  waiting(quick, 'codex', T); served(quick, T + 1000);   // running in the container when its caller leaves
  assert.equal(left(quick, T + 5000), null);
  waiting(quick, 'claude', T + 6000);
  assert.equal(served(quick, T + 60_000), null, 'a later turn after the caller left counts nothing either');
});
