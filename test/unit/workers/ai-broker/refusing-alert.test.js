// Telegram alert when the AI broker refuses or fails its callers' calls (owner, 12 Nov 2026, ~20:45Z: "Do I get alerts if the ai-broker starts to refuse AI calls?" · "I should get alerts (medium/high criticalitiy)" · "For now let's keep it like Telegram").
// Fakes only. Every broker caller is a GitHub Actions job (README: "callers are CI jobs only"), so "who is affected" is the workflow tag the broker already records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {body, success, harness, containerError, switchboard} from './harness.mjs';
import {alertOf} from '../../../../shared/notify-registry.js';
import {newMeter} from '../../../../workers/ai-broker/lib/budget.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const T = Date.parse('2026-11-12T12:00:00Z'), MIN = 60_000;
const SCOUT = 'jobadabra-lab/central-scout.yml', DRIFT = 'jobadabra/ai-answer-drift.yml';
const CUT = 'Error proxying request to container: The container just disconnected';

// Codex is the only engine (no Claude token, Free AI cap 0), so a failed Codex call ends the call. The drift lane's daily cap is spent: a call there is refused at the door with 429.
function world(t, {codex = success} = {}) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  let now = T;
  t.mock.method(Date, 'now', () => now);
  const sent = [], board = switchboard(sent), site = {down: false}, env = {...config.vars, ENGINE: 'codex', FALLBACK_FREE_AI_DAY_USD: '0', ...board,
    SITE: {fetch: async (...args) => { if (site.down) throw new Error('site unreachable'); return board.SITE.fetch(...args); }}};   // site.down = the switchboard cannot be reached
  const meter = {...newMeter(0), daily: {day: Math.floor(T / 86400000), calls: {drift: 24, byhand: 0}}};
  const made = harness(meter, env);
  made.broker.containerFetch = async () => codex();
  const refusing = () => sent.filter(note => note.event === 'ai-broker-refusing');
  const at = ms => { now = T + ms; };
  const refused = (workflow = SCOUT) => made.broker.call('drift', body, workflow);   // 429 budget:daily
  const fine = (workflow = SCOUT) => made.broker.call('pr', body, workflow);
  return {...made, sent, refusing, at, refused, fine, env, site};
}

test('the alert is a registry event on Engineering, wired, on by default, "changes only" with its modes', () => {
  const alert = alertOf('ai-broker-refusing');
  assert.deepEqual([alert?.channel, alert?.wired, alert?.on, alert?.mode], ['engineering', true, true, 'changes']);
  assert.deepEqual(alert.modes, ['every', 'changes']);
});

test('5 refused calls in a window send one 🔴 naming why and who, and 5 more send nothing; then a calm window sends one 🟢', async t => {
  const w = world(t);
  for (let i = 0; i < 3; i++) { w.at(i * 2000); assert.equal((await w.refused(SCOUT)).status, 429); }
  assert.equal(w.refusing().length, 0, '3 of 3 is under the 5-call floor');
  for (let i = 3; i < 5; i++) { w.at(i * 2000); await w.refused(DRIFT); }
  assert.equal(w.refusing().length, 1);
  const [down] = w.refusing();
  assert.equal(down.state, 'down'); assert.equal(down.level, 'problem');
  assert.match(down.text, /^🔴 AI broker refuses CI calls: 5 of 5 in 5 min/);
  assert.match(down.text, /budget:daily/); assert.match(down.text, /central-scout\.yml ×3/); assert.match(down.text, /ai-answer-drift\.yml ×2/); assert.match(down.text, /codex/);
  assert.doesNotMatch(down.text, /people/i, 'no person calls the broker: never say so');
  for (let i = 5; i < 10; i++) { w.at(i * 2000); await w.refused(SCOUT); }
  assert.equal(w.refusing().length, 1, 'once per streak');
  // The outage ends: answers every minute. Still 🔴 while the window holds the refusals, 🟢 once the share has been under the line for one whole window.
  const times = [];
  for (let m = 1; m <= 14; m++) { w.at(m * MIN); const before = w.refusing().length; assert.equal((await w.fine()).status, 200); if (w.refusing().length > before) times.push(m); }
  assert.equal(times.length, 1, 'one recovery');
  assert.ok(times[0] >= 6 && times[0] <= 12, `recovered at minute ${times[0]}`);
  const up = w.refusing().at(-1);
  assert.equal(up.state, 'up'); assert.equal(up.level, 'ok'); assert.match(up.text, /^🟢 AI broker answers again/);
  w.at(20 * MIN); await w.fine(); assert.equal(w.refusing().length, 2, 'nothing more after the 🟢');
  w.at(30 * MIN); for (let i = 0; i < 5; i++) { w.at(30 * MIN + i * 2000); await w.refused(); }
  assert.equal(w.refusing().length, 3, 'a new streak is a new 🔴');
});

