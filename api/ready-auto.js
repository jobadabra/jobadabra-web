// Cloud browser runner 4/4, cs 2/4 (spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, section "auto"): what the site checks and keeps for a Full automation night, the `auto` task.
// Owner, 10 Nov 2026 (asked via AskUserQuestion with the sketch, relayed by the coordinator): "Build it now (Recommended)": a Pro account on Always on gets its jobs submitted by the cloud browser while its Mac is off;
// "~500/day + alert (Recommended)": an abuse ceiling only, about 500 cloud submits per install a day, the owner told once when one is hit. No normal daily limit (owner, 29 Oct 2026: "remove all checks").
// Invariants: each job of an `auto` batch carries the Mac's own queued item (its stamp); the site checks it and never makes, copies or fills in one, nor reads a setting. The press itself is the container's gate
// (desktop/ready-fill/submit-gate.js); the site only reserves each job's ONE attempt and counts it toward the ceiling, in one statement. An outcome is sealed and deleted once the app takes it. Guard: test/unit/api/ready/ready-auto.test.js.
import {open, seal} from './hosted-state.js';
import {keptKey} from './ready-kept.js';
import {LIVE} from './ready-line.js';
import {isPro} from './ready-read-access.js';
import {notify} from '../shared/notify.js';
import {installHit} from '../shared/install-caps.js';

export const OWN_SUBMITS = 500;   // the abuse-only ceiling per install and UTC day (owner, 10 Nov 2026: "~500/day + alert")
export const AUTO_OUTCOMES = ['submitted', 'not_submitted', 'unknown', 'failed'];   // what an auto night may report: pressed with a receipt, not pressed (why), pressed without a receipt, could not run
const LIVE_ITEM = ['queued', 'cloud'];   // the item states a press may still come from (submit-gate.js LIVE_STATES)
const MAX_OUTCOME_BYTES = 8 * 1024;
const MAX_TAKE = 100;
const num = value => (Number(value) > 0 ? Number(value) : 0);
const dayOf = now => now.toISOString().slice(0, 10);
const label = install => `ready:${install}`;
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const isTime = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)));

export const ownSubmits = env => num(env.READY_AUTO_MAX) || OWN_SUBMITS;

/** Who may queue or start an auto night: a Pro account with credit (Always on, not the owner's Ready to send), while READY_AUTO is on (default off: a kill switch). -> null, or {status, error}. */
export async function autoRefusal(env, install) {
  if (env.READY_AUTO !== 'on') return {status: 404, error: 'Full automation from the cloud is not available yet.'};
  if (!(await isPro(env, install))) return {status: 402, error: 'Full automation from the cloud is part of Pro.'};
  return null;
}

/**
 * Pure: one job's Full automation item as the Mac queued it, checked; the item's own stamp, never one the site makes. -> the item to seal (only these fields), or null.
 * The item must name this very job (its id and address), be live (queued or sent, no manual override), carry its mode, first-choice and confirmation stamps, its queueing time and its own wait.
 */
export function checkItem(job) {
  const item = job?.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (item.job !== job.id || item.url !== job.url || typeof item.session !== 'string' || !item.session || item.session.length > 100) return null;
  if (item.mode !== 'auto' || !LIVE_ITEM.includes(item.state) || item.manualOverride === true) return null;
  if (!isTime(item.chosenAt) || !isTime(item.autoConfirmedAt) || !isTime(item.queuedAt)) return null;
  if (typeof item.waitMin !== 'number' || !Number.isFinite(item.waitMin) || item.waitMin < 0 || item.waitMin > 120) return null;
  return {job: item.job, url: item.url, session: item.session, state: item.state, manualOverride: false, mode: 'auto', chosenAt: item.chosenAt, autoConfirmedAt: item.autoConfirmedAt,
    queuedAt: item.queuedAt, waitMin: item.waitMin, allowIneligible: item.allowIneligible === true};
}

/** Pure: the job's stage and kit eligibility as the Mac sent them with the item (a snapshot: the spec's "What the Mac adds"), beside the fill's kit. Only an explicit boolean is kept; anything else is unknown (null). */
export const kitOf = job => ({stage: text(job?.stage, 40), eligible: typeof job?.kit?.eligible === 'boolean' ? job.kit.eligible : null});

