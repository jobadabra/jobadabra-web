// "Free AI fails people's calls" as an alert (owner, 12 Nov 2026: "That could be real users not being able to perform actions" · "I should get alerts (medium/high criticality)" · "For now let's keep it like Telegram").
// Free AI (shared/free-ai.js) is the route the desktop app's people use. Each /v1/messages call is counted per UTC minute in D1 (tally); the site's five-minute tick (tick) reads the last window and tells the owner once when it
// opens (🔴) and once when it closes (🟢), through the switchboard, with the same rule as the AI broker's (shared/streak.js).
// What counts as failed: an error the person feels, i.e. any 5xx (Workers AI or the Pro Claude route failing: 502; the global "busy" lines: 503). What does not: their own limits (429: trial, day, month, minute), a bad token (401), a bad body or an unsupported ask (400, 422), their Pro credit (402), and the owner's own pause (FREE_AI=off).
// Why (12 Nov 2026, bx): MIN_CALLS is 3, not the broker's 5. Free AI's real volume (ai_calls, 30 Oct to 12 Nov) is 25 to 134 answered calls a day from 1 or 2 installs, so an outage shows up as a handful of calls from one person's retries; 5 would stay quiet through it.
// Failed calls were never stored before this file, so no normal failure rate exists to read: the floor is a count that a working Free AI does not reach (a day's 25 to 134 calls hold no 3 failures in 5 minutes unless something is wrong), and it is to be re-read after the first weeks of rows.
import {judge} from './streak.js';
import {alertOwner} from './notify-send.js';

export const MIN_CALLS = 3;
const STATE = 'freeai:streak';
const minuteOf = now => now.toISOString().slice(0, 16);

/** Whether this response is one a person feels as a failure: null = not counted, else {bad}. `seen.cause` is the route's own log cause for a 502 (shared/free-ai.js failed()). */
export async function outcomeOf(response, seen = {}) {
  if (response.ok) return {bad: false};
  if (response.status < 500) return null;   // their own limit, token or body: not an outage
  // Why (12 Nov 2026, mac-9a's brief and the owner's approved text, "Free AI is busy today"; Gitar on #594 suggested leaving it out): the global busy lines (the day or month stop, Workers AI's daily allowance) stay counted. `free-ai-spend` tells the owner when spend crosses its alert line, before the stop; this tells when everybody is turned away, which is a person who cannot act.
  const said = await response.clone().json().catch(() => null), message = String(said?.error?.message || '');
  const why = seen.cause ? String(seen.cause).replace(/\s+/g, ' ').trim() : message.split(/[.?!]/)[0] || `HTTP ${response.status}`;
  return {bad: true, why: why.slice(0, 80)};
}

/** Counts one finished /v1/messages call. Never throws into the answer; nothing without the database, and nothing while the owner has Free AI paused. */
export async function tally(env, request, response, seen, now) {
  if (!env.STATS || env.FREE_AI === 'off' || request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/v1/messages')) return;
  const outcome = await outcomeOf(response, seen);
  if (!outcome) return;
  const minute = minuteOf(now);
  await env.STATS.prepare('INSERT INTO free_ai_minutes (minute, ok, bad) VALUES (?, ?, ?) ON CONFLICT (minute) DO UPDATE SET ok = ok + excluded.ok, bad = bad + excluded.bad').bind(minute, outcome.bad ? 0 : 1, outcome.bad ? 1 : 0).run();
  if (outcome.bad) await env.STATS.prepare('INSERT INTO free_ai_failed (at, who, why) VALUES (?, ?, ?)').bind(now.toISOString(), String(seen.who || 'unknown').slice(0, 16), outcome.why).run();
}

/**
 * The last five minutes as the streak reads them, from D1: {ok, bad, whys: [[why, n]], installs}.
 * Why (12 Nov 2026, Gitar on #594): both queries cut at the same whole minute (minute > now-5min), so the failures listed (causes, installs) are exactly the ones in the ratio.
 */
async function windowOf(env, now) {
  const from = new Date(now.getTime() - 5 * 60_000), sum = await env.STATS.prepare('SELECT COALESCE(SUM(ok), 0) AS ok, COALESCE(SUM(bad), 0) AS bad FROM free_ai_minutes WHERE minute > ? AND minute <= ?').bind(minuteOf(from), minuteOf(now)).first();
  const rows = (await env.STATS.prepare('SELECT who, why FROM free_ai_failed WHERE substr(at, 1, 16) > ? AND substr(at, 1, 16) <= ?').bind(minuteOf(from), minuteOf(now)).all()).results || [], whys = {};
  for (const row of rows) whys[row.why] = (whys[row.why] || 0) + 1;
  return {ok: sum?.ok || 0, bad: sum?.bad || 0, whys: Object.entries(whys).sort((a, b) => b[1] - a[1]).slice(0, 3), installs: new Set(rows.map(row => row.who)).size, who: []};
}

const clock = ms => new Date(ms).toISOString().slice(11, 16);
export const downText = window => `🔴 Free AI fails people's calls: ${window.bad} of ${window.ok + window.bad} in 5 min · why: ${window.whys.map(([why, n]) => `${why} ×${n}`).join(', ')} · installs affected: ${window.installs}`;
export const upText = (window, startedAt) => `🟢 Free AI answers again (the streak began ${clock(startedAt)} UTC; ${window.bad} of ${window.ok + window.bad} failed in the last 5 min)`;

/**
 * The five-minute tick: judge the last window, tell the owner when the streak opens or closes, drop rows older than 2 days. Returns the event kind or null.
 * A note nothing could deliver leaves the state as it was, so the next tick tries again (as shared/free-ai.js tellSpend).
 */
export async function tick(env, now = new Date(), fetcher = fetch) {
  if (!env.STATS || !env.WAITLIST) return null;
  const before = JSON.parse(await env.WAITLIST.get(STATE) || 'null') || {open: null, calmSince: null};
  const window = await windowOf(env, now), {state, event} = judge(before, now.getTime(), window, MIN_CALLS);
  let kept = true;
  if (event) {
    const told = await alertOwner(env, 'free-ai-failing', {text: event.kind === 'down' ? downText(window) : upText(window, event.startedAt), state: event.kind, level: event.kind === 'down' ? 'problem' : 'ok', fetcher, now}).catch(() => null);
    kept = Boolean(told && (told.sent || told.via === 'switchboard'));
  }
  if (kept) await env.WAITLIST.put(STATE, JSON.stringify({open: state.open, calmSince: state.calmSince}));
  const old = new Date(now.getTime() - 2 * 86400_000);
  await env.STATS.prepare('DELETE FROM free_ai_minutes WHERE minute < ?').bind(minuteOf(old)).run().catch(() => {});
  await env.STATS.prepare('DELETE FROM free_ai_failed WHERE at < ?').bind(old.toISOString()).run().catch(() => {});
  return event?.kind ?? null;
}
