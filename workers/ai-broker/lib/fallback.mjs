// CI's last-resort engine (Free AI, Workers AI) and its UTC-day ledger. Reservations commit before transport; only known usage releases them.
// Why (3 Nov 2026, owner: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): the paid Anthropic API step is gone. When Codex and the Claude subscription are both out, a call goes to Free AI or fails with its reason; no engine here holds a paid key.
import {modelFor, costUsd} from '../../../shared/free-ai-models.js';
import {toWorkersAi, fromWorkersAi} from '../../../shared/free-ai-translate.js';
import {refuseReply} from './guard.mjs';

const usd = micro => micro / 1e6;
const dayOf = () => new Date(Date.now()).toISOString().slice(0, 10);
const fresh = () => ({spent: {'free-ai': 0}, held: {'free-ai': 0}, notified: {}});   // days stored before 3 Nov 2026 also carry a `claude` ledger: never read, it ages out
const freeCap = env => Number.isFinite(Number(env.FALLBACK_FREE_AI_DAY_USD)) && Number(env.FALLBACK_FREE_AI_DAY_USD) > 0 ? Math.floor(Number(env.FALLBACK_FREE_AI_DAY_USD) * 1e6) : 0;
const json = (status, body) => Response.json(body, {status});
const validUsage = usage => usage && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0);

/** Whether Free AI is configured: the Workers AI binding and a day cap above zero. No allowance is invented. */
export const freeAiConfigured = env => Boolean(env.AI && freeCap(env));

/** Whether Free AI is configured and today's spend plus holds are still under its cap. Reads only; the step itself reserves. */
export async function underCap(storage, env) {
  const cap = freeCap(env);
  if (!cap || !freeAiConfigured(env)) return false;
  const state = await storage.get(`fallback:${dayOf()}`) || fresh();
  return state.spent['free-ai'] + state.held['free-ai'] < cap;
}

/** Exhaustion (and, for Codex, `overloaded` below) selects another engine; unrelated errors and credential-shaped text retain the original refusal. */
export const exhausted = why => !refuseReply(why) && /^(budget:(week|own-share)\b)|usage[ _-]limit|usage_limit_reached/i.test(String(why));

/** The server's own words in a failed Codex run's text: the last "message" of its JSON event stream, else the text without its `codex-failed:<code>` prefix; one line. */
export function codexMessage(why) {
  const said = [...String(why ?? '').matchAll(/"message":"((?:[^"\\]|\\.)*)"/g)].map(found => found[1]);
  return (said.length ? said.at(-1) : String(why ?? '').replace(/^codex-failed:\d+\s*/, '')).replace(/\s+/g, ' ').trim();
}

/** Whether Codex's model server turned the run away for capacity (Codex's server_overloaded class), read from the server's own words only; credential-shaped text keeps the refusal. */
// Why (5 Nov 2026, CI run 42040707448): the AI user agent died on "codex-failed:1 … Selec[ted model is at capacity]" while Claude was configured and idle; a busy model is not the caller's fault, another engine can answer.
export const overloaded = why => !refuseReply(why) && /\bat capacity\b|\boverloaded\b|high demand|capacity unavailable/i.test(codexMessage(why));

/** Today's measured Free AI USD and outstanding reservation, for broker health and the guarded admin page. */
export async function fallbackToday(storage, env) {
  const day = dayOf(), state = await storage.get(`fallback:${day}`) || fresh();
  return {day, freeAi: usd(state.spent['free-ai']), freeAiCap: usd(freeCap(env)), held: {freeAi: usd(state.held['free-ai'])}};
}

/** One Telegram note per marker per UTC day (the owner's brain bot), never repeated; a failed send is dropped. */
export async function noteOnce(storage, env, day, marker, text, fetcher = fetch) {
  if (!env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID) return;
  const send = await storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    if (state.notified[marker]) return false;
    state.notified[marker] = true;
    await tx.put(key, state);
    return true;
  });
  if (send) await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', signal: AbortSignal.timeout(5000),
    headers: {'content-type': 'application/json'}, body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text})}).catch(() => {});
}

const notifyCap = (storage, env, day, fetcher) => noteOnce(storage, env, day, 'free-ai',
  `CI fallback: Free AI daily cap $${usd(freeCap(env))} reached (${day} UTC). Further judgments go grey. /admin/ai/costs`, fetcher);

function messageBody(body, maxTokens) {
  const content = [{type: 'text', text: body.prompt}];
  for (const image of body.images || []) {
    const extension = String(image.name || '').split('.').pop().toLowerCase();
    const media = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'}[extension];
    if (!media || typeof image.base64 !== 'string') throw new Error('unsupported image');
    content.push({type: 'image', source: {type: 'base64', media_type: media, data: image.base64}});
  }
  return {max_tokens: maxTokens, messages: [{role: 'user', content}],
    ...(body.schema ? {output_config: {format: {type: 'json_schema', schema: body.schema}}} : {})};
}

