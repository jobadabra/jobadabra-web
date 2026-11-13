// "CI calls wait too long for a broker slot" as an alert, one per engine (Codex, Claude), through the same switchboard path as the refusal alert (lib/streak-note.mjs).
// Why (13 Nov 2026, owner: "do we get any telegram alerts if the queeuing is raising too much" · "That means we can lose jobs in the find jobs"; asked via AskUserQuestion,
// "Waits over 30 s (Recommended)"): 12 Nov 23:20-23:55Z the Claude-only benchmark waited p50 80 s, p90 180 s behind 3 Claude slots and its caller gave up on 92 calls
// (the round read 59 jobs against 150), and no note came: the refusal alert counts refused calls, and a call that waits and is then answered or given up is neither.
// Same escapes: 3 Nov "AI queue full (waited 47-68 s)", 0 jobs; 12 Nov 15-16Z p90 23-31 s.
// Design: a call that waited more than WAIT_LINE_MS for its slot, or whose caller gave up after waiting that long, is a starved call. Over 5 minutes (shared/streak.js),
// 1 call in 10 starved (the window's p90 over 30 s) with at least MIN_CALLS calls opens the engine's streak (one 🔴); a calm window closes it (one 🟢).
import {MIN_CALLS, listOf} from '../../../shared/streak.js';
import {streakNote} from './streak-note.mjs';
import {short, clock} from './refusing.mjs';

export const WAIT_LINE_MS = 30_000;
export const WAIT_SHARE = 0.1;

const queued = new WeakMap();   // a call's body -> {engine, since, gaveUp}: where it waits for a slot now
const callers = new WeakMap();  // a call's body -> its workflow (who is affected)
const gone = new WeakSet();     // bodies whose caller left: none of their later engine turns is a wait anyone feels (Gitar on #605)

/** The workflow a call came from, for the note's "CI jobs hit". */
export const named = (body, workflow) => { if (body && typeof body === 'object') callers.set(body, short(workflow)); };

/** The call starts waiting for an `engine` slot. */
export const waiting = (body, engine, now = Date.now()) => { if (body && typeof body === 'object' && !gone.has(body)) queued.set(body, {engine, since: now}); };

/** The call has its slot (or stopped waiting for it): {engine, waitMs, who}, or null when it was not waiting or its caller's give-up was already counted. */
export function served(body, now = Date.now()) {
  const at = body && typeof body === 'object' ? queued.get(body) : null;
  if (!at) return null;
  queued.delete(body);
  return at.gaveUp ? null : {engine: at.engine, waitMs: now - at.since, who: callers.get(body)};
}

/** The caller left while the call still waited: {engine, waitMs, who, gaveUp: true} once, when it had waited past the line; else null (a short wait is no starvation). Either way its slot, when it comes, counts no wait: nobody waits for it any more. */
export function left(body, now = Date.now()) {
  if (body && typeof body === 'object') gone.add(body);
  const at = body && typeof body === 'object' ? queued.get(body) : null;
  if (!at || at.gaveUp) return null;
  at.gaveUp = true;
  return now - at.since <= WAIT_LINE_MS ? null : {engine: at.engine, waitMs: now - at.since, who: callers.get(body), gaveUp: true};
}

const name = engine => (engine === 'claude' ? 'Claude' : engine === 'codex' ? 'Codex' : String(engine));

/** The two messages, as the owner reads them in Telegram. `slots` = how many calls of that engine run at once. */
export const downText = (engine, event, slots) => `🔴 AI broker queue: ${event.bad} of ${event.ok + event.bad} ${name(engine)} calls in 5 min waited over ${WAIT_LINE_MS / 1000} s for a slot`
  + ` · ${event.whys.map(([why, n]) => `${why} ×${n}`).join(', ')} · CI jobs hit: ${listOf(event.who)} · ${name(engine)} slots: ${slots}`;
export const upText = (engine, event) => `🟢 AI broker queue: ${name(engine)} calls get a slot within ${WAIT_LINE_MS / 1000} s again (the wait began ${clock(event.startedAt)} UTC)`;

/**
 * Records one wait ({engine, waitMs, who, gaveUp?} from served() or left()) in its engine's streak and sends the note it opens or closes. Never changes a call.
 */
export async function noteWait({storage, env, wait, slots, now = Date.now()}) {
  if (!wait) return;
  const bad = wait.gaveUp || wait.waitMs > WAIT_LINE_MS;
  await streakNote({storage, env, now, key: `waiting:${wait.engine}`, prefix: `waiting-${wait.engine}`, event: 'ai-broker-waiting',
    call: {bad, why: wait.gaveUp ? 'caller gave up' : 'waited', who: wait.who}, minCalls: MIN_CALLS, share: WAIT_SHARE,
    down: async event => downText(wait.engine, event, slots), up: event => upText(wait.engine, event)});
}
