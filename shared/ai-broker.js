// The AI broker as the site sees it (owner, 1 Nov 2026: "Claude, Codex or Free AI by one flag"): one read of its public /health through the service binding, and what that answer means.
// One reader for the cost page and the synthetic probe, so the two cannot disagree about which engine is up. Never sends a prompt, a login or a provider key.

/** The engines' names for people; the order is the broker's own chain order. Why (3 Nov 2026): `claude-api` stays only to name past days' tallies; the broker no longer has that engine. */
export const ENGINE_NAMES = {codex: 'Codex', claude: 'Claude', 'claude-api': 'Claude API', 'free-ai': 'Free AI'};

/** GET /health through the `AI_BROKER` service binding; the caller handles a missing binding, a timeout and a non-200. */
export const fetchHealth = (env, ms) => env.AI_BROKER.fetch(new Request('https://broker/health', {signal: AbortSignal.timeout(ms)}));

/** The chain from a health answer: [{name, configured, state?, answeredToday, ranOutToday, failedToday, avgMs, demotedUntil?}], or null when this broker build has none. */
export const chainOf = health => (Array.isArray(health?.chain) && health.chain.every(item => item && typeof item.name === 'string') ? health.chain : null);

/**
 * What is wrong with the chain, in the owner's words, or '' when it is fine (or unknown: an older build without a chain is never red).
 * Why (2 Nov 2026): a rejected Claude token moves every call to Free AI without any error, so it is told; Codex being used up is normal and is not a problem.
 */
export function problem(chain) {
  if (!chain) return '';
  if (chain.some(item => item.name === 'claude' && item.configured && item.state === 'token-invalid')) return 'Claude token rejected';
  return chain.some(item => item.configured) ? '' : 'no AI engine can answer';
}

/** The per-workflow tally from a health answer: {days: {<YYYY-MM-DD>: {<workflow>: {calls, ok, tokens, ms, engines}}}}, or null when this broker build has none (an older one). */
export const tallyOf = health => (health?.tally && typeof health.tally.days === 'object' && health.tally.days !== null ? health.tally : null);

/**
 * The subscription windows from a health answer, as the providers report them: {codex: {usedPercent, resetsAt} | null, claude: {status, fiveHour, sevenDay} | null}.
 * Times are epoch seconds. Claude's `utilization` is a fraction 0..1 (measured on the real CLI, 1 Nov 2026, workers/ai-broker/container/claude.mjs); anything else is dropped, never guessed.
 */
export function subscriptionOf(health) {
  const win = w => (w && Number.isFinite(w.utilization) && w.utilization >= 0 && w.utilization <= 1 && Number.isFinite(w.resetsAt)
    ? {utilization: w.utilization, resetsAt: w.resetsAt, status: typeof w.status === 'string' ? w.status : ''} : null);
  const week = health?.limits, claude = Array.isArray(health?.chain) ? health.chain.find(item => item?.name === 'claude')?.limits : null;
  return {
    codex: week && Number.isFinite(week.usedPercent) && Number.isFinite(week.resetsAt) ? {usedPercent: week.usedPercent, resetsAt: week.resetsAt} : null,
    claude: claude ? {status: typeof claude.status === 'string' ? claude.status : '', fiveHour: win(claude.fiveHour), sevenDay: win(claude.sevenDay)} : null,
  };
}
