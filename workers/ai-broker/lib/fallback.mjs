// CI's paid fallback and its UTC-day ledger. Reservations commit before transport; only known usage releases them.
import {HAIKU, SONNET, OPUS, claudeUsd} from '../../../shared/pro-claude.js';
import {modelFor, costUsd} from '../../../shared/free-ai-models.js';
import {toWorkersAi, fromWorkersAi} from '../../../shared/free-ai-translate.js';
import {refuseReply} from './guard.mjs';
import {kindOf} from '../../../admin/ai-refusal.js';

const MODELS = {small: HAIKU, mid: SONNET, large: OPUS};
const CLAUDE_CAP = 5_000_000;
const usd = micro => micro / 1e6;
const dayOf = () => new Date(Date.now()).toISOString().slice(0, 10);
const fresh = () => ({spent: {claude: 0, 'free-ai': 0}, held: {claude: 0, 'free-ai': 0}, notified: {}});
const freeCap = env => Number.isFinite(Number(env.FALLBACK_FREE_AI_DAY_USD)) && Number(env.FALLBACK_FREE_AI_DAY_USD) > 0 ? Math.floor(Number(env.FALLBACK_FREE_AI_DAY_USD) * 1e6) : 0;
const caps = env => ({claude: CLAUDE_CAP, 'free-ai': freeCap(env)});
const json = (status, body) => Response.json(body, {status});
const charge = (engine, model, usage) => Math.ceil(1e6 * (engine === 'claude' ? claudeUsd(model, usage) : costUsd(model, usage)));
const validUsage = usage => usage && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0);

/** Whether a paid/capped engine (ledger key `claude` = the Anthropic API, or `free-ai`) is configured; no allowance is invented for Free AI. */
export const apiConfigured = (engine, env) => engine === 'claude' ? Boolean(env.ANTHROPIC_API_KEY) : Boolean(env.AI && freeCap(env));

/** Whether a paid/capped engine is configured and today's spend plus holds are still under its cap (`claude` = the Anthropic API, `free-ai`). Reads only; the step itself reserves. */
export async function underCap(storage, env, engine) {
  const cap = caps(env)[engine];
  if (!cap || !apiConfigured(engine, env)) return false;
  const state = await storage.get(`fallback:${dayOf()}`) || fresh();
  return state.spent[engine] + state.held[engine] < cap;
}

/** Whether an exhausted Codex call has a configured fallback. */
export const fallbackEnabled = env => apiConfigured('claude', env) || apiConfigured('free-ai', env);

/** Only exhaustion selects another engine; unrelated errors and credential-shaped text retain the original refusal. */
export const exhausted = why => !refuseReply(why) && /^(budget:(week|own-share)\b)|usage[ _-]limit|usage_limit_reached/i.test(String(why));

/** Today's measured USD and outstanding reservations, for broker health and the guarded admin page. */
export async function fallbackToday(storage, env) {
  const day = dayOf(), state = await storage.get(`fallback:${day}`) || fresh();
  return {day, claude: usd(state.spent.claude), freeAi: usd(state.spent['free-ai']), claudeCap: 5, freeAiCap: usd(freeCap(env)),
    held: {claude: usd(state.held.claude), freeAi: usd(state.held['free-ai'])}};
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

async function notify(storage, env, day, engine, fetcher, refusal = null) {
  if (!env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID) return;
  const send = await storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    const marker = refusal ? `${engine}-refused:${refusal}` : engine;
    if (state.notified[marker]) return false;
    state.notified[marker] = true;
    await tx.put(key, state);
    return true;
  });
  if (send) await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', signal: AbortSignal.timeout(5000),
    headers: {'content-type': 'application/json'}, body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID,
      text: refusal ? `CI fallback: Claude refused (${refusal}). Trying Free AI. /admin/ai/costs` : `CI fallback: ${engine === 'claude' ? 'Claude' : 'Free AI'} daily cap $${usd(caps(env)[engine])} reached (${day} UTC). ${engine === 'claude' ? 'Trying Free AI.' : 'Further judgments go grey.'} /admin/growth/ai-cost`})}).catch(() => {});
}

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

async function reserve(storage, env, day, engine, model, request, countedInput = 0) {
  // UTF-8 bytes bound text/schema tokens. Vision uses the provider token counter: compressed image bytes do not bound visual tokens.
  // Add overhead to the larger estimate; search is refused before reaching this calculation.
  const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
  const schemaBytes = new TextEncoder().encode(JSON.stringify(request.output_config || {})).length;
  const input = Math.max(bytes, countedInput + schemaBytes) + 1024;
  return storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    const left = caps(env)[engine] - state.spent[engine] - state.held[engine];
    const inputCost = charge(engine, model, {input_tokens: input, output_tokens: 0});
    const outputUnit = (engine === 'claude' ? claudeUsd(model, {output_tokens: 1e6}) : costUsd(model, {output_tokens: 1e6}));
    const output = Math.min(engine === 'claude' ? 4096 : 6096, Math.floor((left - inputCost) / outputUnit));
    if (output < 256) return null;
    const amount = charge(engine, model, {input_tokens: input, output_tokens: output});
    if (amount > left) return null;
    state.held[engine] += amount;
    await tx.put(key, state);
    return {amount, output};
  });
}

async function settle(storage, day, engine, amount, actual) {
  await storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    state.held[engine] -= amount;
    state.spent[engine] += actual;
    await tx.put(key, state);
  });
}

/** What the engines in one chain walk tell each other: a vision/Claude refusal names its cause in the final reason; any failed step makes the end "unavailable", not "cap reached". */
export const newNote = () => ({unavailable: false, claudeRefusal: null, search: false});

