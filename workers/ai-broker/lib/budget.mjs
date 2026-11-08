// The broker's own share and Codex's whole-week usedPercent both stop scheduled, benchmark and drift work at 70% of the Codex week; PR checks go to 100%.
// Why (28 Oct 2026, owner: "burn these tokens"; Gitar on #2375; 30 Oct 2026, owner, JOB-45): own tokens and usedPercent meter CI and the whole week; the original caps reserved 25% for the owner.
// Why (31 Oct 2026, owner: "CI can use up to 100%"): the owner gave CI the whole allowance in every lane; keep both refusal brakes at exhaustion. Replaced for scheduled, bench and drift on 3 Nov 2026 (next Why); PR stays 100.
// Why (3 Nov 2026, owner, chose "Busy = next engine + PR reserve"): scheduled work (the search check, scouts, the digest) used 62% of the week and PR checks 37%, and by Tuesday the week read 100% so no PR check could use Codex. Scheduled, bench and drift now stop at 70%; PR keeps 30% to itself. A refusal by this reserve is not an error.
// Why (5 Nov 2026, owner: "I first stop scheduled jobs spilling onto your Claude plan at the 70% Codex line"): the refusal used to pass to the next engine like "ran out", and that was Claude, the owner's own subscription. Past the line these lanes pass to Free AI only (worker.js `noClaude`); PR still goes on to Claude at 100%.
export const RESERVE_PCT = 70;
// Why (8 Nov 2026, owner: "Fix Free AI + PR lane now (Recommended)": "by-hand Search checks may use the 30% PR reserve (about 1 run a day)"): a by-hand Search check may run into the PR reserve, to 100%.
export const LIMITS = {own: {pr: 100, byhand: 100, scheduled: RESERVE_PCT, bench: RESERVE_PCT, drift: RESERVE_PCT}, week: {pr: 100, byhand: 100, scheduled: RESERVE_PCT, bench: RESERVE_PCT, drift: RESERVE_PCT}};
/** Whether the reserve stops this lane before the whole week is used: scheduled, bench and drift. PR goes to 100%. */
export const heldByReserve = lane => LIMITS.week[lane] < 100;
/** Whether this lane's calls never pass on to Claude (the owner's own plan): the lanes the reserve holds, and by-hand Search checks (5 Nov 2026 rule kept for them on 8 Nov). */
export const offClaude = lane => heldByReserve(lane) || lane === 'byhand';
export const DAILY = {drift: 24, byhand: 800};   // Why (30 Oct 2026, owner, JOB-45): 20 stored-answer prompts + up to 4 judges per UTC day; the broker must stop reruns and failed calls from exceeding 24. byhand: "about 1 run a day" (owner, 8 Nov 2026), one 18-persona press is ~500 calls, so a second full run the same day is cut.
// Seed for tokens per 1% of the week (PR 0, 28 Oct 2026: 1% >= ~40 calls of ~18k tokens); the broker replaces it with its measured ratio.
export const TOKENS_PER_PERCENT = 720000;

/** Fresh meter state for the week that resets at resetsAt (epoch seconds). */
export const newMeter = resetsAt => ({resetsAt, tokens: {pr: 0, byhand: 0, scheduled: 0, bench: 0, drift: 0}, daily: {day: null, calls: {drift: 0, byhand: 0}}});

/** Accepted calls in this UTC day (epoch seconds); old meters without daily state read as zero. */
export const callsToday = (meter, lane, now = Date.now() / 1000) => meter.daily?.day === Math.floor(now / 86400) ? (meter.daily.calls?.[lane] ?? 0) : 0;

/** Reserves one accepted call before dispatch, including failures. Call with allow() in the same storage transaction. */
export function recordCall(meter, lane, now) {
  if (!Object.hasOwn(DAILY, lane)) return meter;
  const day = Math.floor(now / 86400);
  if (meter.daily?.day !== day) meter.daily = {day, calls: {drift: 0, byhand: 0}};
  meter.daily.calls[lane] = callsToday(meter, lane, now) + 1;
  return meter;
}

/** Adds completed tokens, never another call; a weekly reset preserves daily reservations. `now` is epoch seconds. */
export function record(meter, lane, tokens, now, nextResetsAt) {
  // resetsAt 0 = never set (fresh meter, Codex limits not read yet): adopt a week from now and keep the tokens. Without this, 0 + a week is 1970 and every call opened a fresh meter, so the own-share brake never fired (Gitar on #221).
  if (!meter.resetsAt) meter.resetsAt = nextResetsAt ?? now + 604800;
  const m = now >= meter.resetsAt ? newMeter(nextResetsAt ?? now + 604800) : meter;
  if (m !== meter && meter.daily) m.daily = meter.daily;
  m.tokens[lane] = (m.tokens[lane] ?? 0) + tokens;
  return m;
}

/** The broker's own share of the week in percent: all lanes' tokens over tokens-per-percent. */
export const ownSharePct = (meter, tokensPerPercent = TOKENS_PER_PERCENT) => Object.values(meter.tokens).reduce((a, b) => a + b, 0) / tokensPerPercent;

/**
 * Whether `lane` may call now: {ok: true} or {ok: false, why}. weekUsedPercent is Codex's own whole-week figure (null = not read yet: not a reason to stop).
 * A refusal is said as a reason word the job shows in its check ("budget:daily", "budget:own-share", "budget:week"); daily refusals replay or go grey; weekly exhaustion may select the broker's day-capped fallback.
 * This only checks: reserve accepted calls with recordCall() atomically. `now` is epoch seconds.
 */
export function allow(lane, meter, weekUsedPercent, tokensPerPercent = TOKENS_PER_PERCENT, now = Date.now() / 1000) {
  const calls = callsToday(meter, lane, now);
  if (Object.hasOwn(DAILY, lane) && calls >= DAILY[lane]) return {ok: false, why: `budget:daily ${calls} of ${DAILY[lane]} calls (${lane})`};
  // Why (30 Oct 2026, owner's goal: a green hand beta): the seed ratio was never replaced by a measured one, so 43.2M tokens read 60.06% while Codex said the whole week, the owner's
  // sessions included, was 32% used: every scheduled and manual run was refused with "own-share 60.1% of 60%". A part cannot exceed the whole, so the share is capped by the week reading.
  const own = Math.min(ownSharePct(meter, tokensPerPercent), weekUsedPercent ?? Infinity);
  if (own >= LIMITS.own[lane]) return {ok: false, why: `budget:own-share ${own.toFixed(1)}% of ${LIMITS.own[lane]}% (${lane})`};
  if (weekUsedPercent != null && weekUsedPercent >= LIMITS.week[lane]) return {ok: false, why: `budget:week ${weekUsedPercent}% of ${LIMITS.week[lane]}% (${lane})`};
  return {ok: true};
}