test('5 failed calls (every engine failed) are a refusal too, with the engine\'s own words', async t => {
  const w = world(t, {codex: () => containerError('codex-failed:1 boom', {}, 500)});
  for (let i = 0; i < 5; i++) { w.at(i * 2000); assert.equal((await w.fine()).status, 502); }
  assert.equal(w.refusing().length, 1); assert.match(w.refusing()[0].text, /5 of 5/);
});

test('platform cuts (a deploy or restart: "container just disconnected") are not a refusal: 5 of them send nothing', async t => {
  const w = world(t, {codex: () => containerError(CUT, {}, 500)});
  for (let i = 0; i < 8; i++) { w.at(i * 2000); await w.fine(); }
  assert.deepEqual(w.refusing(), []);
});

test('400s are the caller\'s bug: 10 of them send nothing, and they neither fill nor dilute the window', async t => {
  const w = world(t);
  for (let i = 0; i < 10; i++) { w.at(i * 2000); assert.equal((await w.broker.call('pr', {...body, tier: 'huge'}, SCOUT)).status, 400); }
  assert.deepEqual(w.refusing(), []);
  for (let i = 0; i < 5; i++) { w.at(30_000 + i * 2000); await w.refused(); }
  for (let i = 0; i < 20; i++) { w.at(60_000 + i * 100); await w.broker.call('pr', {...body, tier: 'huge'}, SCOUT); }
  assert.equal(w.refusing().length, 1);
});

test('the share counts: 5 refused among 6 answered (45%) is a normal bad hour, not an outage', async t => {
  const w = world(t);
  for (let i = 0; i < 6; i++) { w.at(i * 4000); await w.fine(); }
  for (let i = 0; i < 5; i++) { w.at(2000 + i * 4000); await w.refused(); }
  assert.deepEqual(w.refusing(), []);
});

test('the streak survives a restart of the broker (a deploy in an outage does not send a second 🔴)', async t => {
  const w = world(t);
  for (let i = 0; i < 5; i++) { w.at(i * 2000); await w.refused(); }
  const again = w.restart();
  again.containerFetch = async () => success();
  w.at(20_000); for (let i = 0; i < 5; i++) await again.call('drift', body, SCOUT);
  assert.equal(w.refusing().length, 1);
});

test('Gitar on #594: a 🔴 the site could not take is kept and sent on a later call, once; an outage that ends before it was delivered sends nothing at all', async t => {
  const w = world(t);
  t.mock.method(console, 'error', () => {});
  w.site.down = true;
  for (let i = 0; i < 5; i++) { w.at(i * 2000); await w.refused(); }
  assert.deepEqual(w.refusing(), [], 'the site was down: nothing arrived');
  w.at(30_000); await w.refused(); assert.deepEqual(w.refusing(), [], 'a retry is at most once a minute');
  w.site.down = false;
  w.at(70_000); await w.refused();
  assert.equal(w.refusing().length, 1); assert.equal(w.refusing()[0].state, 'down');
  w.at(140_000); await w.refused(); w.at(210_000); await w.refused();
  assert.equal(w.refusing().length, 1, 'delivered once, not again');
  for (let m = 5; m <= 20; m++) { w.at(m * MIN); await w.fine(); }
  assert.equal(w.refusing().length, 2, 'the first streak ends with its 🟢');
  // Second streak: the site is down when it opens, and it is over before any retry gets through: nobody was told it began, so nobody is told it ended.
  const later = 60 * MIN; w.site.down = true;
  for (let i = 0; i < 5; i++) { w.at(later + i * 2000); await w.refused(); }
  for (let m = 1; m <= 12; m++) { w.at(later + m * MIN); await w.fine(); }
  w.site.down = false; w.at(later + 14 * MIN); await w.fine(); w.at(later + 16 * MIN); await w.fine();
  assert.equal(w.refusing().length, 2, 'the first streak\'s 🔴 and 🟢 only');
});
