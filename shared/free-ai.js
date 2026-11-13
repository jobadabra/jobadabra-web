// Free AI (owner, 16 Oct 2026): /api/ai/* answers the app's Anthropic-shaped calls with an open model on Workers AI (env.AI), for every install, no key.
// The app's "API key" is JPF1.<install>.<token> (a token minted by /api/install-token with purpose "ai"), so both SDKs carry it unchanged.
// Fair use per install (minute, day), a global daily line with a Telegram alert, and a kill switch (FREE_AI=off). Nothing is stored: not the request, not the answer.
import {record as recordCost} from './aicost.js';
import {authorize, digestOf} from './guard.js';
import {verifyLicense} from './license.js';
import {asStream, fromWorkersAi, toWorkersAi, Unsupported} from './free-ai-translate.js';
import {accountNeurons} from './free-ai-usage.js';
import {FREE_NEURONS_PER_DAY, costUsd, modelFor, neuronsOf} from './free-ai-models.js';
import {PRO_PER_MINUTE, chargeCall, proLane} from './pro-ai.js';
import {claudeCall, proRoute} from './pro-claude.js';
import {aiAccess} from './hosted-budget.js';
import {capCheck} from './cap-alerts.js';
import {installHit} from './install-caps.js';
import {tally} from './free-ai-alert.js';
import {runOf} from './hosted.js';
import {WEB_ACTION, webSearch} from './free-ai-web.js';

// Per install (owner, 16 Oct 2026): 30 calls a minute, $0.30 a day and $3 a month (money, not calls), 1.5M tokens a day. Global: alert at $3 a day, stop at $10 a day, and a month line: alert at $40, stop at $60
// (the values in force are wrangler.toml's vars; these are the tight defaults. env FREE_AI_INSTALL_MINUTE_CALLS / FREE_AI_ALERT_USD / FREE_AI_STOP_USD / FREE_AI_MONTH_ALERT_USD / FREE_AI_MONTH_STOP_USD / FREE_AI_INSTALL_DAY_USD / FREE_AI_INSTALL_MONTH_USD).
export const LIMITS = {trialUsd: 2, perMinute: 30, installDayUsd: 0.3, installMonthUsd: 3, tokensPerDay: 1_500_000, alertUsd: 3, stopUsd: 10, monthAlertUsd: 40, monthStopUsd: 60};

const BUSY = 'Free AI is busy today. Try again tomorrow, or add your own key in Settings → Connections → AI (Claude or ChatGPT).';
const ADD_KEY = 'add your own Claude or ChatGPT key in Settings → Connections → AI.';
export const DAY_MESSAGE = `You reached today's Free AI use. It resets tomorrow, or ${ADD_KEY}`;
export const MONTH_MESSAGE = `You reached this month's Free AI use. It resets next month, or ${ADD_KEY}`;
export const TRIAL_MESSAGE = `You've used the Free AI included in your trial. Get Pro, or connect your own Claude or ChatGPT key in Settings → Connections → AI.`;
const BUSY_MONTH = `Free AI is busy this month. Try again next month, or ${ADD_KEY}`;
const error = (status, message, type = 'api_error') => Response.json({type: 'error', error: {type, message}}, {status});
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
// The two lines the admin Monetization page shows, read the same way the route enforces them.
export const monthStopUsd = env => num(env.FREE_AI_MONTH_STOP_USD, LIMITS.monthStopUsd);
export const trialUsd = env => num(env.FREE_AI_TRIAL_USD, LIMITS.trialUsd);
export const allowanceOf = env => (env.FREE_AI_NEURONS === 'off' ? Infinity : num(env.FREE_AI_NEURONS, FREE_NEURONS_PER_DAY));
// Every line in force: wrangler.toml's vars over the defaults above. The route enforces these and /admin/ai/costs shows them (26 Oct 2026:
// the page compared an install's day against the $0.30 default while $0.50 was enforced, and showed 140%).
export const limitsOf = (env = {}) => ({...LIMITS, trialUsd: trialUsd(env), monthStopUsd: monthStopUsd(env), perMinute: num(env.FREE_AI_INSTALL_MINUTE_CALLS, LIMITS.perMinute),
  installDayUsd: num(env.FREE_AI_INSTALL_DAY_USD, LIMITS.installDayUsd), installMonthUsd: num(env.FREE_AI_INSTALL_MONTH_USD, LIMITS.installMonthUsd),
  alertUsd: num(env.FREE_AI_ALERT_USD, LIMITS.alertUsd), stopUsd: num(env.FREE_AI_STOP_USD, LIMITS.stopUsd), monthAlertUsd: num(env.FREE_AI_MONTH_ALERT_USD, LIMITS.monthAlertUsd)});
