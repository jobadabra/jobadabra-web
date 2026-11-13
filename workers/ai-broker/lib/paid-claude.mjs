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

/**
 * One call on the key, in place of the plan's `why` ('ran-out' or 'budget'). `held` = the caller already holds a container slot (it releases it). -> a walk verdict.
 * Past the day or the month cap: the plan's own verdict again (as if the key were absent), and that cap's 🔴 card. A failed paid call never touches the plan's state.
 */
export async function paidClaude(broker, lane, body, waitMs, why, {held = false} = {}) {
  const storage = broker.ctx.storage, env = broker.brokerEnv, now = new Date(Date.now()), cap = paidCap(env);
  if ((await paidDay(storage, now)).usd >= cap) { await brokerCap(storage, env, 'broker-claude-api-day', null, {reached: true, now}); return unavailable(why, 'paid lane at its day cap', false); }
  if (((await storage.get(monthKey(now))) || {usd: 0}).usd >= paidMonthCap(env)) { await brokerCap(storage, env, 'broker-claude-api-month', null, {reached: true, now}); return unavailable(why, 'paid lane at its month cap', false); }
  const model = CLAUDE_MODELS[body.tier ?? 'mid'];
  const release = held ? () => {} : await broker.gate.acquire(queueOf(lane), waitMs);
  if (!release) return unavailable('busy');
  try {
    let reply, answer;
    try {
      reply = await broker.toContainer('/claude', JSON.stringify({prompt: body.prompt, schema: body.schema, images: body.images, model, paid: true, ...(body.search === true ? {search: true} : {}), ...(body.effort ? {effort: body.effort} : {})}));
      answer = JSON.parse(await reply.text());
    } catch { return failed('paid-failed', 'the paid call did not answer'); }
    if (!reply.ok) return failed('paid-failed', String(answer?.kind || 'failed').slice(0, 40));   // the kind only: an error tail is never passed on from this lane
    const bad = refuseReply(answer.reply, await broker.login());
    if (bad) return failed('bad-answer', '', json(422, {why: bad}));
    const usd = claudeUsd(model, {input_tokens: answer.tokens?.input, output_tokens: answer.tokens?.output});
    const [total, month] = await storage.transaction(async tx => {
      const key = `paid:${dayOf(now)}`, day = (await tx.get(key)) || {usd: 0}, mk = monthKey(now), so = (await tx.get(mk)) || {usd: 0};
      await tx.put(key, {usd: day.usd + usd}); await tx.put(mk, {usd: so.usd + usd});
      return [day.usd + usd, so.usd + usd];
    });
    await Promise.all([
      brokerCap(storage, env, 'broker-claude-api-day', total * 1e6, {now}),
      brokerCap(storage, env, 'broker-claude-api-month', month * 1e6, {now}),
      noteOnce(storage, env, dayOf(now), 'claude-api-paid', 'ai-broker-claude-api', `💳 AI broker: the Claude plan is out, and a Claude-only call was answered on the broker's API key (paid; up to $${cap} a day and $${paidMonthCap(env)} a month). This is the first today.`).catch(() => {}),
    ]);
    return answered(json(200, {reply: answer.reply, tokens: answer.tokens, ms: answer.ms, lane, tier: body.tier ?? 'mid', model, engine: 'claude', paid: true, usd: Math.round(usd * 1e4) / 1e4}));
  } finally { release(); }
}
