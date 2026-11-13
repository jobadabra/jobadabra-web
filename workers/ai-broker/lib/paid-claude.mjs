// The broker's own Anthropic API key (Worker secret CLAUDE_API_KEY): the paid fallback of a call that asks for Claude specifically (engine claude, only: true) when the Claude plan is out
// (its own limit, or the broker's week line). The same models and arguments run in the container, with the key in place of the plan's token; the reply says paid: true.
// Why (13 Nov 2026, owner via the coordinator: "let's create a new API Key, specifically for AI broker. It would be a fallback, when somebody requests specifically Claude and we're out of the
// plan/subscription limits"; "let's do the code change"; caps: "it should be capped to 10$ a day and 100$ a month"): this reverses, for that one case, the 3 Nov 2026 "We should not use API Keys at all anymore" (lib/fallback.mjs).
// Invariants: no secret = never runs (today's behaviour); a call that may pass on never spends the key; a day and a month cap in dollars (CLAUDE_API_DAY_USD $10, CLAUDE_API_MONTH_USD $100) close it again, with 🟠/🔴 on
// the cap alert (lib/cap-notes.mjs); the key never travels in a call body or leaves in a reply (worker.js login() lists it for lib/guard.mjs refuseReply).
import {claudeUsd} from '../../../shared/pro-claude.js';
import {brokerCap} from './cap-notes.mjs';
import {noteOnce} from './fallback.mjs';
import {queueOf} from './lanes.mjs';
import {refuseReply} from './guard.mjs';
import {CLAUDE_MODELS} from './tiers.mjs';
import {answered, failed, unavailable} from './walk.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const dayOf = now => now.toISOString().slice(0, 10);

/** True when this call may spend the key: the secret is set and the call asks for Claude only. */
export const paidAllowed = (env, body) => Boolean(env?.CLAUDE_API_KEY) && body?.engine === 'claude' && body?.only === true;
/** The day's and the month's lines in USD (CLAUDE_API_DAY_USD, CLAUDE_API_MONTH_USD; the owner's $10 and $100). */
export const paidCap = env => (Number(env?.CLAUDE_API_DAY_USD) > 0 ? Number(env.CLAUDE_API_DAY_USD) : 10);
export const paidMonthCap = env => (Number(env?.CLAUDE_API_MONTH_USD) > 0 ? Number(env.CLAUDE_API_MONTH_USD) : 100);
/** -> {usd} spent on the key this UTC day. */
export const paidDay = async (storage, now = new Date(Date.now())) => (await storage.get(`paid:${dayOf(now)}`)) || {usd: 0};
const monthKey = now => `paid-month:${now.toISOString().slice(0, 7)}`;

// Why (#626, Gitar): a reply's tokens priced as Anthropic bills them; `input` from the container holds both cache parts (container/claude.mjs readClaude): reads at a tenth, writes at 1.25x.
const priced = (model, tokens = {}) => {
  const read = tokens.cached || 0, written = tokens.cacheWritten || 0, plain = Math.max(0, (tokens.input || 0) - read - written);
  return claudeUsd(model, {input_tokens: plain + read * 0.1 + written * 1.25, output_tokens: tokens.output || 0});
};
// What a call is held at before it runs: its prompt (about 3 characters a token) plus the CLI's own context, and a long answer. Settled to the real price after.
const estimateOf = (model, body) => claudeUsd(model, {input_tokens: Math.ceil(String(body.prompt || '').length / 3) + 5000, output_tokens: 8000});
const round = usd => Math.round(usd * 1e6) / 1e6;
// Adds `usd` (may be negative: a settlement) to the day and the month, in one transaction. `limit` = a reservation: refused when either would pass its cap, else one more call.
// A settlement: `failure` = {why, at} of a call that failed (a kind word, never the text); `unsent` = the call never reached the container (its reservation's call is taken back).
// -> {day, month} after, or {over: 'day' | 'month'}.
const book = (storage, env, now, usd, limit = false, {failure = null, unsent = false} = {}) => storage.transaction(async tx => {
  const dk = `paid:${dayOf(now)}`, mk = monthKey(now), day = (await tx.get(dk)) || {usd: 0}, month = (await tx.get(mk)) || {usd: 0};
  if (limit && day.usd + usd > paidCap(env)) return {over: 'day'};
  if (limit && month.usd + usd > paidMonthCap(env)) return {over: 'month'};
  const step = limit ? 1 : unsent ? -1 : 0, calls = Math.max(0, (day.calls || 0) + step), failed = (day.failed || 0) + (failure ? 1 : 0), monthCalls = Math.max(0, (month.calls || 0) + step);
  await tx.put(dk, {...day, usd: round(day.usd + usd), calls, failed, ...(failure ? {lastFailure: failure} : {})});
  await tx.put(mk, {...month, usd: round(month.usd + usd), calls: monthCalls});
  return {day: round(day.usd + usd), month: round(month.usd + usd)};
});