async function reserve(storage, env, day, model, request) {
  // UTF-8 bytes of the whole request (text and schema) bound the input tokens; search is refused before reaching this calculation.
  const input = new TextEncoder().encode(JSON.stringify(request)).length + 1024;
  return storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    const left = freeCap(env) - state.spent['free-ai'] - state.held['free-ai'];
    const inputCost = Math.ceil(1e6 * costUsd(model, {input_tokens: input, output_tokens: 0}));
    const output = Math.min(6096, Math.floor((left - inputCost) / costUsd(model, {output_tokens: 1e6})));
    if (output < 256) return null;
    const amount = Math.ceil(1e6 * costUsd(model, {input_tokens: input, output_tokens: output}));
    if (amount > left) return null;
    state.held['free-ai'] += amount;
    await tx.put(key, state);
    return {amount, output};
  });
}

async function settle(storage, day, amount, actual) {
  await storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    state.held['free-ai'] -= amount;
    state.spent['free-ai'] += actual;
    await tx.put(key, state);
  });
}

/** What the engines in one chain walk tell each other: any failed step makes the end "unavailable", not "cap reached"; a search nobody could take says so. */
export const newNote = () => ({unavailable: false, search: false});

/** A request Free AI cannot take is answered here (400 for an empty prompt) before any engine is tried; null = go on. Search is not refused here: Codex or Claude may still answer it. */
export const apiPrecheck = body => typeof body.prompt !== 'string' || !body.prompt.trim() ? json(400, {why: 'fallback:invalid-prompt'}) : null;

/**
 * Free AI's step of the engine chain: a Response when it answered or refused for good, null when the next engine should try (not configured, cap reached, transport failure).
 * Every transport can be faked offline.
 */
export async function freeAiStep({storage, env, body, lane, weekUsedPercent, fetcher = fetch, note, started = Date.now()}) {
  if (body.search) { note.search = true; return null; }   // Why (1 Nov 2026, widened 2 Nov): only Codex and the Claude subscription (WebSearch tool) can search, never this engine; the chain ends with fallback:search-unsupported when neither could take it
  const day = dayOf(), cap = freeCap(env);
  if (!cap) return null;
  const state = await storage.get(`fallback:${day}`) || fresh();
  if (state.spent['free-ai'] + state.held['free-ai'] >= cap) { await notifyCap(storage, env, day, fetcher); return null; }
  if (!env.AI) { note.unavailable = true; return null; }
  const model = modelFor(undefined, env);
  let request;
  try { request = await toWorkersAi(messageBody(body, 4096)); } catch { return json(503, {why: 'fallback:unsupported'}); }
  const hold = await reserve(storage, env, day, model, request);
  if (!hold) { await notifyCap(storage, env, day, fetcher); return null; }
  request.max_tokens = hold.output;
  let message;
  try {
    const result = await env.AI.run(model, request);
    // The translator normalizes missing usage to zero; require the provider's real meter first.
    if (!result?.usage || !Number.isSafeInteger(result.usage.prompt_tokens) || !Number.isSafeInteger(result.usage.completion_tokens)) throw new Error('missing usage');
    message = fromWorkersAi(result, model);
    const choice = result.choices?.[0];
    if ((choice && choice.finish_reason !== 'stop') || choice?.message?.refusal) message.stop_reason = 'refused';
  } catch { note.unavailable = true; return null; }   // an ambiguous transport failure keeps the hold: only known usage releases it
  const usage = message?.usage;
  if (!validUsage(usage)) { note.unavailable = true; return null; }
  const actual = Math.ceil(1e6 * costUsd(model, {...usage, input_tokens: usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)}));
  await settle(storage, day, hold.amount, actual);
  const latest = await storage.get(`fallback:${day}`);
  if (latest.spent['free-ai'] + latest.held['free-ai'] >= cap) await notifyCap(storage, env, day, fetcher);
  if (actual > hold.amount || usage.output_tokens > hold.output) return json(503, {why: 'fallback:usage-exceeded-reservation'});
  const reply = Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
  if (!reply.trim() || !['end_turn', 'stop_sequence'].includes(message.stop_reason) || refuseReply(reply)) return json(503, {why: 'fallback:reply-refused'});
  if (body.schema) { try { JSON.parse(reply); } catch { return json(503, {why: 'fallback:invalid-json'}); } }
  return json(200, {reply, tokens: {input: usage.input_tokens, output: usage.output_tokens}, ms: Date.now() - started,
    lane, tier: body.tier ?? 'mid', model, weekUsedPercent, engine: 'free-ai'});
}

/** The answer when every engine in the chain passed: a search nobody could take, Free AI failing, or its day cap reached. */
export function apiFinish(env, note) {
  if (note.search) return json(503, {why: 'fallback:search-unsupported'});
  return json(note.unavailable ? 503 : 429, {why: note.unavailable ? 'fallback:unavailable' : `budget:fallback-day $${usd(freeCap(env))} Free AI (UTC)`});
}
