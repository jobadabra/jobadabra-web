// GET /api/ai/caps (owner, 26 Oct 2026: "show this popup whenever, on every action that requires AI and their cap is reached ... before they reached 60 days or 20
// applications"): where this install stands with our AI, asked by the app before it starts an AI step: the credit lane, or the Free line it is past (the trial, the month,
// the day, or Free AI busy for everyone) with when it resets. Read exactly as the route enforces them (shared/free-ai.js busyCap / installCap); nothing is counted or written.
// The same key as Free AI (x-api-key: JPF1.<install>.<token>). Guard: test/unit/shared/free-ai-caps.test.js.
import {accountNeurons} from './free-ai-usage.js';
import {allowanceOf, busyCap, count, installCap, keysOf, limitsOf, who} from './free-ai.js';
import {installCredit} from './install-credit.js';
import {proLane} from './pro-ai.js';
import {percentOf, warnOf} from './pro.js';

const PAUSED = 'Free AI is paused right now. You can add your own key in Settings → Connections → AI.';
const json = body => Response.json(body, {headers: {'Cache-Control': 'no-store'}});
const nextDay = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
const nextMonth = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
// When a line opens again: the day's at 00:00 UTC, the month's on the 1st; the trial never (top-up, Pro or an own key).
const resetOf = (capped, now) => (capped === 'trial' || capped === 'credit' ? null : /month/.test(capped) ? nextMonth(now) : nextDay(now));

// -> {ok, lane: 'credit' | 'pro' | 'free' | 'license', capped: null | 'credit' | 'trial' | 'month' | 'day' | 'busy' | 'busy-month' | 'off', message, resetsAt, credit?: {percent, warn}}
export async function caps(request, env, now = new Date(), fetcher = fetch) {
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  const access = await who(request.headers.get('x-api-key'), env, now);
  if (!access) return Response.json({ok: false, error: 'unauthorized'}, {status: 401});
  const lane = await proLane(env, access.install);
  if (lane?.blocked) return json({ok: true, lane: 'pro', capped: 'credit', message: lane.blocked, resetsAt: null});
  if (lane) {
    const percent = percentOf(lane.account || await installCredit(env, access.install));
    return json({ok: true, lane: 'credit', capped: null, message: null, resetsAt: null, credit: {percent, warn: warnOf(percent)}});
  }
  if (env.FREE_AI === 'off' || !env.WAITLIST) return json({ok: true, lane: 'free', capped: 'off', message: PAUSED, resetsAt: null});
  const kv = env.WAITLIST, day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const [, installDay, installMonth, tokens, microUsd, globalMonth, neurons, life] = await Promise.all(Object.values(keysOf(access.who, day, month, '')).map(key => count(kv, key)));
  const lines = limitsOf(env), seen = Math.max(neurons, (await accountNeurons(env, kv, day, now, fetcher)) ?? 0);
  const cap = busyCap(lines, {microUsd, globalMonth, seen, allowance: allowanceOf(env)}) || installCap(lines, access, {life, installMonth, installDay, tokens});
  return json({ok: true, lane: access.license ? 'license' : 'free', capped: cap?.capped ?? null, message: cap?.message ?? null, resetsAt: cap ? resetOf(cap.capped, now) : null});
}
