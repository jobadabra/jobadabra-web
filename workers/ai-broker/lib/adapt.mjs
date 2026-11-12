// Engines that do worse move back (JOB-202; owner, 1 Nov 2026: "adapt or report if one is doing worse than the other").
// Design: the two SUBSCRIPTION engines (codex, claude) are each in their normal place or demoted for 30 minutes. An engine is demoted when at least half of its last 10 real failures-or-answers
// were failures (at least 6 recorded; failures within one second of each other count once, BURST_MS): it goes behind the other subscription, the owner is told (Engineering, through the switchboard), /health shows it, and after 30 minutes it is tried first again with a fresh window.
// Never moved: Free AI (the fallback), a call that names its own engine, and anything counted as "ran out" (an empty allowance is not "worse"). Latency is reported in /health, never acted on: tiers and models differ and it is noisy.
import {SUBS} from './engines.mjs';
import {noteOnce, ADMIN_COSTS} from './fallback.mjs';

export const WINDOW = 10, MIN_RECORDED = 6, FAIL_SHARE = 0.5, DEMOTE_MS = 30 * 60 * 1000;
/** Failures of one engine this close together share one cause and count once. Why (12 Nov 2026, ba; log 17:05:39.48-.54Z): 8 parallel Codex calls ended together when a deploy took the container down, and five of them on top of five good calls were "5 of its last 10". PARALLEL (12) can fill the whole window in one instant. */
export const BURST_MS = 1000;
const off = env => String(env.ENGINE_ADAPT ?? '').trim() === 'off';

/** The subscription engines demoted at `now` (epoch ms); none when adapting is off. */
export async function demotedNow(storage, env, now = Date.now()) {
  if (off(env)) return [];
  const state = await storage.get('adapt') || {};
  return Object.entries(state.demoted || {}).filter(([, until]) => until > now).map(([engine]) => engine);
}

/** Records one real outcome of a subscription engine (ok = answered, !ok = failed) and demotes it when its recent window is bad. Other engines and other outcomes are ignored. */
export async function recordPerf(storage, env, engine, ok, now = Date.now()) {
  if (off(env) || !SUBS.includes(engine)) return;
  const verdict = await storage.transaction(async tx => {
    const state = await tx.get('adapt') || {};
    state.rings ||= {}; state.demoted ||= {}; state.lastFail ||= {};
    const ring = (state.rings[engine] ||= []);
    if (!ok && Math.abs(now - (state.lastFail[engine] ?? -Infinity)) < BURST_MS) return null;   // the same moment as a failure already counted
    if (!ok) state.lastFail[engine] = now;
    ring.push(ok ? 1 : 0);
    if (ring.length > WINDOW) ring.shift();
    const failed = ring.filter(result => !result).length;
    let demoted = null;
    if (ring.length >= MIN_RECORDED && failed / ring.length >= FAIL_SHARE && !(state.demoted[engine] > now)) {
      state.demoted[engine] = now + DEMOTE_MS;
      state.rings[engine] = [];   // a fresh window when it comes back
      demoted = {failed, of: ring.length};
    }
    await tx.put('adapt', state);
    return demoted;
  });
  if (verdict) await noteOnce(storage, env, new Date(now).toISOString().slice(0, 10), `adapt-${engine}-${Math.floor(now / DEMOTE_MS)}`, 'ai-broker-engine',
    `AI broker: ${engine} failed ${verdict.failed} of its last ${verdict.of} calls. The other subscription answers first for 30 minutes (if it is configured). /health shows it.`, ADMIN_COSTS);
}