export const count = async (kv, key) => Number(await kv.get(key)) || 0;
// The counters for one install (KV), in the order the route reads them.
export const keysOf = (who, day, month, minute) => ({minute: `freeai:min:${who}:${minute}`, dayUsd: `freeai:dusd:${who}:${day}`, monthUsd: `freeai:musd:${who}:${month}`, tokens: `freeai:tok:${who}:${day}`,
  usd: `freeai:usd:${day}`, globalMonth: `freeai:usdm:${month}`, neurons: `freeai:neu:${day}`, life: `freeai:life:${who}`});
// The lines a call is past, in the order the route checks them (also read by GET /api/ai/caps, shared/free-ai-caps.js) -> null or {capped, status, message}.
// Global: the day's or month's stop, or the daily Workers AI allowance (every install waits). Per install: the trial, then the month, then the day.
export function busyCap(lines, {microUsd, globalMonth, seen, allowance}) {
  if (microUsd >= lines.stopUsd * 1e6) return {capped: 'busy', status: 503, message: BUSY, line: 'free-ai-day', used: microUsd};   // line: its entry in shared/cap-alerts.js
  if (globalMonth >= lines.monthStopUsd * 1e6) return {capped: 'busy-month', status: 503, message: BUSY_MONTH, line: 'free-ai-month', used: globalMonth};
  if (seen >= allowance) return {capped: 'busy', status: 503, message: BUSY, line: 'free-ai-neurons', used: seen};
  return null;
}
export function installCap(lines, access, {life, installMonth, installDay, tokens}) {
  if (!access.license && life >= lines.trialUsd * 1e6) return {capped: 'trial', status: 429, message: TRIAL_MESSAGE, line: 'free-ai-trial'};   // line: its entry in shared/install-caps.js
  if (installMonth >= lines.installMonthUsd * 1e6) return {capped: 'month', status: 429, message: MONTH_MESSAGE, line: 'free-ai-install-month'};
  if (installDay >= lines.installDayUsd * 1e6 || tokens >= lines.tokensPerDay) return {capped: 'day', status: 429, message: DAY_MESSAGE, line: 'free-ai-install-day'};
  return null;
}

export const parseKey = key => { const [tag, install, token] = String(key || '').split('.'); return tag === 'JPF1' && install && token ? {install, token} : null; };

// Apps from before Free AI still send their founder/friend key (JP1.…): it works the same until they update.
export async function who(key, env, now = new Date()) {
  if (String(key || '').startsWith('HR1.') && env.HOSTED_ALWAYS_ON === 'on') return aiAccess(env, key, runOf, now);   // a hosted container's run token: charged as the install that set the schedule (shared/hosted-budget.js)
  const given = parseKey(key);
  if (given) { const access = await authorize(env, given.install, given.token, 'ai'); return access.ok ? {...access, install: given.install} : null; }   // a trial install: its lifetime budget applies
  const license = String(key || '').startsWith('JP1.') && await verifyLicense(key, env.LICENSE_PUBLIC_KEY);
  return license ? {ok: true, who: await digestOf(`license:${license.id}`), license: true} : null;   // Pro / founder / friend: a separate lane, no trial budget
}

/**
 * /api/ai/*: answers the call, then counts how it ended for the "Free AI fails people's calls" alert (shared/free-ai-alert.js); the count never changes the answer.
 * Why (12 Nov 2026, bx; owner: "That could be real users not being able to perform actions"): the route logged a failure and told nobody; the five-minute tick reads these counts.
 */
export async function freeAi(request, env, now = new Date(), ctx = null, fetcher = fetch) {
  const trace = {}, response = await answerCall(request, env, now, ctx, fetcher, trace);
  const counted = tally(env, request, response, trace, now).catch(error => console.error(`free-ai tally: ${String(error?.message || error).slice(0, 100)}`));
  ctx?.waitUntil ? ctx.waitUntil(counted) : await counted;
  return response;
}

