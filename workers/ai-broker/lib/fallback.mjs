// CI's last-resort engine (Free AI, Workers AI) and its UTC-day ledger. Reservations commit before transport; only known usage releases them.
// Why (3 Nov 2026, owner: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): the paid Anthropic API step is gone. When Codex and the Claude subscription are both out, a call goes to Free AI or fails with its reason; no engine here holds a paid key.
import {toWorkersAi, fromWorkersAi} from '../../../shared/free-ai-translate.js';
import {refuseReply} from './guard.mjs';
import {codexMessage} from '../container/kinds.mjs';
import {FREE_MODEL, FREE_WINDOW, FREE_EXTRAS, costOf, promptWithSchema, stripFence} from './free-model.mjs';

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

/** Whether a failed Codex run's text could carry a credential (lib/guard.mjs, with the broker's login values), raw or once its JSON escapes are decoded (Gitar on #406: `sk-…` passes the raw check and decodes to a key). */
export const tokenShaped = (why, login) => Boolean(refuseReply(why, login) || refuseReply(codexMessage(why), login));

/** Today's measured Free AI USD and outstanding reservation, for broker health and the guarded admin page. */
export async function fallbackToday(storage, env) {
  const day = dayOf(), state = await storage.get(`fallback:${day}`) || fresh();
  return {day, freeAi: usd(state.spent['free-ai']), freeAiCap: usd(freeCap(env)), held: {freeAi: usd(state.held['free-ai'])}};
}

/**
 * One note per marker per UTC day to the owner through the site's switchboard, never repeated: POST /ops/notify on the `www` Worker (service binding SITE, Bearer SELFHEAL_PUBLISH_KEY), as the registry event `event` (shared/notify-registry.js).
 * Why (12 Nov 2026, owner, on two Telegram notes from this Worker: "this one I think should be on engineering"): the notes went straight to the owner's personal Brain bot, so Admin could neither route nor mute them. The switchboard picks the channel and the owner's switch; this Worker holds no Telegram secret.
 * Without the binding or the key nothing is sent (as without the old bot). A refusal or an unreachable site is logged and dropped: a note never fails a call.
 */
export async function noteOnce(storage, env, day, marker, event, text, link = '') {
  if (!env.SITE || !env.SELFHEAL_PUBLISH_KEY) return;
  const send = await storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    if (state.notified[marker]) return false;
    state.notified[marker] = true;
    await tx.put(key, state);
    return true;
  });
  if (!send) return;
  try {
    const reply = await env.SITE.fetch('https://www/ops/notify', {method: 'POST', signal: AbortSignal.timeout(5000),
      headers: {'content-type': 'application/json', authorization: `Bearer ${env.SELFHEAL_PUBLISH_KEY}`}, body: JSON.stringify({event, text, ...(link ? {link} : {})})});
    if (!reply.ok) console.error(`note ${event} not delivered: site answered ${reply.status}`);
  } catch (caught) { console.error(`note ${event} not delivered: ${String(caught?.message || caught).slice(0, 100)}`); }
}

export const ADMIN_COSTS = 'https://www.jobpilotto.top/admin/ai/costs';
const notifyCap = (storage, env, day) => noteOnce(storage, env, day, 'free-ai', 'ai-broker-free-cap',
  `CI fallback: Free AI daily cap $${usd(freeCap(env))} reached (${day} UTC). Further judgments go grey.`, ADMIN_COSTS);

function messageBody(body, maxTokens) {
  const content = [{type: 'text', text: body.schema ? promptWithSchema(body.prompt, body.schema) : body.prompt}];   // Why (8 Nov 2026, fr): the schema rides in the prompt, never as response_format (lib/free-model.mjs)
  for (const image of body.images || []) {
    const extension = String(image.name || '').split('.').pop().toLowerCase();
    const media = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'}[extension];
    if (!media || typeof image.base64 !== 'string') throw new Error('unsupported image');
    content.push({type: 'image', source: {type: 'base64', media_type: media, data: image.base64}});
  }
  return {max_tokens: maxTokens, messages: [{role: 'user', content}]};
}

