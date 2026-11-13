// The AI broker's lines on the one cap alert (shared/cap-check.js: 🟠 approaching, 🔴 reached, once per period): the Codex week, the Claude week, the Free AI fallback's day and
// the drift lane's day. Flags live in this Durable Object's storage; a card goes to the site's switchboard (POST /ops/notify, as lib/fallback.mjs noteOnce does).
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it"):
// a week line only reached the owner when every engine refused (the refusal streak, lib/refusing.mjs), and the Claude week stood at 79% of its 90% with no word.
// Invariants: never rejects and never delays a call (worker.js admit hands it to waitUntil); readings only, no line or engine choice changes here.
import {checkCap} from '../../../shared/cap-check.js';
import {CLAUDE_LIMIT_PCT, CODEX_LIMIT_PCT, DAILY, callsToday, claudeWeekPercent} from './budget.mjs';
import {freeCap} from './fallback.mjs';
import {paidCap, paidMonthCap} from './paid-claude.mjs';

const WEEK_RESET = 'it resets on its own when the plan\'s week ends';
/** name -> the cap (shared/cap-check.js checkCap). The week lines approach at 80% of their line. */
export const BROKER_CAPS = {
  'broker-codex-week': {title: 'CI\'s Codex week', event: 'ai-broker-cap', period: 'week', unit: 'percent', line: () => CODEX_LIMIT_PCT, approach: () => CODEX_LIMIT_PCT * 0.8,
    sees: 'CI\'s AI calls pass to Claude, then are refused when Claude is shut too', fix: `nothing to raise: ${WEEK_RESET}`},
  'broker-claude-week': {title: 'CI\'s Claude week', event: 'ai-broker-cap', period: 'week', unit: 'percent', line: () => CLAUDE_LIMIT_PCT, approach: () => CLAUDE_LIMIT_PCT * 0.8,
    sees: 'CI\'s AI calls stop using Claude until the week resets', fix: `raise CLAUDE_LIMIT_PCT in workers/ai-broker/lib/budget.mjs, or wait: ${WEEK_RESET}`},
  'broker-free-ai-day': {title: 'CI\'s Free AI fallback today', event: 'ai-broker-free-cap', period: 'day', unit: 'usd', line: env => freeCap(env), approach: env => freeCap(env) * 0.8,
    sees: 'CI judgments that no other engine takes go grey until 00:00 UTC', fix: 'raise FALLBACK_FREE_AI_DAY_USD in workers/ai-broker/wrangler.jsonc'},
  'broker-drift-day': {title: 'CI\'s drift lane today', event: 'ai-broker-cap', period: 'day', unit: 'calls', line: () => DAILY.drift, approach: () => DAILY.drift * 0.8,
    sees: 'the drift checks are refused until 00:00 UTC', fix: 'raise DAILY.drift in workers/ai-broker/lib/budget.mjs'},
  'broker-claude-api-day': {title: 'The broker\'s paid Claude key today', event: 'ai-broker-cap', period: 'day', unit: 'usd', line: env => paidCap(env) * 1e6, approach: env => paidCap(env) * 1e6 * 0.8,
    sees: 'Claude-only calls get "ran out" again until the plan reopens or 00:00 UTC', fix: 'raise CLAUDE_API_DAY_USD in workers/ai-broker/wrangler.jsonc'},
  'broker-claude-api-month': {title: 'The broker\'s paid Claude key this month', event: 'ai-broker-cap', period: 'month', unit: 'usd', line: env => paidMonthCap(env) * 1e6, approach: env => paidMonthCap(env) * 1e6 * 0.8,
    sees: 'Claude-only calls get "ran out" again until the plan reopens or the 1st', fix: 'raise CLAUDE_API_MONTH_USD in workers/ai-broker/wrangler.jsonc'},
};
for (const [name, cap] of Object.entries(BROKER_CAPS)) cap.name = name;

// Why (#623, Gitar): Durable Object storage has no TTL and up to 24 admissions run at once, so the flags live in one record (flag -> its end, ms) claimed in a transaction,
// and each claim drops the flags whose period ended.
const INDEX = 'cap:index';
const storeOf = storage => ({
  claim: (flags, ttl) => storage.transaction(async tx => {
    const now = Date.now(), index = (await tx.get(INDEX)) || {}, live = flag => index[flag] > now;
    if (live(flags[0])) return null;
    const before = flags.map(live);
    for (const [flag, until] of Object.entries(index)) if (until <= now) delete index[flag];
    for (const flag of flags) index[flag] = now + ttl * 1000;
    await tx.put(INDEX, index);
    return before;
  }),
  delete: flag => storage.transaction(async tx => { const index = (await tx.get(INDEX)) || {}; delete index[flag]; await tx.put(INDEX, index); }),
});
// -> true when the card is done: posted, or nothing to post with (no binding or key: as noteOnce).
const sendOf = env => async (event, level, text) => {
  if (!env.SITE || !env.SELFHEAL_PUBLISH_KEY) return true;
  const reply = await env.SITE.fetch('https://www/ops/notify', {method: 'POST', signal: AbortSignal.timeout(5000),
    headers: {'content-type': 'application/json', authorization: `Bearer ${env.SELFHEAL_PUBLISH_KEY}`}, body: JSON.stringify({event, text, html: true, level: 'problem', state: level})});
  if (!reply.ok) console.error(`cap note ${event} not delivered: site answered ${reply.status}`);
  return reply.ok;
};

/** One broker cap against its reading: `used` in the cap's unit, `period` a plan week's own key (its reset time). -> what was sent, or null. Never rejects. */
export const brokerCap = (storage, env, name, used, {period = null, reached = false, now = new Date(Date.now())} = {}) =>
  checkCap(env, BROKER_CAPS[name], used, {now, period, reached, store: storeOf(storage), send: sendOf(env)});

/**
 * Every admission's look at the three lines it can read: the Codex week (`codex` = the last {usedPercent, resetsAt}), the Claude week (stored claude:state) and the drift lane's calls today.
 * Never rejects.
 */
export async function brokerLines(storage, env, codex) {
  try {
    const now = Date.now() / 1000, claude = ((await storage.get('claude:state')) || {}).limits, meter = await storage.get('meter');
    const claudeWeek = claudeWeekPercent(claude, now);
    await Promise.all([
      codex?.usedPercent != null && codex.resetsAt ? brokerCap(storage, env, 'broker-codex-week', codex.usedPercent, {period: `week-${codex.resetsAt}`}) : null,
      claudeWeek != null ? brokerCap(storage, env, 'broker-claude-week', claudeWeek, {period: `week-${claude.sevenDay.resetsAt}`}) : null,
      meter ? brokerCap(storage, env, 'broker-drift-day', callsToday(meter, 'drift', now)) : null,
    ]);
  } catch { /* an alert never fails a call */ }
}
