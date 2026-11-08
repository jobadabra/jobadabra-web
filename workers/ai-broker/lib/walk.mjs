// The life of one AI call after the door (design "the life of one AI call", approved by the owner 8 Nov 2026: "Approve (Recommended)").
// States: waiting (the door, worker.js admit) -> on an engine -> answered | refused (the call's end) | cut by a deploy (the container's drain, container/server.mjs, and worker.js toContainer).
// An engine's turn ends in exactly one of four verdicts, and THIS file is the only place that decides where a call goes next:
//   answered     the call is done; the reply names its engine and the engines that did not answer (fellBack).
//   refused      final: a bad request, a lost login. No other engine would do differently, and the owner must see it.
//   unavailable  this engine cannot take the call now (out of quota, busy, shut, token invalid, not set up): the next engine.
//   failed       it took the call and broke (it stalled, exited badly, was at capacity, answered with something unusable): the next engine, and the engine's record counts it (lib/adapt.mjs demotes one that fails half its calls).
// A verdict may carry `reply`, the engine's own words; if nobody answers, the first such reply is the call's end (the real cause), else the caller's door-side explanation (worker.js ending).
// Why (8 Nov 2026, bd; 14 of the broker's 38 PRs that week patched this): "when does a call leave an engine" was decided in five places (codexStep, claudeStep, the Free AI step, answer()'s side-flags and lib/busy.mjs), each with its own flag.

export const answered = reply => ({verdict: 'answered', reply});
export const refused = reply => ({verdict: 'refused', reply});
/** `counted` false = nothing is added to the engine's day record (a check that never reached the engine). */
export const unavailable = (why, detail = '', counted = true, reply = null) => ({verdict: 'unavailable', why, detail, counted, reply});
export const failed = (why, detail = '', reply = null) => ({verdict: 'failed', why, detail, counted: true, reply});

/**
 * Walks `chain` in order. `take(engine, left, last)` returns a verdict, or null when the engine is not asked for this call (left unrecorded); `last` is true on the one extra turn of an engine that was only busy.
 * `note(engine, verdict, ms)` records the turn. Returns {engine, reply, left} when a turn ended the call, else {engine: null, reply: null, left, held}.
 * An engine that was only `busy` (all its slots taken past the wait) gets one more turn at the back of the line with no deadline: waiting for it beats an error.
 */
export async function walk(chain, take, note) {
  const left = [];   // the engines that did not answer, in order: [{engine, why, detail?}]
  let held = null, busy = null;
  const turn = async (engine, last) => {
    const started = Date.now(), v = await take(engine, left, last);
    if (!v) return null;
    await note(engine, v, Date.now() - started);
    if (v.verdict === 'answered' || v.verdict === 'refused') return {engine, reply: v.reply, left};
    left.push({engine, why: v.why, ...(v.detail ? {detail: v.detail} : {})});
    if (v.why === 'busy') busy = engine;
    held ||= v.reply;
    return null;
  };
  for (const engine of chain) { const done = await turn(engine, false); if (done) return done; }
  if (busy) { const done = await turn(busy, true); if (done) return done; }
  return {engine: null, reply: null, left, held};
}