// `trace` is filled for the count: the install's digest (who) and a 502's own cause.
async function answerCall(request, env, now, ctx, fetcher, trace) {
  const path = new URL(request.url).pathname.replace(/^\/api\/ai/, '');
  if (env.FREE_AI === 'off') return error(503, 'Free AI is paused right now. You can add your own key in Settings → Connections → AI.');
  if (!env.AI || !env.WAITLIST) return error(503, 'Free AI is not available right now.');
  const access = await who(request.headers.get('x-api-key'), env, now);
  if (access) trace.who = access.who;
  if (!access) return error(401, 'Free AI needs this install\'s token. Restart Jobadabra and try again.', 'authentication_error');
  if (path === '/v1/models' && request.method === 'GET') return Response.json({data: [], has_more: false});   // key checks
  if (path !== '/v1/messages' || request.method !== 'POST') return error(404, 'Not available with Free AI.', 'not_found_error');
  if (request.headers.get('x-jp-action') === WEB_ACTION) return webSearch(request, env, access, now, ctx, fetcher);   // the board web search: its own lane, key and month line (shared/free-ai-web.js)
  const pro = await proLane(env, access.install);   // a Pro account with credit: its own lane (shared/pro-ai.js); null = the Free rules
  if (pro?.blocked) { await later(ctx, installHit(env, 'pro-credit', access.who, null, null, {now, reached: true})); return error(402, pro.blocked, 'billing_error'); }

  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), month = day.slice(0, 7), minute = now.toISOString().slice(0, 16);
  const keys = keysOf(access.who, day, month, minute);
  const [perMinute, installDay, installMonth, tokens, microUsd, globalMonth, neurons, life] = await Promise.all(Object.values(keys).map(key => count(kv, key)));
  const lines = limitsOf(env);
  const allowance = allowanceOf(env);
  const account = pro ? null : await accountNeurons(env, kv, day, now, fetcher), seen = Math.max(neurons, account ?? 0);   // the account's own count includes every caller
  const busy = pro ? null : busyCap(lines, {microUsd, globalMonth, seen, allowance});
  // Why (13 Nov 2026, owner: "...another one, ciritical, when we reached it"): a refusal makes sure the 🔴 card of the line that refused went out, also when the line was crossed by spend
  // this route never counted (a hosted run's compute, shared/hosted-budget.js). Only that line, forced reached (Gitar on #622: one KV read, and a cached count cannot hide it).
  if (busy) { await later(ctx, capCheck(env, busy.line, busy.used, {now, fetcher, reached: true})); return error(busy.status, busy.message); }
  // Why (13 Nov 2026, owner, "Grouped hourly (Recommended)"): a person stopped by a line of their own is counted for the hourly card (shared/install-caps.js).
  if (perMinute >= (pro ? PRO_PER_MINUTE : lines.perMinute)) { if (!pro) await later(ctx, installHit(env, 'free-ai-minute', access.who, null, null, {now, reached: true})); return error(429, 'Free AI: too many requests in a minute. Jobadabra will retry.', 'rate_limit_error'); }
  const mine = pro ? null : installCap(lines, access, {life, installMonth, installDay, tokens});
  if (mine) { await later(ctx, installHit(env, mine.line, access.who, null, null, {now, reached: true})); return error(mine.status, mine.message, 'rate_limit_error'); }

  let body;
  try { body = await request.json(); } catch { return error(400, 'Bad request.', 'invalid_request_error'); }
  const routed = pro?.account ? proRoute(request.headers.get('x-jp-action'), env) : null;   // a Pro account with credit, on a step with a measured Claude gain (shared/pro-claude.js); Free never
  const began = Date.now();   // before a Pro step's Claude try (up to 50 s, shared/pro-claude.js), so a 502's ms= counts it (Gitar on #414)
  const claude = routed ? await claudeCall(env, routed, body, fetcher) : null;   // null on any failure: Workers AI answers below
  const model = claude ? routed : modelFor(request.headers.get('x-jp-action'), env);
  let result, structured = false;
  // Why (5 Nov 2026, the first production hosted run: two 502s after 163 s and 173 s with no reason logged): a 502 names its cause.
  const failed = cause => { trace.cause = cause; console.error(`free-ai 502: ${cause} model=${model}${routed ? ` claude=${routed} failed` : ''} action=${request.headers.get('x-jp-action') || '-'} ms=${Date.now() - began}`); return error(502, 'Free AI could not answer just now.'); };
  if (!claude) try {
    const readPdf = async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const [page] = await env.AI.toMarkdown([{name: 'cv.pdf', blob: new Blob([bytes], {type: 'application/pdf'})}]);
      return page?.data || '';
    };
    // Why (8 Nov 2026, fr; owner: "Open it now"): whether the ask wants JSON is read from the ask itself, not from `response_format` in the request built for the model: Gemma 4 gets its schema written into the prompt (desktop/lib/free-ai-translate.js), so that field is gone.
    // The model is passed on because the translator shapes the request by it.
    structured = Boolean(body.output_config?.format?.schema);
    const input = await toWorkersAi(body, readPdf, request.headers.get('x-jp-action') || '', model);   // the step picks the temperature (reading steps 0; desktop/lib/free-ai-models.js temperatureFor)
    result = await env.AI.run(model, input);
    // Live (16 Oct 2026, 1 of 30): the model looped on whitespace to the token limit. A structured ask gets one more try, and both attempts are paid for.
    if (structured && !isJson(fromWorkersAi(result, model, structured).content[0].text)) {
      const first = fromWorkersAi(result, model, structured).usage, again = await env.AI.run(model, {...input, temperature: body.temperature ?? 0.3});
      if (!isJson(fromWorkersAi(again, model, structured).content[0].text)) return failed('two bad JSON replies');
      result = {...again, usage: {prompt_tokens: (again.usage?.prompt_tokens || 0) + first.input_tokens, completion_tokens: (again.usage?.completion_tokens || 0) + first.output_tokens}};
    }
  } catch (caught) {
    if (/daily free allocation|4006/i.test(String(caught?.message))) { await later(ctx, capCheck(env, 'free-ai-neurons', null, {now, fetcher, reached: true})); return error(503, BUSY); }
    if (caught instanceof Unsupported) return error(422, `${caught.message} Add your own key in Settings → Connections → AI for this step.`, 'invalid_request_error');
    return failed(`Workers AI failed: ${String(caught?.message || caught).slice(0, 200)}`);
  }
  const message = claude ? claude.message : fromWorkersAi(result, model, structured);
  const used = message.usage.input_tokens + message.usage.output_tokens, usd = claude ? claude.usd : costUsd(model, message.usage);
  const after = Math.round(usd * 1e6), freeUsd = claude ? 0 : usd, freeAfter = claude ? 0 : after;   // a Claude call is billed to the Pro credit only: Free's per-install, global and neuron counts measure Workers AI
  const work = Promise.all([
    kv.put(keys.minute, String(perMinute + 1), {expirationTtl: 120}), kv.put(keys.dayUsd, String(installDay + freeAfter), {expirationTtl: 2 * 86400}), kv.put(keys.monthUsd, String(installMonth + freeAfter), {expirationTtl: 40 * 86400}), kv.put(keys.globalMonth, String(globalMonth + freeAfter), {expirationTtl: 40 * 86400}), ...(access.license ? [] : [kv.put(keys.life, String(life + after))]),
    kv.put(keys.tokens, String(tokens + used), {expirationTtl: 2 * 86400}), kv.put(keys.usd, String(microUsd + freeAfter), {expirationTtl: 2 * 86400}), kv.put(keys.neurons, String(Math.round(neurons + neuronsOf(freeUsd))), {expirationTtl: 2 * 86400}),
    recordCost(env, access.who, request.headers.get('x-jp-action'), model, message.usage, usd, now),
    chargeCall(env, pro, after, request.headers.get('x-jp-action'), now),
    spendLines(env, now, fetcher, {day: microUsd + freeAfter, month: globalMonth + freeAfter, neurons: seen + neuronsOf(freeUsd)}),
    pro ? null : installLines(env, access, lines, now, {life: life + after, month: installMonth + freeAfter, day: installDay + freeAfter, minute: perMinute + 1}),
    pro?.account ? installHit(env, 'pro-credit', access.who, pro.account.credit_added_micro - pro.account.credit_micro + after, pro.account.credit_added_micro, {now}) : null,   // 🟠 at 80% of the credit added
  ]);
  ctx?.waitUntil ? ctx.waitUntil(work) : await work;
  if (body.stream) return new Response(asStream(message), {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache'}});
  return Response.json(message);
}

const isJson = text => { try { JSON.parse(text); return true; } catch { return false; } };

// The three Free AI lines that stop everyone, after a counted call (shared/cap-alerts.js: 🟠 approaching, 🔴 reached, each once per period). Never rejects.
const spendLines = (env, now, fetcher, used) => Promise.all([capCheck(env, 'free-ai-day', used.day, {now, fetcher}), capCheck(env, 'free-ai-month', used.month, {now, fetcher}),
  capCheck(env, 'free-ai-neurons', used.neurons, {now, fetcher})]);
// One install's own lines after a call (shared/install-caps.js): each is counted at 80% and at the line, once a day per level. The trial is a Free install's only.
const installLines = (env, access, lines, now, {life, month, day, minute}) => Promise.all([
  access.license ? null : installHit(env, 'free-ai-trial', access.who, life, lines.trialUsd * 1e6, {now}),
  installHit(env, 'free-ai-install-month', access.who, month, lines.installMonthUsd * 1e6, {now}),
  installHit(env, 'free-ai-install-day', access.who, day, lines.installDayUsd * 1e6, {now}),
  installHit(env, 'free-ai-minute', access.who, minute, lines.perMinute, {now}),
]);
const later = (ctx, work) => (ctx?.waitUntil ? ctx.waitUntil(work) : work);