/** A request no API engine can take is answered here (400 for an empty prompt) before any engine is tried; null = go on. Search is not refused here: Codex may still answer it. */
export const apiPrecheck = body => typeof body.prompt !== 'string' || !body.prompt.trim() ? json(400, {why: 'fallback:invalid-prompt'}) : null;

/**
 * One step of the engine chain for the Anthropic API (`claude`, answers as engine `claude-api`) or Workers AI (`free-ai`): a Response when this engine answered or refused for good,
 * null when the next engine should try (not configured, cap reached, transport or HTTP failure, as before the chain existed). All transports can be faked offline.
 */
export async function apiStep(engine, {storage, env, body, lane, weekUsedPercent, fetcher = fetch, note, started = Date.now()}) {
  if (body.search) { note.search = true; return null; }   // Why (1 Nov 2026, widened 2 Nov): only Codex and the Claude subscription (WebSearch tool) can search, never this engine; the chain ends with fallback:search-unsupported when neither could take it
  const day = dayOf();
  const why = reason => note.claudeRefusal ? `${reason} (claude ${note.claudeRefusal})` : reason;
  const refused = async response => {
    note.claudeRefusal = kindOf(response.status, await response.text().catch(() => ''));
    await notify(storage, env, day, 'claude', fetcher, note.claudeRefusal);
    note.unavailable = true;
  };
  const model = engine === 'claude' ? MODELS[body.tier ?? 'mid'] : modelFor(undefined, env);
  const cap = caps(env)[engine];
  if (!cap) return null;
  const state = await storage.get(`fallback:${day}`) || fresh();
  if (state.spent[engine] + state.held[engine] >= cap) { await notify(storage, env, day, engine, fetcher); return null; }
  if (engine === 'claude' ? !env.ANTHROPIC_API_KEY : !env.AI) { note.unavailable = true; return null; }
  let request;
  try {
    request = messageBody(body, 4096);
    if (engine === 'free-ai') request = await toWorkersAi(request);
  } catch { return json(503, {why: why('fallback:unsupported')}); }
  let countedInput = 0;
  if (engine === 'claude' && body.images?.length) {
    try {
      const counted = await fetcher('https://api.anthropic.com/v1/messages/count_tokens', {method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY},
        body: JSON.stringify({model, messages: request.messages})});
      if (!counted.ok) { await refused(counted); return null; }
      const data = await counted.json();
      if (!Number.isSafeInteger(data?.input_tokens) || data.input_tokens <= 0) throw new Error('no vision count');
      countedInput = data.input_tokens;
    } catch { note.unavailable = true; return null; }
  }
  const hold = await reserve(storage, env, day, engine, model, request, countedInput);
  if (!hold) { await notify(storage, env, day, engine, fetcher); return null; }
  request.max_tokens = hold.output;
  let message;
  try {
    if (engine === 'claude') {
      const response = await fetcher('https://api.anthropic.com/v1/messages', {method: 'POST', signal: AbortSignal.timeout(50_000),
        headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY}, body: JSON.stringify({...request, model, stream: false})});
      if (!response.ok) {
        // A returned HTTP error did not complete a message; ambiguous transport/parse failures keep the hold.
        if (response.status < 500 && response.status !== 408) await settle(storage, day, engine, hold.amount, 0);
        await refused(response); return null;
      }
      message = await response.json();
    } else {
      const result = await env.AI.run(model, request);
      // The translator normalizes missing usage to zero; require the provider's real meter first.
      if (!result?.usage || !Number.isSafeInteger(result.usage.prompt_tokens) || !Number.isSafeInteger(result.usage.completion_tokens)) throw new Error('missing usage');
      message = fromWorkersAi(result, model);
      const choice = result.choices?.[0];
      if ((choice && choice.finish_reason !== 'stop') || choice?.message?.refusal) message.stop_reason = 'refused';
    }
  } catch { note.unavailable = true; return null; }
  const usage = message?.usage;
  if (!validUsage(usage)) { note.unavailable = true; return null; }
  const actual = charge(engine, model, {...usage, input_tokens: usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)});
  await settle(storage, day, engine, hold.amount, actual);
  const latest = await storage.get(`fallback:${day}`);
  if (latest.spent[engine] + latest.held[engine] >= cap) await notify(storage, env, day, engine, fetcher);
  if (actual > hold.amount || usage.output_tokens > hold.output) return json(503, {why: 'fallback:usage-exceeded-reservation'});
  const reply = Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
  if (!reply.trim() || !['end_turn', 'stop_sequence'].includes(message.stop_reason) || refuseReply(reply)) return json(503, {why: 'fallback:reply-refused'});
  if (body.schema) { try { JSON.parse(reply); } catch { return json(503, {why: 'fallback:invalid-json'}); } }
  return json(200, {reply, tokens: {input: usage.input_tokens, output: usage.output_tokens}, ms: Date.now() - started,
    lane, tier: body.tier ?? 'mid', model, weekUsedPercent, engine: engine === 'claude' ? 'claude-api' : 'free-ai'});
}

/** The answer when every engine in the chain passed: a search nobody could take, an engine that failed, or both day caps reached. */
export function apiFinish(env, note) {
  if (note.search) return json(503, {why: 'fallback:search-unsupported'});
  return json(note.unavailable ? 503 : 429, {why: note.unavailable ? (note.claudeRefusal ? `fallback:unavailable (claude ${note.claudeRefusal})` : 'fallback:unavailable') : `budget:fallback-day $5 Claude; $${usd(freeCap(env))} Free AI (UTC)`});
}