/**
 * POST /api/ready/reserve {job} (a night token of an auto night): takes the job's one attempt, then one of the install's day's cloud submits. -> {status, body: {ok, attempt} | {ok: false, error}}.
 * The attempt is the queued item's (install, the Mac's session, job), kept in ready_attempts that no night, Stop or sweep deletes: the same item is never reserved twice, in any night.
 * Refused: a night that is not running (capped, finished), READY_AUTO off or Pro lapsed since it started, a job no longer live, an item already pressed (`already`), the day's ~500 used (`ceiling`, the owner told once a day).
 * Every refusal is final: the container never presses; a job refused once it was reserved ends `not_submitted` with the reason.
 */
export async function reserve(env, row, given, now = new Date()) {
  const job = String(given?.job || ''), at = now.toISOString();
  if (row.task !== 'auto') return {status: 400, body: {ok: false, error: 'not an auto night'}};
  if (!/^[\w.:-]{1,64}$/.test(job)) return {status: 400, body: {ok: false, error: 'bad job'}};
  if (row.state !== 'running') return {status: 409, body: {ok: false, error: 'stopped'}};   // Why (code review of cs 2/4): a capped night answered ok and counted the slot
  const off = await autoRefusal(env, row.install);   // checked at each press, not only at the batch: the kill switch and a lapsed Pro stop a night already queued
  if (off) return {status: off.status, body: {ok: false, error: 'off'}};
  const attempt = crypto.randomUUID();
  const taken = await env.STATS.prepare(`UPDATE ready_jobs SET attempt = ?, at = ? WHERE batch = ? AND job = ? AND attempt IS NULL AND session IS NOT NULL AND cleared_at IS NULL AND state IN ${LIVE}`).bind(attempt, at, row.id, job).run();
  if (!taken.meta?.changes) return {status: 409, body: {ok: false, error: 'already'}};
  const end = (wall, status, error) => env.STATS.prepare("UPDATE ready_jobs SET state = 'not_submitted', wall = ?, at = ?, step = NULL, step_n = NULL WHERE batch = ? AND job = ?").bind(wall, at, row.id, job).run()
    .then(() => ({status, body: {ok: false, error}}));
  try {
    const owned = await env.STATS.prepare('INSERT INTO ready_attempts (install, session, job, attempt, batch, at) SELECT ?, session, job, ?, batch, ? FROM ready_jobs WHERE batch = ? AND job = ? ON CONFLICT DO NOTHING')
      .bind(row.install, attempt, at, row.id, job).run();
    if (!owned.meta?.changes) return end('already', 409, 'already');   // this queued item was pressed in another night
    const day = dayOf(now), max = ownSubmits(env);
    // Why (10 Nov 2026, owner "~500/day + alert"): one statement takes the slot, so two jobs cannot both slip under the ceiling; the attempt above stays used either way (a refused job is never tried again).
    const counted = await env.STATS.prepare('INSERT INTO ready_read_days (install, day, submits) VALUES (?, ?, 1) ON CONFLICT (install, day) DO UPDATE SET submits = submits + 1 WHERE submits + 1 <= ? RETURNING submits').bind(row.install, day, max).first();
    await submitsHit(env, row.install, counted?.submits ?? null, max, now);
    if (counted) return {status: 200, body: {ok: true, attempt}};
    const told = await env.STATS.prepare('UPDATE ready_read_days SET submits_alerted = 1 WHERE install = ? AND day = ? AND submits_alerted = 0').bind(row.install, day).run().catch(() => null);
    if (told?.meta?.changes) await notify(env, {event: 'ready-submit-ceiling', text: `☁️ A cloud Full automation install reached its abuse ceiling today (${max} submits): ${row.install.slice(0, 8)}. Cloud submits stop until 00:00 UTC; a real user does not send this many applications.`}).catch(() => {});
    return end('ceiling', 429, 'ceiling');
  } catch {
    return end('reserve', 503, 'reserve failed');   // never pressed: told as not sent, never "check the employer's page"
  }
}

