// One owner alert on the shared streak (shared/streak.js): one observation in, the 🔴 when the streak opens and the 🟢 when it closes out, through the switchboard.
// Used by the refusal alert (lib/refusing.mjs) and the wait alert (lib/waiting.mjs), so the two cannot differ in how a note is sent, kept or tried again.
import {step, newStreak} from '../../../shared/streak.js';
import {noteOnce, forgetNote, ADMIN_COSTS} from './fallback.mjs';

const RETRY_MS = 60_000;

/**
 * Records `call` ({bad, why?, who?}) in the streak stored under `key` and delivers the note it opened or closed, or an earlier note that could not be delivered.
 * `prefix` names the day's markers, `event` the switchboard's registry event (shared/notify-registry.js); `down(event)` -> Promise<text>, `up(event)` -> text.
 * `minCalls` and `share` are the streak's line (shared/streak.js step). Never throws into a call on purpose: the caller logs.
 */
export async function streakNote({storage, env, now, key, prefix, event: name, call, minCalls, share, down, up}) {
  const day = new Date(now).toISOString().slice(0, 10);
  // One transaction decides what to send: the event this call opened or closed, else a note an earlier call could not deliver (at most one retry a minute, so a site that is down never slows every call).
  const todo = await storage.transaction(async tx => {
    const {state, event} = step(await tx.get(key) || newStreak(), now, call, minCalls, share);
    let next = null;
    if (event?.kind === 'up' && state.unsent?.kind === 'down' && state.unsent.startedAt === event.startedAt) delete state.unsent;   // nobody was told it began: no "again" either (shared/synthetic.js does the same)
    else if (event) { if (state.unsent?.kind === 'up') delete state.unsent; next = {event}; }
    else if (state.unsent && now >= state.unsent.retryAt) { state.unsent.retryAt = now + RETRY_MS; next = {retry: state.unsent}; }
    await tx.put(key, state);
    return next;
  });
  if (!todo) return;
  const note = todo.retry || (todo.event.kind === 'down'
    ? {kind: 'down', startedAt: todo.event.startedAt, text: await down(todo.event)}
    : {kind: 'up', startedAt: todo.event.startedAt, text: up(todo.event)});
  const marker = note.kind === 'down' ? `${prefix}-${note.startedAt}` : `${prefix}-up-${note.startedAt}`;
  const delivered = await noteOnce(storage, env, day, marker, name, note.text, ADMIN_COSTS, note.kind === 'down' ? {state: 'down', level: 'problem'} : {state: 'up', level: 'ok'});
  // Why (12 Nov 2026, Gitar on #594): noteOnce takes its marker before the POST, so a site that could not be reached at the moment a streak opened would lose the 🔴 for good. The note is kept in the streak state and tried again on a later call.
  await storage.transaction(async tx => {
    const state = await tx.get(key);
    if (!state) return;
    if (delivered) { if (state.unsent?.kind === note.kind && state.unsent.startedAt === note.startedAt) delete state.unsent; }
    else state.unsent = {...note, retryAt: now + RETRY_MS};
    await tx.put(key, state);
  });
  if (!delivered) await forgetNote(storage, day, marker);
}
