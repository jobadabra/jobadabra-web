// Room at the broker by claim: each workflow run asks once for the searches it needs, first come first served, and holds them until it releases or stops renewing.
// Design (13 Nov 2026, owner via sa: "each workflow should take its necessary slots." · "Then a new pair schedules, it nows it needs 4 slots. If there is room. it takes it" ·
//   "First come, first serve" · "But each one should take its necessary slots" · "Not everyhting that's available"; he refused a reserved share): ONE owner of room, this
//   Durable Object's storage. A run is who (its workflow file and run id, from its verified GitHub token, never a name it sends). ask(): renews a held claim, keeps a waiting
//   place, or joins the line at its end; the line is granted in order while the head fits (a big claim at the head is never passed by a smaller one). release() frees it.
//   A held claim lives HELD_MS from its last ask, a waiting place WAITING_MS, so a cancelled run frees its room by itself. No lanes, no priority, nobody gets more than it asked.

// Why (13 Nov 2026, sa's two measures): 10 app-tier searches at once ran valid at 02:16Z (24 slots, CPU 3.94 of 4), but 7 starved the broker at 03:28Z (5 of 44 Claude
// calls waited over 30 s). One constant, raised only on a new measure.
export const CAPACITY = 6;
export const HELD_MS = 10 * 60_000;   // a run renews every 3 min while it searches (tools/persona-search/claim.py)
export const WAITING_MS = 60_000;     // a waiting run asks again every 15 s

import {workflowOf} from './tally.mjs';

const empty = () => ({held: [], waiting: []});

/** Drops claims and places whose run stopped asking; returns a new state. */
export function prune(state, now) {
  const s = state || empty();
  return {held: (s.held || []).filter(c => now - c.seen < HELD_MS), waiting: (s.waiting || []).filter(c => now - c.seen < WAITING_MS)};
}

/** Grants the line in order while its head fits under CAPACITY. Invariant: the sum of held needs never exceeds CAPACITY. */
function grant(state, now) {
  let used = state.held.reduce((sum, c) => sum + c.need, 0);
  while (state.waiting.length && used + state.waiting[0].need <= CAPACITY) {
    const next = state.waiting.shift();
    used += next.need;
    state.held.push({who: next.who, need: next.need, since: now, seen: now});
  }
  return state;
}

/**
 * One ask by `who` for `need` searches at once: {state, status, reply}. 200 = granted (also a renewal), 202 = waiting in line, 400 = a need outside 1..CAPACITY.
 * A run that already holds keeps its first need: a renewal never grows a claim.
 */
export function ask(state, who, need, now) {
  if (!Number.isInteger(need) || need < 1 || need > CAPACITY) return {state, status: 400, reply: {error: `need: a whole number of searches from 1 to ${CAPACITY}`}};
  const s = prune(state, now);
  const mine = s.held.find(c => c.who === who);
  if (mine) {
    mine.seen = now;
    return {state: s, status: 200, reply: {granted: true, need: mine.need, expires: now + HELD_MS, capacity: CAPACITY}};
  }
  const place = s.waiting.find(c => c.who === who);
  if (place) place.seen = now;
  else s.waiting.push({who, need, since: now, seen: now});
  grant(s, now);
  const held = s.held.find(c => c.who === who);
  if (held) return {state: s, status: 200, reply: {granted: true, need: held.need, expires: now + HELD_MS, capacity: CAPACITY}};
  const at = s.waiting.findIndex(c => c.who === who);
  return {state: s, status: 202, reply: {granted: false, position: at + 1, capacity: CAPACITY, held: s.held.map(c => ({who: c.who, need: c.need})), ahead: s.waiting.slice(0, at).map(c => ({who: c.who, need: c.need}))}};
}

/** `who` leaves (held or waiting); the line moves on. Releasing nothing is fine (a run's end step always releases). */
export function release(state, who, now) {
  const s = prune(state, now);
  const was = s.held.some(c => c.who === who) || s.waiting.some(c => c.who === who);
  s.held = s.held.filter(c => c.who !== who);
  s.waiting = s.waiting.filter(c => c.who !== who);
  grant(s, now);
  return {state: s, status: 200, reply: {released: was}};
}

/** What /health shows: the capacity, who holds what, who waits in which order. */
export function view(state, now) {
  const s = prune(state, now);
  const at = c => new Date(c.since).toISOString();
  return {capacity: CAPACITY, used: s.held.reduce((sum, c) => sum + c.need, 0), held: s.held.map(c => ({who: c.who, need: c.need, since: at(c), expires: new Date(c.seen + HELD_MS).toISOString()})),
    waiting: s.waiting.map(c => ({who: c.who, need: c.need, since: at(c)}))};
}

/** The run a verified GitHub token names: "<repo>/<workflow file>#<run id>" (lib/tally.mjs workflowOf, the signed run_id). Never a name the caller sends. */
export const whoOf = claims => `${workflowOf(claims)}#${/^\d+$/.test(String(claims?.run_id || '')) ? claims.run_id : 'unknown'}`;

/** The Durable Object's side: POST asks (body {"need": n}), DELETE releases; `who` comes from the outer Worker's verified token only. One read and one write of storage. */
export async function claimFetch(storage, request, who, now = Date.now()) {
  let need; try { need = request.method === 'DELETE' ? 0 : (await request.json()).need; } catch { need = undefined; }
  // Invariant: no await but storage between the read and the write, so the object's input gate keeps two asks from reading the same line.
  const before = await storage.get('claims');
  const result = request.method === 'DELETE' ? release(before, who, now) : ask(before, who, need, now);
  await storage.put('claims', result.state);
  return Response.json(result.reply, {status: result.status});
}
