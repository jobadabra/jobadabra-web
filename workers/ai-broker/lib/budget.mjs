// Two limits, one owner (this file). Codex: every lane may use the whole week (100%), refused at exhaustion; Claude: every lane may pass on to it until its seven-day window reads 90% used.
// Design (8 Nov 2026): a call is in one of three states. (1) Codex free: allow() says ok and Codex answers. (2) Codex out (or at capacity or failing) and Claude under 90%: the walk goes on to Claude. (3) Claude at or over 90%: no lane starts a Claude call (claudeAllow() says why), the walk goes on to Free AI, and a search or image Free AI cannot take gets the refusal `budget:claude-week`.
// Why (8 Nov 2026, owner, in this order, the last wins: "We can use codex up to 90%" · "And Claude up to 80%" · "Actually, we can use both up to 90%" · "Actually, codex up to 100%, Claude up to 90%"): replaces the 70% reserve for scheduled, bench and drift (3 Nov, owner "Busy = next engine + PR reserve"), the rule that held lanes never reach Claude (5 Nov, owner "I first stop scheduled jobs spilling onto your Claude plan at the 70% Codex line") and the by-hand Search check's own exception (8 Nov, #489). Lanes now differ only in queue priority and, for drift and byhand, a day cap.
// Why (28 Oct 2026, owner: "burn these tokens"; Gitar on #2375; 31 Oct 2026, owner: "CI can use up to 100%"): own tokens and usedPercent meter CI and the whole week; both refusal brakes stay at exhaustion.
export const CODEX_LIMIT_PCT = 100;
export const CLAUDE_LIMIT_PCT = 90;
/** The lines as /health says them (Why, 8 Nov 2026, gi: press-tapes.yml reads its lane's room from the broker instead of hard-coding 70%/800): Codex week per lane, the day caps, the Claude week. */
export const linesOf = lanes => ({week: Object.fromEntries(lanes.map(lane => [lane, CODEX_LIMIT_PCT])), daily: DAILY, claude: CLAUDE_LIMIT_PCT});
export const DAILY = {drift: 24, byhand: 800};   // Why (30 Oct 2026, owner, JOB-45; kept on 8 Nov 2026 when the 70% reserve went: it no longer protects a PR reserve, it still stops reruns and failed calls from running away): 20 stored-answer prompts + up to 4 judges per UTC day; the broker must stop reruns and failed calls from exceeding 24. byhand: "about 1 run a day" (owner, 8 Nov 2026), one 18-persona press is ~400-500 calls, so a second full run the same day is cut; press tapes share it (8 Nov 2026: ~45+ calls a persona, so about 6 personas a day).
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
  if (own >= CODEX_LIMIT_PCT) return {ok: false, why: `budget:own-share ${own.toFixed(1)}% of ${CODEX_LIMIT_PCT}% (${lane})`};
  if (weekUsedPercent != null && weekUsedPercent >= CODEX_LIMIT_PCT) return {ok: false, why: `budget:week ${weekUsedPercent}% of ${CODEX_LIMIT_PCT}% (${lane})`};
  return {ok: true};
}

/**
 * The Claude subscription's seven-day usage in percent, from the CLI's last rate_limit_event as stored ({sevenDay: {utilization 0..1, resetsAt epoch seconds}}), or null when unknown.
 * Unknown = never read, a shape that is not a fraction, no reset time, or a window already reset (the old reading says nothing about the new week): not a reason to stop, as for Codex. `now` is epoch seconds.
 */
export function claudeWeekPercent(limits, now = Date.now() / 1000) {
  const week = limits?.sevenDay;
  if (!week || !Number.isFinite(week.utilization) || week.utilization < 0 || week.utilization > 1) return null;
  if (!Number.isFinite(week.resetsAt) || week.resetsAt <= now) return null;   // a reading with no reset time could never expire: while Claude is shut nothing refreshes it (code-review, 8 Nov 2026)
  return Math.round(week.utilization * 1000) / 10;
}

/** Whether a Claude call may start now: {ok: true} or {ok: false, why: "budget:claude-week 91% of 90%"}. Every lane, a chosen-first Claude included. */
export const claudeAllow = weekPercent => weekPercent != null && weekPercent >= CLAUDE_LIMIT_PCT ? {ok: false, why: `budget:claude-week ${weekPercent}% of ${CLAUDE_LIMIT_PCT}%`} : {ok: true};