/** Pure: an auto night's result body, checked. -> {state, why, outcome} (outcome: what is sealed for the app: the attempt and the page's own proof, no field value) or null. */
export function checkSubmit(given) {
  if (!AUTO_OUTCOMES.includes(given?.state)) return null;
  const proof = given.proof && typeof given.proof === 'object' && !Array.isArray(given.proof) ? given.proof : {};
  const outcome = {state: given.state, why: text(given.why, 40), attempt: text(given.attempt, 64),
    proof: {signature: text(proof.signature, 200), submitControl: text(proof.submitControl, 200), requiredComplete: proof.requiredComplete === true, botCheck: typeof proof.botCheck === 'boolean' ? proof.botCheck : null}};
  if (new TextEncoder().encode(JSON.stringify(outcome)).length > MAX_OUTCOME_BYTES) return null;
  return {state: given.state, why: outcome.why, outcome};
}

/** Seals one job's outcome beside its batch (`row`: the night's batch row). */
export async function keepSubmit(env, row, job, outcome, now = new Date()) {
  const bytes = await seal(env, label(row.install), new TextEncoder().encode(JSON.stringify({outcome})), 'READY_KEK');
  await env.HOSTED_STATE.put(keptKey(row.install, 'submit', row.id, job), bytes, {customMetadata: {at: now.toISOString()}});
}

/**
 * The app takes its auto outcomes: opened, returned once and deleted from the site (with the job's data, through ready.js's `clear`). A store error leaves the outcome for the next call (`pending`).
 * -> {submits: [{job, night, state, why, outcome, ms}], pending}.
 */
export async function takeSubmits(env, install, clear, now = new Date()) {
  const {results} = await env.STATS.prepare(`SELECT j.batch, j.job, j.state, j.wall, j.ms, b.night FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch
    WHERE b.install = ? AND b.task = 'auto' AND j.cleared_at IS NULL AND j.state IN ('submitted', 'not_submitted', 'unknown', 'failed') ORDER BY b.created_at, j.job LIMIT ${MAX_TAKE}`).bind(install).all();
  const submits = [], taken = [];
  let retry = 0;
  for (const row of results) {
    let outcome = null;
    try {
      const object = await env.HOSTED_STATE.get(keptKey(install, 'submit', row.batch, row.job));
      outcome = object ? JSON.parse(new TextDecoder().decode(await open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK'))).outcome || null : null;
    } catch { retry++; continue; }
    const lost = !outcome && ['submitted', 'unknown'].includes(row.state);   // a press whose sealed outcome is gone: the person checks, never a silent "submitted" without its proof
    submits.push({job: row.job, night: row.night, state: lost ? 'unknown' : row.state, why: lost ? 'gone' : row.wall || '', outcome, ms: row.ms ?? 0});
    taken.push(row);
  }
  for (const batch of new Set(taken.map(row => row.batch))) await clear(env, install, batch, taken.filter(row => row.batch === batch).map(row => row.job), now);
  const pending = (await env.STATS.prepare(`SELECT COUNT(*) AS n FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND b.task = 'auto' AND j.cleared_at IS NULL AND j.state IN ${LIVE}`).bind(install).first()).n;
  return {submits, pending: pending + retry};
}

/**
 * A `submitted` or `unknown` outcome stands only for the job's own reserved attempt. Without it (no reservation, another attempt id) the press was not one the site allowed: it becomes `unknown` (no attempt),
 * so the person is asked to check the employer's page, never told it failed or went through. Changes `checked` in place.
 */
export async function claimAttempt(env, row, job, checked) {
  if (!['submitted', 'unknown'].includes(checked.state)) return;
  const found = await env.STATS.prepare('SELECT attempt FROM ready_jobs WHERE batch = ? AND job = ?').bind(row.id, job).first();
  if (found?.attempt && found.attempt === checked.outcome.attempt) return;
  checked.state = 'unknown'; checked.why = 'no attempt'; checked.outcome = {...checked.outcome, state: 'unknown', why: 'no attempt'};
}

// Why (13 Nov 2026, owner, "Grouped hourly (Recommended)"): an install near (80%) or at its ~500 submits is counted for the hourly card (shared/install-caps.js); the once-a-day note stays.
// Never throws: a count must not refuse a submit.
// `submits` = today's count after this one (from RETURNING, #625), or null when the ceiling refused it.
async function submitsHit(env, install, submits, max, now) {
  try { await installHit(env, 'cloud-submit-ceiling', install, submits, max, {now, reached: submits == null}); } catch { /* an alert never refuses a submit */ }
}