/**
 * The paid lane as /health shows it: whether the key is set, the day's and the month's spend against their lines, the calls sent and failed today, and the last failure's kind and time.
 * Why (13 Nov 2026, coordinator sa: "where can the owner and I READ the paid lane's spend so far today and this month (dollars, calls)? … add it to /health"): the owner got Anthropic's $5 notice
 * and the broker's own reckoning was only in Durable Object storage. Spend is the broker's: answered calls at their tokens, a failed one at its estimate; Anthropic's console is the bill.
 */
export async function paidHealth(storage, env, now = new Date(Date.now())) {
  const day = (await storage.get(`paid:${dayOf(now)}`)) || {}, month = (await storage.get(monthKey(now))) || {};
  return {configured: Boolean(env?.CLAUDE_API_KEY), day: {usd: day.usd || 0, line: paidCap(env), calls: day.calls || 0, failed: day.failed || 0}, month: {usd: month.usd || 0, line: paidMonthCap(env), calls: month.calls || 0},
    ...(day.lastFailure ? {lastFailure: day.lastFailure} : {})};
}

/**
 * One call on the key, in place of the plan's `why` ('ran-out' or 'budget'). `held` = the caller already holds a container slot (it releases it). -> a walk verdict.
 * Why (#626, Gitar): the call's estimate is reserved before it runs, so calls arriving at once cannot all pass a cap read before any of them booked; it is settled to the real price after,
 * and a call that ran is booked even when it failed or was refused (its tokens when known, else its estimate). Past the day or the month cap: the plan's own verdict again (as if the key
 * were absent), and that cap's 🔴 card. A failed paid call never touches the plan's state.
 */
export async function paidClaude(broker, lane, body, waitMs, why, {held = false} = {}) {
  const storage = broker.ctx.storage, env = broker.brokerEnv, now = new Date(Date.now()), cap = paidCap(env);
  const model = CLAUDE_MODELS[body.tier ?? 'mid'], estimate = estimateOf(model, body);
  const reserved = await book(storage, env, now, estimate, true);
  if (reserved.over) { await brokerCap(storage, env, `broker-claude-api-${reserved.over}`, null, {reached: true, now}); return unavailable(why, `paid lane at its ${reserved.over} cap`, false); }
  let usd = estimate, release = null, failure = null, unsent = false;
  const fail = (why, verdict) => { failure = {why, at: now.toISOString()}; return verdict; };
  try {
    release = held ? () => {} : await broker.gate.acquire(queueOf(lane), waitMs);
    if (!release) { usd = 0; unsent = true; return unavailable('busy'); }   // never sent: nothing to pay
    let reply, answer;
    try {
      reply = await broker.toContainer('/claude', JSON.stringify({prompt: body.prompt, schema: body.schema, images: body.images, model, paid: true, ...(body.search === true ? {search: true} : {}), ...(body.effort ? {effort: body.effort} : {})}));
      answer = JSON.parse(await reply.text());
    } catch { return fail('no-answer', failed('paid-failed', 'the paid call did not answer')); }
    if (answer?.tokens) usd = priced(model, answer.tokens);
    if (!reply.ok) return fail(String(answer?.kind || 'failed').slice(0, 40), failed('paid-failed', String(answer?.kind || 'failed').slice(0, 40)));   // the kind only: an error tail is never passed on from this lane
    const bad = refuseReply(answer.reply, await broker.login());
    if (bad) return fail('bad-answer', failed('bad-answer', '', json(422, {why: bad})));
    await noteOnce(storage, env, dayOf(now), 'claude-api-paid', 'ai-broker-claude-api', `💳 AI broker: the Claude plan is out, and a Claude-only call was answered on the broker's API key (paid; up to $${cap} a day and $${paidMonthCap(env)} a month). This is the first today.`).catch(() => {});
    return answered(json(200, {reply: answer.reply, tokens: answer.tokens, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, engine: 'claude', paid: true, usd: Math.round(usd * 1e4) / 1e4}));
  } finally {
    release?.();
    const after = await book(storage, env, now, usd - estimate, false, {failure, unsent}).catch(() => null);   // the settlement: the reservation becomes the real price
    if (after) await Promise.all([brokerCap(storage, env, 'broker-claude-api-day', after.day * 1e6, {now}), brokerCap(storage, env, 'broker-claude-api-month', after.month * 1e6, {now})]);
  }
}
