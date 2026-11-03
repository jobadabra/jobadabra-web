// The board web search for Free AI installs without their own plan (owner, 26 Oct 2026: "Yes, $10/month cap"): the relay (shared/free-ai.js) hands
// a call with x-jp-action "web_search" to this lane, which runs the public prompt (config/board_web_search.json, the one the engine sends) on the
// Anthropic API with the web search tool. One answer per roles × places is kept 30 days and served to every install that asks the same (shared),
// at most WEB.installPerDay searches a day per install, and a month line that stops every search at WEB.monthUsd (FREE_AI_WEB_MONTH_USD).
// The key is its own Worker secret (WEB_SEARCH_ANTHROPIC_KEY, a workspace with its own spend limit); FREE_AI_WEB_SEARCH=off pauses it.
// Kept: the boards answer (names and addresses of job boards) under a digest of the cell; never the roles' text, the install or a job.
// Guard: test/shared/free-ai-web.test.js. Shown on /admin/ai/costs (admin/free-ai-web-cost.js).
import PROMPT from '../config/board_web_search.json' with {type: 'json'};
import {record as recordCost} from './aicost.js';

export const WEB_ACTION = 'web_search';
// Haiku 5.5's price per million tokens (src/ai/cost.py) and the web search tool at $10 per 1,000 searches: 0.035 USD a cell.
export const WEB = {monthUsd: 10, installPerDay: 2, days: 30, model: 'claude-haiku-5-5', price: {input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125, search: 0.01}};
const LIST = {roles: [5, 80], countries: [60, 60], places: [20, 80], kinds: [20, 30]};
const error = (status, message, type = 'api_error') => Response.json({type: 'error', error: {type, message}}, {status});
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
export const monthLine = env => num(env.FREE_AI_WEB_MONTH_USD, WEB.monthUsd);
export const keys = {month: month => `freeai:web:usd:${month}`, calls: month => `freeai:web:calls:${month}`, hits: month => `freeai:web:hits:${month}`,
  install: (who, day) => `freeai:web:n:${who}:${day}`, cell: digest => `freeai:web:cell:${digest}`};

const strings = (value, [count, length]) => (Array.isArray(value) ? value : []).map(item => String(item ?? '').trim().slice(0, length)).filter(Boolean).slice(0, count);

// The engine's one user message ({countries, places, roles, kinds, 'known boards'}) -> the shared ask and its cell digest, or null when it is
// not that shape. The known boards are dropped: the answer is shared, and the engine keeps only hosts it does not hold yet.
export async function cellOf(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user' || typeof messages[0].content !== 'string') return null;
  let asked;
  try { asked = JSON.parse(messages[0].content); } catch { return null; }
  const ask = Object.fromEntries(Object.entries(LIST).map(([name, limits]) => [name, strings(asked?.[name], limits)]));
  if (!ask.roles.length || !(ask.countries.length || ask.places.length)) return null;
  const words = list => [...new Set(list.map(item => item.toLowerCase()))].sort();
  const bytes = new TextEncoder().encode(JSON.stringify([words(ask.roles), words(ask.countries), words(ask.places)]));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return {ask, digest};
}

export function costOf(usage = {}) {
  const {input, output, cacheRead, cacheWrite, search} = WEB.price;
  return ((usage.input_tokens || 0) * input + (usage.output_tokens || 0) * output + (usage.cache_read_input_tokens || 0) * cacheRead
    + (usage.cache_creation_input_tokens || 0) * cacheWrite) / 1e6 + (usage.server_tool_use?.web_search_requests || 0) * search;
}

// The call the engine would make itself (src/sources/board_web.py search), with the shared prompt, cap and answer form; nothing from the caller but the ask.
export const paramsOf = ask => ({model: WEB.model, max_tokens: PROMPT.max_tokens, system: [{type: 'text', text: PROMPT.system}],
  messages: [{role: 'user', content: JSON.stringify({...ask, 'known boards': []})}],
  tools: [{type: 'web_search_20250305', name: 'web_search', max_uses: PROMPT.max_uses}], output_config: {format: {type: 'json_schema', schema: PROMPT.schema}}});

const count = async (kv, key) => Number(await kv.get(key)) || 0;

export async function webSearch(request, env, access, now = new Date(), ctx = null, fetcher = fetch) {
  let body;
  try { body = await request.json(); } catch { return error(400, 'Bad request.', 'invalid_request_error'); }
  if (body?.stream) return error(400, 'The web search answers in one piece.', 'invalid_request_error');
  const cell = await cellOf(body);
  if (!cell) return error(400, 'Only the job board web search runs here.', 'invalid_request_error');
  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const kept = await kv.get(keys.cell(cell.digest));
  if (kept) {
    const hits = await count(kv, keys.hits(month)), work = kv.put(keys.hits(month), String(hits + 1), {expirationTtl: 40 * 86400});
    ctx?.waitUntil ? ctx.waitUntil(work) : await work;
    return Response.json(JSON.parse(kept));
  }
  if (env.FREE_AI_WEB_SEARCH === 'off' || !env.WEB_SEARCH_ANTHROPIC_KEY) return error(503, 'The web search is not available with Free AI right now.');
  const [spent, calls, installToday] = await Promise.all([count(kv, keys.month(month)), count(kv, keys.calls(month)), count(kv, keys.install(access.who, day))]);
  if (spent >= monthLine(env) * 1e6) return error(503, 'The web search for Free AI is used up this month. It comes back next month.');
  if (installToday >= WEB.installPerDay) return error(429, 'The web search ran its searches for today. It runs again tomorrow.', 'rate_limit_error');
  // Counted before the call, so a failing search is not retried in a loop and parallel asks from one install stop at the day's number.
  await kv.put(keys.install(access.who, day), String(installToday + 1), {expirationTtl: 2 * 86400});
  let message;
  try {
    const reply = await fetcher('https://api.anthropic.com/v1/messages', {method: 'POST', body: JSON.stringify(paramsOf(cell.ask)),
      headers: {'content-type': 'application/json', 'x-api-key': env.WEB_SEARCH_ANTHROPIC_KEY, 'anthropic-version': '2023-06-01'}});
    if (!reply.ok) return error(502, 'The web search could not answer just now.');
    message = await reply.json();
  } catch { return error(502, 'The web search could not answer just now.'); }
  const usd = costOf(message.usage), micro = Math.round(usd * 1e6);
  const text = (message.content || []).filter(block => block?.type === 'text').map(block => String(block.text || '')).join('');
  const answer = {id: message.id, type: 'message', role: 'assistant', model: message.model || WEB.model, content: [{type: 'text', text}],
    stop_reason: message.stop_reason || 'end_turn', usage: {input_tokens: message.usage?.input_tokens || 0, output_tokens: message.usage?.output_tokens || 0}};
  const work = Promise.all([
    kv.put(keys.month(month), String(spent + micro), {expirationTtl: 40 * 86400}), kv.put(keys.calls(month), String(calls + 1), {expirationTtl: 40 * 86400}),
    ...(isBoards(text) ? [kv.put(keys.cell(cell.digest), JSON.stringify(answer), {expirationTtl: WEB.days * 86400})] : []),   // only a boards answer is shared
    recordCost(env, access.who, WEB_ACTION, WEB.model, message.usage, usd, now),
  ]);
  ctx?.waitUntil ? ctx.waitUntil(work) : await work;
  return Response.json(answer);
}

const isBoards = text => { try { return Array.isArray(JSON.parse(text)?.boards); } catch { return false; } };
