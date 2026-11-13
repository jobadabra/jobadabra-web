// One sliding-window "is this service refusing most of its calls" state machine, shared by the AI broker (workers/ai-broker/lib/refusing.mjs) and Free AI (shared/free-ai-alert.js), so the two alerts cannot disagree about what a streak is.
// Design: calls end `ok` or `bad` (a refusal or failure the caller feels); anything else (a caller's 400, a platform cut) is not recorded at all. Over the last WINDOW_MS, when at least MIN_CALLS ended and at least BAD_SHARE of them were bad, the streak OPENS (one 🔴).
// It CLOSES (one 🟢) once the window has been under the line for one whole window. State is plain JSON so a Durable Object or D1 can keep it across restarts.
// Why (12 Nov 2026, bx; owner: "I should get alerts (medium/high criticality)"; numbers read from the broker's /health tally, 6-12 Nov): its normal day fails 0.0-0.1% of 1.1k-21k calls, a bad day 2-7% (10 Nov: 496 of 6671, all one workflow), and none of those days has 5 calls in a row refused.
// 5 calls and half of them: a normal day and a bad 7% day stay quiet, an outage (every call refused) fires within the first 5 calls. A guard from the normal rate, not from one incident.

export const WINDOW_MS = 5 * 60_000, MIN_CALLS = 5, BAD_SHARE = 0.5, BUCKET_MS = 60_000;

/** A fresh state: no calls, no streak. */
export const newStreak = () => ({buckets: {}, open: null, calmSince: null, lastAt: 0});

const top = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const MAX_KEYS = 20;   // a bucket never keeps more than this many distinct reasons or callers: the rest fold into "other"
const bump = (counts, key) => { const k = key in counts || Object.keys(counts).length < MAX_KEYS ? key : 'other'; counts[k] = (counts[k] || 0) + 1; };

/** What the last window holds: {ok, bad, whys: [[why, n]...], who: [[caller, n]...]} (bad calls only for whys and who). */
export function windowOf(state, now) {
  const first = Math.floor(now / BUCKET_MS) - Math.floor(WINDOW_MS / BUCKET_MS) + 1, sum = {ok: 0, bad: 0}, whys = {}, who = {};
  for (const [key, bucket] of Object.entries(state.buckets)) {
    if (Number(key) < first) continue;
    sum.ok += bucket.ok; sum.bad += bucket.bad;
    for (const [why, n] of Object.entries(bucket.whys)) whys[why] = (whys[why] || 0) + n;
    for (const [name, n] of Object.entries(bucket.who)) who[name] = (who[name] || 0) + n;
  }
  return {...sum, whys: top(whys, 3), who: top(who, 3)};
}

const over = (window, minCalls = MIN_CALLS, share = BAD_SHARE) => window.ok + window.bad >= minCalls && window.bad / (window.ok + window.bad) >= share;

/**
 * Records one finished call at `now` (epoch ms) and returns {state, event}: event is null, {kind: 'down', startedAt, ...window} when the streak opens, or {kind: 'up', startedAt, ...window} when it closes.
 * `call` = {bad: boolean, why?: string, who?: string}; `minCalls` = the least calls in a window that can open a streak; `share` = the part of them that must be bad
 * (BAD_SHARE; the broker's wait alert asks 1 in 10, lib/waiting.mjs). The state passed in is not changed.
 */
export function step(before, now, call, minCalls = MIN_CALLS, share = BAD_SHARE) {
  const state = structuredClone(before), key = Math.floor(now / BUCKET_MS);
  const bucket = (state.buckets[key] ||= {ok: 0, bad: 0, whys: {}, who: {}});
  if (call.bad) { bucket.bad++; bump(bucket.whys, String(call.why || 'unknown').slice(0, 80)); bump(bucket.who, String(call.who || 'unknown').slice(0, 80)); } else bucket.ok++;
  for (const old of Object.keys(state.buckets)) if (Number(old) < key - Math.floor(WINDOW_MS / BUCKET_MS) - 1) delete state.buckets[old];
  const quiet = now - state.lastAt;
  state.lastAt = now;
  return judge(state, now, windowOf(state, now), minCalls, quiet, share);
}

/**
 * The open/close decision on a window that is already counted (Free AI counts in D1 and judges on the site's five-minute tick, shared/free-ai-alert.js): {ok, bad, whys, who} -> {state, event} as step().
 * `quiet` = ms since the previous call when the caller knows it (a pause in the calls counts as calm from the last call); a ticking caller leaves it 0.
 */
export function judge(before, now, window, minCalls = MIN_CALLS, quiet = 0, share = BAD_SHARE) {
  const state = structuredClone(before);
  if (!state.open) {
    if (!over(window, minCalls, share)) return {state, event: null};
    state.open = {startedAt: now}; state.calmSince = null;
    return {state, event: {kind: 'down', startedAt: now, ...window}};
  }
  if (over(window, minCalls, share)) { state.calmSince = null; return {state, event: null}; }
  // Calm: the window is under the line.
  state.calmSince ??= quiet >= WINDOW_MS ? now - quiet : now;
  if (now - state.calmSince < WINDOW_MS) return {state, event: null};
  const {startedAt} = state.open;
  state.open = null; state.calmSince = null;
  return {state, event: {kind: 'up', startedAt, ...window}};
}

/** "central-scout.yml ×3, ai-answer-drift.yml ×2" from a window's top list. */
export const listOf = pairs => pairs.map(([name, n]) => `${name} ×${n}`).join(', ');
