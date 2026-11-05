// admin/ai-broker-card.js: "who answered today" on the AI cost page, from the broker's /health chain (owner, 1 Nov 2026: Claude, Codex or Free AI by one flag).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {brokerCard, stateOf} from '../../../admin/ai-broker-card.js';

const now = Date.parse('2026-11-02T01:00:00Z');
const CHAIN = [
  {name: 'codex', configured: true, answeredToday: 0, ranOutToday: 436, failedToday: 0, avgMs: null},
  {name: 'claude', configured: true, state: 'ready', answeredToday: 350, ranOutToday: 0, failedToday: 3, avgMs: 18394},
  {name: 'free-ai', configured: true, answeredToday: 3, ranOutToday: 0, failedToday: 0, avgMs: 4951},
];

test('one row per engine in chain order, with what it answered, ran out on and failed today', () => {
  const html = brokerCard(CHAIN, now);
  assert.match(html, /id="ai-broker-today"/);
  assert.match(html, /Who answered today/);
  for (const [name, answered, ranOut, failed] of [['Codex', 0, 436, 0], ['Claude', 350, 0, 3], ['Free AI', 3, 0, 0]]) {
    assert.match(html, new RegExp(`<td>${name}</td><td class="n">${answered}</td><td class="n">${ranOut}</td><td class="n">${failed}</td>`), name);
  }
  assert.ok(html.indexOf('Codex') < html.indexOf('Claude') && html.indexOf('Claude') < html.indexOf('Free AI'));
  assert.match(html, /18\.4 s/); assert.match(html, /5\.0 s/);
});

test('the state is a word with an icon: ready, used up (ran out all day), paused (demoted), token rejected, off', () => {
  assert.deepEqual(CHAIN.map(item => stateOf(item, now)), ['⛔ used up', '✅ ready', '✅ ready']);
  assert.equal(stateOf({name: 'free-ai', configured: false}, now), '⚪ off', 'Free AI with its cap at 0 is off');
  assert.equal(stateOf({name: 'claude', configured: true, state: 'token-invalid'}, now), '❌ token rejected');
  assert.equal(stateOf({name: 'claude', configured: true, state: 'ran-out'}, now), '⛔ used up');
  assert.equal(stateOf({name: 'claude', configured: true, state: 'ready', demotedUntil: '2026-11-02T01:30:00.000Z'}, now), '⏸ paused until 01:30');
  assert.equal(stateOf({name: 'claude', configured: true, state: 'ready', demotedUntil: '2026-11-02T00:30:00.000Z'}, now), '✅ ready', 'a demotion in the past is over');
});

test('no paid API row (the broker has none since 3 Nov 2026); a missing chain says so, never an empty table', () => {
  assert.doesNotMatch(brokerCard(CHAIN, now), /Claude API/);
  const older = [CHAIN[0], CHAIN[1], {name: 'claude-api', configured: true, answeredToday: 0, ranOutToday: 0, failedToday: 0, avgMs: null}, CHAIN[2]];
  assert.doesNotMatch(brokerCard(older, now), /Claude API/, 'an older broker still lists the removed engine until it is redeployed');
  assert.match(brokerCard(null, now), /data unavailable/);
  assert.doesNotMatch(brokerCard(null, now), /<table/);
});
