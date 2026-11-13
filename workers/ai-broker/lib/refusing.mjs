// "The broker refuses or fails its callers" as an alert (owner, 12 Nov 2026: "Do I get alerts if the ai-broker starts to refuse AI calls?" · "I should get alerts (medium/high criticality)" · "For now let's keep it like Telegram").
// Every call's end is classified here and fed to the shared sliding-window streak (shared/streak.js); the owner is told once when it opens (🔴) and once when it closes (🟢), through the switchboard like the broker's other notes.
// Who is told about: every caller of this Worker is a GitHub Actions job (README: "callers are CI jobs only"; /call needs a run token), so the text names the workflow tag the broker already records, never "people".
import {listOf} from '../../../shared/streak.js';
import {streakNote} from './streak-note.mjs';

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

export const short = workflow => String(workflow || 'unknown').replace(/^[^/]*\//, '');
export const clock = ms => new Date(ms).toISOString().slice(11, 16);
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
  await streakNote({storage, env, now, key: 'streak', prefix: 'refusing', event: 'ai-broker-refusing', call: {bad: outcome.bad, why: outcome.why, who: short(workflow)},
    down: async event => downText(event, await chain().catch(() => [])), up: upText});
}
