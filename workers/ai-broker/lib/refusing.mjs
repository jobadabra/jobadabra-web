// "The broker refuses or fails its callers" as an alert (owner, 12 Nov 2026: "Do I get alerts if the ai-broker starts to refuse AI calls?" · "I should get alerts (medium/high criticality)" · "For now let's keep it like Telegram").
// Every call's end is classified here and fed to the shared sliding-window streak (shared/streak.js); the owner is told once when it opens (🔴) and once when it closes (🟢), through the switchboard like the broker's other notes.
// Who is told about: every caller of this Worker is a GitHub Actions job (README: "callers are CI jobs only"; /call needs a run token), so the text names the workflow tag the broker already records, never "people".
import {step, newStreak, listOf} from '../../../shared/streak.js';
import {noteOnce, forgetNote, ADMIN_COSTS} from './fallback.mjs';

const RETRY_MS = 60_000;

/** What the walk said about a call that nobody answered: Response -> {left} (the engines that did not answer, lib/walk.mjs), set by worker.js answer(). A WeakMap, so concurrent calls never share it. */
export const ended = new WeakMap();

/**
 * Whether the engines' failures were only the platform cutting the container under the call (a deploy or restart; lib/walk.mjs platformCut) plus engines that simply could not take it.
 * Why (12 Nov 2026, ba #579 + bx; owner's brief: "A deploy or container restart cut is not a refusal"): a release takes the container down for a few minutes and every call in flight fails together; that says nothing about the broker's health.
 */
export const onlyCut = left => Array.isArray(left) && left.some(entry => entry.why === 'cut') && left.every(entry => ['cut', 'unavailable', 'ran-out', 'busy', 'budget'].includes(entry.why));

/** How a finished call counts: null (not at all: a caller's 400, a platform cut), {bad: false} (answered), or {bad: true, why} (refused or failed in a way the job feels: 429, 5xx, anything else that is not an answer). */
export async function outcomeOf(reply, left) {
  if (reply.ok) return {bad: false};
  if (reply.status === 400) return null;   // a malformed request is the caller's bug, not an outage
  if (onlyCut(left)) return null;
  const said = await reply.clone().json().catch(() => ({}));
  return {bad: true, why: String(said?.why || `HTTP ${reply.status}`).replace(/\s+/g, ' ').trim()};
}

const short = workflow => String(workflow || 'unknown').replace(/^[^/]*\//, '');
const clock = ms => new Date(ms).toISOString().slice(11, 16);
const enginesOf = chain => (chain || []).map(engine => `${engine.name} ${engine.configured ? `${engine.answeredToday} ok · ${engine.failedToday} failed today${engine.demotedUntil ? ' · moved behind' : ''}` : 'off'}`).join('; ');

/** The two messages, as the owner reads them in Telegram. */
export const downText = (event, chain) => {
  const total = event.ok + event.bad;
  return `🔴 AI broker refuses CI calls: ${event.bad} of ${total} in 5 min · why: ${event.whys.map(([why, n]) => `${why} ×${n}`).join(', ')} · CI jobs hit: ${listOf(event.who)} · engines: ${enginesOf(chain)}`;
};
export const upText = event => `🟢 AI broker answers again (the streak began ${clock(event.startedAt)} UTC; ${event.bad} of ${event.ok + event.bad} refused in the last 5 min)`;

/**
 * Records one call's end in the streak and sends the owner's note when it opens or closes. Never throws into the call: the caller logs.
 * `chain` is read only when a note is sent: () => Promise<[{name, configured, answeredToday, failedToday, demotedUntil?}]>.
 */
export async function noteCall({storage, env, reply, workflow, now = Date.now(), chain}) {
  const outcome = await outcomeOf(reply, ended.get(reply)?.left);
  if (!outcome) return;
  const day = new Date(now).toISOString().slice(0, 10);
  // One transaction decides what to send: the event this call opened or closed, else a note an earlier call could not deliver (at most one retry a minute, so a site that is down never slows every call).
  const todo = await storage.transaction(async tx => {
    const {state, event} = step(await tx.get('streak') || newStreak(), now, {bad: outcome.bad, why: outcome.why, who: short(workflow)});
    let next = null;
    if (event?.kind === 'up' && state.unsent?.kind === 'down' && state.unsent.startedAt === event.startedAt) delete state.unsent;   // nobody was told it began: no "again" either (shared/synthetic.js does the same)
    else if (event) { if (state.unsent?.kind === 'up') delete state.unsent; next = {event}; }
    else if (state.unsent && now >= state.unsent.retryAt) { state.unsent.retryAt = now + RETRY_MS; next = {retry: state.unsent}; }
    await tx.put('streak', state);
    return next;
  });
  if (!todo) return;
  const note = todo.retry || (todo.event.kind === 'down'
    ? {kind: 'down', startedAt: todo.event.startedAt, text: downText(todo.event, await chain().catch(() => []))}
    : {kind: 'up', startedAt: todo.event.startedAt, text: upText(todo.event)});
  const marker = note.kind === 'down' ? `refusing-${note.startedAt}` : `refusing-up-${note.startedAt}`;
  const delivered = await noteOnce(storage, env, day, marker, 'ai-broker-refusing', note.text, ADMIN_COSTS, note.kind === 'down' ? {state: 'down', level: 'problem'} : {state: 'up', level: 'ok'});
  // Why (12 Nov 2026, Gitar on #594): noteOnce takes its marker before the POST, so a site that could not be reached at the moment a streak opened would lose the 🔴 for good. The note is kept in the streak state and tried again on a later call.
  await storage.transaction(async tx => {
    const state = await tx.get('streak');
    if (!state) return;
    if (delivered) { if (state.unsent?.kind === note.kind && state.unsent.startedAt === note.startedAt) delete state.unsent; }
    else state.unsent = {...note, retryAt: now + RETRY_MS};
    await tx.put('streak', state);
  });
  if (!delivered) await forgetNote(storage, day, marker);
}
