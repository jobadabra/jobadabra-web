// admin/ai-limits-card.js: the rings on the AI cost page, from the broker's /health (owner, 4 Nov 2026: "80% used on Claude, (resets at x time)... 50% used on Codex (reset at x)").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inWords, limitsCard, toneOf, windows, zurich} from '../../../admin/ai-limits-card.js';
import {subscriptionOf} from '../../../shared/ai-broker.js';

const now = Date.parse('2026-11-05T00:47:00Z');
const sec = ms => Math.round(ms / 1000);
const HEALTH = {
  limits: {usedPercent: 1, resetsAt: sec(now + (6 * 24 + 9) * 3600e3)},
  chain: [{name: 'codex'}, {name: 'claude', limits: {status: 'allowed', fiveHour: {utilization: 0.76, resetsAt: sec(now + 3.5 * 3600e3), status: 'allowed'}, sevenDay: {utilization: 0.6, resetsAt: sec(now + 70 * 3600e3), status: 'allowed'}}}, {name: 'free-ai'}],
};
const FALLBACK = {freeAi: 0.0005, freeAiCap: 2};

test('one ring per window with its percent, its reset in Zurich time and in words', () => {
  const html = limitsCard(subscriptionOf(HEALTH), FALLBACK, now);
  assert.match(html, /id="ai-limits"/);
  for (const who of ['Codex', 'Claude, week', 'Claude, 5 hours', 'Free AI, today']) assert.ok(html.includes(`>${who}</span>`), who);
  assert.match(html, />1%</); assert.match(html, />60%</); assert.match(html, />76%</);
  assert.match(html, /Resets Wed 11 Nov, 10:47 \(in 6 d 9 h\)/, 'Codex week: Zurich is UTC+1 in November');
  assert.match(html, /Resets Thu 5 Nov, 05:17 \(in 3 h 30 min\)/);
  assert.match(html, /Resets Fri 6 Nov, 01:00 \(in 23 h 13 min\)/, 'Free AI resets at 00:00 UTC = 01:00 in Zurich');
});