// Why (8 Nov 2026, fr; replayed on the 7 Nov digest prompt, 2 of 5 calls): Free AI's model then (Qwen3) thought before it answered and the thinking counted against max_tokens, ~1.5k to 5k tokens for a short ask and more for a long one. Gemma 4 (now, thinking off) answers in 150 to 500 tokens, but the ceiling still bounds a looping reply.
// The old ceiling of 6096 cut a call that thought past ~4k `length`, and a cut-off answer is thrown away as `fallback:reply-refused` (33 of ~500 Search check calls, 2 of 5 digest replays); the call is paid for either way.
// The ceiling is now the most the model can take after the prompt: 16000 (the digest's retry asks for 16000) inside the context window. It bounds one call's spend at 16000 output tokens, not the day's cap.
export const FREE_AI_OUTPUT_MAX = 16000, FREE_AI_MIN_OUTPUT = 256;

/** The most output tokens a request can ask for: the window minus the prompt (bytes / 3, above the measured 4.2 to 5.6 bytes per token, for non-Latin text) and a margin, up to FREE_AI_OUTPUT_MAX. Below FREE_AI_MIN_OUTPUT the prompt does not fit. */
export const outputRoom = request => Math.min(FREE_AI_OUTPUT_MAX, FREE_WINDOW - Math.ceil(new TextEncoder().encode(JSON.stringify(request)).length / 3) - 512);

