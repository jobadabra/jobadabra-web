// Cloud browser runner 2/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): a night's task, and what a `readiness` night leaves on the site.
// A readiness night reads each form once (no fill, no press, no hold). Its read (flags and up to 30 required-question labels: page text, never the person's data) arrives in the night's `result`, is sealed with READY_KEK beside the batch
// (ready/<install>/read/<batch>/<job>.json, api/ready-kept.js), and is deleted the moment the app takes it (owner, 8 Nov 2026: "Site holds it, encrypted"; the option read "the app takes it and it's removed on the site"), or after a day.
// Invariants: a read is never logged, listed on an admin page or sent as an event (counts only: the rows hold state, a word and the time); only the owner's call opens it; taking it deletes it. Guard: test/unit/api/ready/ready-read.test.js.
import {open, seal} from './hosted-state.js';
import {keptKey} from './ready-kept.js';
import {LIVE} from './ready-line.js';

export const TASKS = ['fill', 'readiness'];   // the cloud runner's tasks; `auto` (Full automation, Submit) is not one until its own PR and gate (spec Safety line 2)
export const READ_OUTCOMES = ['read', 'unreadable', 'failed'];   // what a readiness night may report for a form; never a fill outcome, never "submitted"
export const MAX_READ_BYTES = 32 * 1024;   // 30 labels of 300 characters fit in a third of it
const MAX_TAKE = 100;
const label = install => `ready:${install}`;

/** Pure: the task a request names (none = `fill`, as every night before this change). -> the task, or null when it is not one of TASKS. */
export const taskOf = given => (given === undefined ? 'fill' : TASKS.includes(given) ? given : null);

/** Pure: a readiness night's result body, checked. -> {state, read, why} or null when it is not a readiness outcome (a fill outcome, an unknown word, a read that is not a plain object or is too large). */
export function checkRead(given) {
  const state = given?.state;
  if (!READ_OUTCOMES.includes(state)) return null;
  if (state !== 'read') return {state, read: null, why: String(given.why || '').slice(0, 40)};
  const read = given.read;
  // Why (code review of 2/4): a read that is not a plain object, or too large, is stored as unreadable with a word, never refused: the container ignores a 400, so the row would sit "reading" until the night's end.
  if (!read || typeof read !== 'object' || Array.isArray(read)) return {state: 'unreadable', read: null, why: 'bad read'};
  if (new TextEncoder().encode(JSON.stringify(read)).length > MAX_READ_BYTES) return {state: 'unreadable', read: null, why: 'too large'};
  return {state, read, why: ''};
}

/** Seals one job's read beside its batch (`row`: the night's batch row). */
export async function keepRead(env, row, job, read, now = new Date()) {
  const bytes = await seal(env, label(row.install), new TextEncoder().encode(JSON.stringify({read})), 'READY_KEK');
  await env.HOSTED_STATE.put(keptKey(row.install, 'read', row.id, job), bytes, {customMetadata: {at: now.toISOString()}});
}

// -> the read, null when the store has none (expired or never written: the app is told it is gone), or undefined when the store failed (a transient error: the read stays for the next call).
async function opened(env, install, batch, job) {
  try {
    const object = await env.HOSTED_STATE.get(keptKey(install, 'read', batch, job));
    return object ? JSON.parse(new TextDecoder().decode(await open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK'))).read || null : null;
  } catch { return undefined; }
}

/**
 * The owner's call: every read this install's readiness nights have ready, opened, and deleted from the site (the app takes it; it is not kept to be read twice). `clear` is ready.js's (a job's data and kept objects go; a night with
 * nothing left is closed). -> {ok, reads: [{job, night, state: read | unreadable | failed, read, why, ms}], pending: forms still being read}. A form still being read is not returned; `pending` says so the app asks again.
 */
export async function takeReads(env, install, clear, now = new Date()) {
  const {results} = await env.STATS.prepare(`SELECT j.batch, j.job, j.state, j.wall, j.ms, b.night FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch
    WHERE b.install = ? AND b.task = 'readiness' AND j.cleared_at IS NULL AND j.state IN ('read', 'unreadable', 'failed') ORDER BY b.created_at, j.job LIMIT ${MAX_TAKE}`).bind(install).all();
  const reads = [], taken = [];
  let retry = 0;
  for (const row of results) {
    const read = row.state === 'read' ? await opened(env, install, row.batch, row.job) : null;
    if (read === undefined) { retry++; continue; }   // Why (code review of 2/4): a store error must not delete a read the app never got; it stays, and `pending` says to ask again
    const lost = row.state === 'read' && !read;
    reads.push({job: row.job, night: row.night, state: lost ? 'unreadable' : row.state, read, why: lost ? 'gone' : row.wall || '', ms: row.ms ?? 0});
    taken.push(row);
  }
  for (const batch of new Set(taken.map(row => row.batch))) await clear(env, install, batch, taken.filter(row => row.batch === batch).map(row => row.job), now);
  const pending = (await env.STATS.prepare(`SELECT COUNT(*) AS n FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND b.task = 'readiness' AND j.cleared_at IS NULL AND j.state IN ${LIVE}`).bind(install).first()).n;
  return {ok: true, reads, pending: pending + retry};
}