test('amber from 70%, red from 90%, and the verdict names the highest window', () => {
  assert.deepEqual([0, 69.9, 70, 89.9, 90, 100].map(toneOf), ['good', 'good', 'warn', 'warn', 'bad', 'bad']);
  assert.match(limitsCard(subscriptionOf(HEALTH), FALLBACK, now), /Highest: Claude, 5 hours at 76%/);
  assert.match(limitsCard(subscriptionOf(HEALTH), FALLBACK, now), /chip warn">Claude, 5 hours at 76%/);
  const calm = {...HEALTH, chain: [{name: 'claude', limits: {fiveHour: {utilization: 0.07, resetsAt: sec(now + 3600e3)}, sevenDay: {utilization: 0.5, resetsAt: sec(now + 3600e3)}}}]};
  assert.match(limitsCard(subscriptionOf(calm), FALLBACK, now), /Nothing near a limit/);
});

test('the Claude week ring carries the 90% tick where the broker stops using Claude; the others have none', () => {
  const [codex, week, five, free] = windows(subscriptionOf(HEALTH), FALLBACK, now);
  assert.equal(week.tick, 90); assert.deepEqual([codex.tick, five.tick, free.tick], [undefined, undefined, undefined]);
  assert.match(limitsCard(subscriptionOf(HEALTH), FALLBACK, now), /rotate\(324\.0 70 70\)/);
  assert.match(limitsCard(subscriptionOf(HEALTH), FALLBACK, now), /Codex runs to 100% of its week, Claude to 90% of its week/);
});

test('a window whose reset is past shows no number (the reading is old), never a stale percent', () => {
  const stale = {...HEALTH, chain: [{name: 'claude', limits: {fiveHour: {utilization: 0.9, resetsAt: sec(now - 60e3)}, sevenDay: {utilization: 0.6, resetsAt: sec(now + 3600e3)}}}]};
  const [, , five] = windows(subscriptionOf(stale), FALLBACK, now);
  assert.equal(five.pct, null);
  const html = limitsCard(subscriptionOf(stale), FALLBACK, now);
  assert.match(html, /No reading yet/); assert.match(html, /Read again at the next Claude call/); assert.doesNotMatch(html, />90%</);
});

test('a utilization that is not a fraction 0..1 is dropped, not guessed; no readings at all says so', () => {
  const odd = {chain: [{name: 'claude', limits: {fiveHour: {utilization: 76, resetsAt: sec(now + 3600e3)}, sevenDay: {utilization: -1, resetsAt: sec(now + 3600e3)}}}]};
  assert.deepEqual(subscriptionOf(odd).claude, {status: '', fiveHour: null, sevenDay: null});
  assert.equal(subscriptionOf({}).codex, null);
  assert.match(limitsCard(subscriptionOf({}), null, now), /No limit read yet/);
  assert.match(limitsCard(null, FALLBACK, now), /data unavailable/);
  assert.doesNotMatch(limitsCard(null, FALLBACK, now), /<svg/);
});

test('Free AI off (cap 0) has no percent; the time words read like a person', () => {
  assert.equal(windows(subscriptionOf(HEALTH), {freeAi: 0, freeAiCap: 0}, now)[3].pct, null);
  assert.deepEqual([0, 20 * 60e3, 3 * 3600e3, 3.5 * 3600e3, (2 * 24 + 22) * 3600e3].map(inWords), ['now', 'in 20 min', 'in 3 h', 'in 3 h 30 min', 'in 2 d 22 h']);
  assert.equal(zurich(Date.parse('2026-07-01T10:00:00Z')), 'Wed 1 Jul, 12:00', 'summer time is UTC+2');
});

// A fresh code review of this card (5 Nov 2026) found each of these with a concrete input; they stay as the cases.
test('the provider status beats the percent: a warning is amber, a rejected window is a limit hit, in the chip and the verdict', () => {
  const claude = status => subscriptionOf({chain: [{name: 'claude', limits: {status, fiveHour: {utilization: 0.1, resetsAt: sec(now + 3600e3), status}, sevenDay: null}}]});
  const warn = limitsCard(claude('allowed_warning'), FALLBACK, now), hit = limitsCard(claude('rejected'), FALLBACK, now);
  assert.match(warn, /Provider warns/); assert.match(warn, /chip warn">Claude, 5 hours: provider warns/); assert.doesNotMatch(warn, /Nothing near a limit/);
  assert.match(hit, /Limit reached/); assert.match(hit, /chip bad">Claude, 5 hours: limit reached/);
  assert.match(limitsCard(claude('allowed'), FALLBACK, now), /Plenty left/);
});

test('the number, the chip and the verdict read one rounded value (69.6% is 70% and amber)', () => {
  const html = limitsCard(subscriptionOf({limits: {usedPercent: 69.6, resetsAt: sec(now + 3600e3)}}), null, now);
  assert.match(html, />70%</); assert.match(html, /Getting full/); assert.match(html, /chip warn">Codex at 70%/);
  assert.equal(windows(subscriptionOf({limits: {usedPercent: 89.6, resetsAt: sec(now + 3600e3)}}), null, now)[0].pct, 90);
  const over = windows(subscriptionOf({}), {freeAi: 3, freeAiCap: 2}, now)[3];
  assert.equal(over.pct, 100, 'Free AI past its cap is 100%, in the ring and the verdict alike');
});

test('Codex never read (resetsAt 0) or past its reset shows no number, like Claude; Free AI with cap 0 says Off and has no reset', () => {
  assert.equal(windows(subscriptionOf({limits: {usedPercent: 0, resetsAt: 0}}), null, now)[0].pct, null);
  assert.equal(windows(subscriptionOf({limits: {usedPercent: 70, resetsAt: sec(now - 86400e3)}}), null, now)[0].pct, null);
  const off = limitsCard(subscriptionOf({}), {freeAi: 0, freeAiCap: 0}, now);
  assert.match(off, /chip off">Off</); assert.doesNotMatch(off, /Resets Fri 6 Nov/);
});

test('time words never print 24 h; a ring at 0% draws no dot', () => {
  assert.equal(inWords(2865 * 60e3), 'in 2 d'); assert.equal(inWords((6 * 1440 + 23 * 60 + 40) * 60e3), 'in 7 d');
  assert.doesNotMatch([1500, 2865, 8620, 10000].map(m => inWords(m * 60e3)).join(' '), /24 h/);
  const zero = limitsCard(subscriptionOf({limits: {usedPercent: 0, resetsAt: sec(now + 3600e3)}}), null, now);
  assert.match(zero, /stroke-linecap="butt" stroke-dasharray="0\.0 400"/);
});

// Gitar on #376 (5 Nov 2026): two more cases of the same class, "which word speaks".
test('a window that says allowed is not turned red by another window or the overall status', () => {
  const both = subscriptionOf({chain: [{name: 'claude', limits: {status: 'rejected', fiveHour: {utilization: 0.4, resetsAt: sec(now + 3600e3), status: 'rejected'}, sevenDay: {utilization: 0.3, resetsAt: sec(now + 7200e3), status: 'allowed'}}}]});
  const [, week, five] = windows(both, FALLBACK, now);
  assert.equal(five.state.word, 'Limit reached'); assert.equal(week.state, null, 'the 7-day window reports allowed: no state');
  assert.doesNotMatch(limitsCard(both, FALLBACK, now).split('Claude, week')[1].split('Claude, 5 hours')[0], /Limit reached/);
  const none = windows(subscriptionOf({chain: [{name: 'claude', limits: {status: 'rejected', fiveHour: {utilization: 0.4, resetsAt: sec(now + 3600e3)}, sevenDay: null}}]}), FALLBACK, now)[2];
  assert.equal(none.state.word, 'Limit reached', 'a window with no word of its own takes the overall one');
});

test('the verdict is the most severe ring: a red Codex beats a Claude warning; a warning beats a bare amber percent', () => {
  const health = {limits: {usedPercent: 95, resetsAt: sec(now + 3600e3)}, chain: [{name: 'claude', limits: {status: 'allowed_warning', fiveHour: {utilization: 0.1, resetsAt: sec(now + 3600e3), status: 'allowed_warning'}, sevenDay: null}}]};
  assert.match(limitsCard(subscriptionOf(health), FALLBACK, now), /chip bad">Codex at 95%/);
  const amber = {limits: {usedPercent: 75, resetsAt: sec(now + 3600e3)}, chain: health.chain};
  assert.match(limitsCard(subscriptionOf(amber), FALLBACK, now), /chip warn">Claude, 5 hours: provider warns/);
});
