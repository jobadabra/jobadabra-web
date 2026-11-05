// The Durable Object's side of "one Codex conversation per persona run" (spec docs/superpowers/specs/2026-11-05-broker-codex-resume-design.md): who may have one, what state each is in, and what a call of one counts.
// Why (5 Nov 2026, [bf], owner: "that context should be only once, at the start of the session"): every Codex call opened a new thread and paid its ~12k fixed context again (16.4k tokens a call, 15 steps in a 250k run). Measured the same day: resumed turns cost 194-3,716 uncached tokens and hit the cache 4 of 4 times, fresh ones 2 of 5.
// Design: states none -> open -> warm -> ended | lost. ONE owner, the Durable Object's `sessions` record; the container only holds the files and says what it could not find.
import {workflowOf} from './tally.mjs';

/** Only these workflows (from the verified run token, as "<repo>/<file>") may keep a conversation. Everyone else's calls stay fresh and counted in full, exactly as before. */
export const RESUME_WORKFLOWS = ['jobadabra/ai-user-agents.yml'];
/** A conversation idle this long restarts from the full prompt (below the container's own sleep and the model-side cache's life). */
export const IDLE_MS = 5 * 60_000;
/** Turns one conversation takes before it restarts: its context only grows. */
export const TURN_CAP = 120;
const KEEP_MS = 60 * 60_000, MAX_RECORDS = 50;
const ID = /^[a-z0-9-]{1,40}$/, KEY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+\.\d+#[a-z0-9-]{1,40}$/;

/**
 * The key of the conversation a verified run token and the caller's session id name; '' when this call may not have one (not a persona workflow, no run id, a bad id).
 * Takes the verified claims and the id the caller sent. The key is built from the signed claims (repository, run id and attempt), so no other run or caller can reach it.
 */
export function sessionKeyOf(claims, id) {
  if (!RESUME_WORKFLOWS.includes(workflowOf(claims)) || typeof id !== 'string' || !ID.test(id)) return '';
  const run = String(claims?.run_id || ''), attempt = String(claims?.run_attempt || '1');
  return /^\d+$/.test(run) && /^\d+$/.test(attempt) ? `${claims.repository}#${run}.${attempt}#${id}` : '';
}

/** Takes the header value the Worker set; returns it when it has the shape of a key built by sessionKeyOf, else ''. */
export const sessionKey = value => (KEY.test(String(value || '')) ? String(value) : '');

/**
 * What the next call of a conversation does: {expect: 'none'} opens one, {expect: 'warm'} resumes it, {expect: 'none', restart: why} replaces it.
 * Takes the stored record (undefined = none) and {now, tier, delta}. A record that is idle, full, of another tier, or called without a new turn is replaced from the full prompt, never trusted.
 */
export function planOf(record, {now, tier, delta}) {
  if (!record) return {expect: 'none'};
  if (record.tier !== tier) return {expect: 'none', restart: 'tier'};
  if (now - record.lastUsed > IDLE_MS) return {expect: 'none', restart: 'idle'};
  if (record.turns >= TURN_CAP) return {expect: 'none', restart: 'turn-cap'};
  if (typeof delta !== 'string' || !delta) return {expect: 'none', restart: 'no-delta'};
  return {expect: 'warm'};
}

/**
 * The records after one answered turn. Takes the stored records, the key and {now, tier, mode} (the container's word for what the turn did: opened, resumed, restarted, ended).
 * `ended` deletes the record; old and surplus records are forgotten here, so the stored value stays small (one storage value holds at most 128 KiB).
 */
export function settle(records, key, {now, tier, mode}) {
  const next = {...records};
  if (mode === 'ended') delete next[key];
  else if (mode === 'resumed' && next[key]) next[key] = {...next[key], turns: next[key].turns + 1, lastUsed: now};
  else next[key] = {tier, turns: 1, openedAt: now, lastUsed: now};   // opened or restarted (or a resume the record had lost): a conversation of one turn
  for (const [name, record] of Object.entries(next)) if (now - record.lastUsed > KEEP_MS) delete next[name];
  for (const [name] of Object.entries(next).sort((a, b) => b[1].lastUsed - a[1].lastUsed).slice(MAX_RECORDS)) delete next[name];
  return next;
}

/**
 * What a Codex call counts against the week and the caller's cap: input minus cached plus output for a call that keeps a conversation (the cached part is the conversation's context paid once), input plus output for every other call.
 * Takes the answer's per-call tokens {input, cached?, output} and whether the call is a conversation's.
 */
export function countedOf(tokens, kept) {
  const input = Number.isFinite(tokens?.input) ? tokens.input : 0, output = Number.isFinite(tokens?.output) ? tokens.output : 0, cached = Number.isFinite(tokens?.cached) ? tokens.cached : 0;
  return kept ? Math.max(0, input - cached) + output : input + output;
}

/** One turn at a time per key: takes nothing, returns acquire(key) -> Promise<release>. Calls of different keys never wait for each other. */
export function keyedLock() {
  const tails = new Map();
  return key => {
    const before = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise(resolve => { release = resolve; });
    const tail = before.then(() => mine);
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return before.then(() => release);
  };
}