async function reserve(storage, env, day, request, room) {
  // UTF-8 bytes of the whole request (text and schema) bound the input tokens; search is refused before reaching this calculation.
  const input = new TextEncoder().encode(JSON.stringify(request)).length + 1024;
  return storage.transaction(async tx => {
    const key = `fallback:${day}`, state = await tx.get(key) || fresh();
    const left = freeCap(env) - state.spent['free-ai'] - state.held['free-ai'];
    const inputCost = Math.ceil(1e6 * costOf({input_tokens: input, output_tokens: 0}));
    const output = Math.min(room, Math.floor((left - inputCost) / costOf({output_tokens: 1e6})));
    if (output < FREE_AI_MIN_OUTPUT) return null;
    const amount = Math.ceil(1e6 * costOf({input_tokens: input, output_tokens: output}));
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

class PromptTooLarge extends Error {}

/**
 * Runs the request with its ceiling; if the provider says prompt plus ceiling pass its window (bytes per token vary: a model may count each digit as a token), tries once more with the room that always fits. Takes env, model, request, hold ({output} is lowered to the ceiling used).
 * Why (8 Nov 2026, fr, code review; probed live): the provider's 400 says "your prompt contains at least N input tokens", but N is only the least that overflows (window + 1 minus the ceiling asked), not the count. A token is at least one byte, so window - bytes - margin always fits. No room even then: PromptTooLarge.
 */
async function runInWindow(env, model, request, hold) {
  try { return await env.AI.run(model, request); } catch (caught) {
    if (!/maximum context length/i.test(String(caught?.message))) throw caught;
    const room = Math.min(hold.output, FREE_WINDOW - new TextEncoder().encode(JSON.stringify(request)).length - 512);
    if (room < FREE_AI_MIN_OUTPUT) throw new PromptTooLarge(`prompt of ${JSON.stringify(request).length} bytes may not fit the ${FREE_WINDOW}-token window`);
    hold.output = room;
    return env.AI.run(model, {...request, max_tokens: room});
  }
}

/** A refusal of this step: 503 with its reason word, and one log line naming why (the response carries only the word; the broker's log had no cause until 8 Nov 2026). */
const refusal = (why, detail) => { console.error(`free-ai-step ${why}: ${detail}`); return json(503, {why}); };

/** What the engines in one chain walk tell each other: any failed step makes the end "unavailable", not "cap reached"; a search nobody could take says so. */
export const newNote = () => ({unavailable: false, search: false});

/** A request Free AI cannot take is answered here (400 for an empty prompt) before any engine is tried; null = go on. Search is not refused here: Codex or Claude may still answer it. */
export const apiPrecheck = body => typeof body.prompt !== 'string' || !body.prompt.trim() ? json(400, {why: 'fallback:invalid-prompt'}) : null;

/**
 * Free AI's step of the engine chain: a Response when it answered or refused for good, null when the next engine should try (not configured, cap reached, transport failure).
 * Every transport can be faked offline.
 */
export async function freeAiStep({storage, env, body, lane, weekUsedPercent, note, started = Date.now(), login = []}) {
  if (body.search) { note.search = true; return null; }   // Why (1 Nov 2026, widened 2 Nov): only Codex and the Claude subscription (WebSearch tool) can search, never this engine; the chain ends with fallback:search-unsupported when neither could take it
  const day = dayOf(), cap = freeCap(env);
  if (!cap) return null;
  const state = await storage.get(`fallback:${day}`) || fresh();
  if (state.spent['free-ai'] + state.held['free-ai'] >= cap) { await notifyCap(storage, env, day); return null; }
  if (!env.AI) { note.unavailable = true; return null; }
  const model = FREE_MODEL;
  let request;
  // The model is named, not the table's default: the request's shape follows it (code review of the app move, 8 Nov 2026).
  try { request = await toWorkersAi(messageBody(body, 4096), undefined, '', model); } catch { return json(503, {why: 'fallback:unsupported'}); }
  const room = outputRoom(request);
  if (room < FREE_AI_MIN_OUTPUT) return refusal('fallback:prompt-too-large', `prompt ${JSON.stringify(request).length} bytes leaves ${room} tokens in the ${FREE_WINDOW}-token window`);   // not the day cap: no note, nothing held, nothing sent
  const hold = await reserve(storage, env, day, request, room);
  if (!hold) { await notifyCap(storage, env, day); return null; }
  Object.assign(request, FREE_EXTRAS);
  request.max_tokens = hold.output;
  let message, choiceFinish;
  try {
    const result = await runInWindow(env, model, request, hold);
    // The translator normalizes missing usage to zero; require the provider's real meter first.
    if (!result?.usage || !Number.isSafeInteger(result.usage.prompt_tokens) || !Number.isSafeInteger(result.usage.completion_tokens)) throw new Error('missing usage');
    message = fromWorkersAi(result, model);
    const choice = result.choices?.[0];
    choiceFinish = choice?.finish_reason;
    if ((choice && choice.finish_reason !== 'stop') || choice?.message?.refusal) message.stop_reason = 'refused';
  } catch (caught) {
    if (caught instanceof PromptTooLarge) { await settle(storage, day, hold.amount, 0); return refusal('fallback:prompt-too-large', `${caught.message} lane=${lane}`); }   // the provider refused before generating: nothing was used, the hold is released
    // The provider's own words: its JSON error's "message" field when it has one, else the text; 200 characters. Probed 8 Nov 2026: Workers AI's 400 names the limit and does not echo the prompt (Gitar on #490: blanking every quoted string wiped the cause).
    const raw = String(caught?.message || caught), cause = (raw.match(/"message"\s*:\s*"([^"]*)"/)?.[1] ?? raw).slice(0, 200);
    console.error(`free-ai-step unavailable: ${cause} model=${model} max=${hold.output} lane=${lane} ms=${Date.now() - started}`); note.unavailable = true; return null;
  }   // an ambiguous transport failure keeps the hold: only known usage releases it; the cause is logged (8 Nov 2026: the broker's log had only "503")
  const usage = message?.usage;
  if (!validUsage(usage)) { note.unavailable = true; return null; }
  const actual = Math.ceil(1e6 * costOf({...usage, input_tokens: usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)}));
  await settle(storage, day, hold.amount, actual);
  const latest = await storage.get(`fallback:${day}`);
  if (latest.spent['free-ai'] + latest.held['free-ai'] >= cap) await notifyCap(storage, env, day);
  const outcome = `model=${model} max=${hold.output} output=${usage.output_tokens} prompt=${usage.input_tokens} lane=${lane} ms=${Date.now() - started}`;
  if (actual > hold.amount || usage.output_tokens > hold.output) return refusal('fallback:usage-exceeded-reservation', outcome);
  const said = Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
  const reply = body.schema ? stripFence(said) : said;   // the model wraps JSON in a ```json fence; callers parse the reply, so they get it bare
  if (!reply.trim() || !['end_turn', 'stop_sequence'].includes(message.stop_reason) || refuseReply(reply, login)) return refusal('fallback:reply-refused', `${outcome} finish=${choiceFinish ?? '-'} chars=${reply.length}${hold.output <= usage.output_tokens ? ' cut-off-at-ceiling' : ''}`);
  if (body.schema) { try { JSON.parse(reply); } catch { return refusal('fallback:invalid-json', outcome); } }
  return json(200, {reply, tokens: {input: usage.input_tokens, output: usage.output_tokens}, ms: Date.now() - started,
    lane, tier: body.tier ?? 'mid', model, weekUsedPercent, engine: 'free-ai'});
}

/** The answer when every engine in the chain passed: a search nobody could take, Free AI failing, or its day cap reached. */
export function apiFinish(env, note) {
  if (note.search) return json(503, {why: 'fallback:search-unsupported'});
  return json(note.unavailable ? 503 : 429, {why: note.unavailable ? 'fallback:unavailable' : `budget:fallback-day $${usd(freeCap(env))} Free AI (UTC)`});
}
