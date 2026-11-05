// Hosted Always on, the cron side (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §1, §5): every 5 minutes (the one existing cron) the Worker scans due schedules, applies the guards, and puts one
// message per run on the Queue (env.HOSTED_QUEUE); the runner Worker (workers/hosted-runner) starts the container. The Worker only enqueues. Guard: test/unit/shared/hosted/hosted-guards.test.js.
import {digestOf} from '../shared/guard.js';
import {hostedOn, INACTIVE_DAYS, startRun} from '../shared/hosted.js';
import {monthStopUsd, trialUsd} from '../shared/free-ai.js';

export const BATCH = 50, MONTH_COMPUTE_MICRO = 1_500_000, SITE = 'https://www.jobadabra.top';
const DAY = 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000;
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
const count = async (kv, key) => Number(kv ? await kv.get(key) : 0) || 0;

/** Whether the Free AI day or month stop is reached (one definition for the tick and the test run; both apply it to trial runs only). */
export async function freeStopped(env, stamp) {
  const day = stamp.slice(0, 10), month = day.slice(0, 7);
  return await count(env.WAITLIST, `freeai:usd:${day}`) >= num(env.FREE_AI_STOP_USD, 10) * 1e6 || await count(env.WAITLIST, `freeai:usdm:${month}`) >= monthStopUsd(env) * 1e6;
}
/** Whether this install's lifetime trial budget ($2 by default) is spent. */
export async function trialSpent(env, install) { return await count(env.WAITLIST, `freeai:life:${await digestOf(install)}`) >= trialUsd(env) * 1e6; }
/** Runs started today, all and trial ones: against HOSTED_MAX_RUNS_DAY and HOSTED_TRIAL_MAX_RUNS_DAY. */
export async function runsToday(env, day) {
  const row = await env.STATS.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN a.plan = ? THEN 1 ELSE 0 END) AS trial FROM hosted_runs r JOIN pro_accounts a ON a.id = r.account WHERE r.started_at >= ?').bind('trial', `${day}T00:00:00`).first();
  return {all: row.n || 0, trial: row.trial || 0};
}
/** This month's compute debited to an account, micro-USD: at MONTH_COMPUTE_MICRO the account is paused as 'guard'. */
export async function monthSpent(env, account, day) {
  return (await env.STATS.prepare('SELECT COALESCE(SUM(compute_micro), 0) AS micro FROM hosted_runs WHERE account = ? AND started_at >= ?').bind(account, `${day.slice(0, 7)}-01`).first()).micro;
}
/** Whether a run of this account is open (started, unfinished, its token not expired). */
export async function openRun(env, account, stamp) {
  return env.STATS.prepare('SELECT id FROM hosted_runs WHERE account = ? AND finished_at IS NULL AND expires_at > ?').bind(account, stamp).first();
}
export const dayCaps = env => ({all: num(env.HOSTED_MAX_RUNS_DAY, 2000), trial: num(env.HOSTED_TRIAL_MAX_RUNS_DAY, 1500)});

async function pause(env, schedule, reason, now) {
  await env.STATS.prepare("UPDATE hosted_schedules SET state = 'paused', pause_reason = ? WHERE account = ?").bind(reason, schedule.account).run();
  return reason;
}

// -> {enqueued, paused: {reason: n}, held} (held: due but kept for the next tick by a global cap).
export async function tick(env, now = new Date()) {
  const out = {enqueued: 0, paused: {}, held: 0};
  if (!hostedOn(env) || !env.STATS) return out;
  const stamp = now.toISOString(), day = stamp.slice(0, 10);
  // A run that never posted (container crashed, Worker restarted) is failed once its token has expired, so its slot is not stuck.
  await env.STATS.prepare("UPDATE hosted_runs SET status = 'failed', finished_at = ? WHERE finished_at IS NULL AND expires_at < ?").bind(stamp, stamp).run();
  const {results: due} = await env.STATS.prepare(`SELECT s.account, s.install, s.freq_hours, s.next_run_at, s.last_seen_at, a.plan, a.status AS payment FROM hosted_schedules s JOIN pro_accounts a ON a.id = s.account
    WHERE s.state = 'on' AND s.next_run_at <= ? ORDER BY s.next_run_at LIMIT ?`).bind(stamp, BATCH).all();
  const today = await runsToday(env, day);
  let allToday = today.all, trialToday = today.trial;
  const freeIsStopped = await freeStopped(env, stamp);
  for (const schedule of due) {
    const trial = !(schedule.plan === 'pro' && schedule.payment === 'active');
    const note = async reason => { out.paused[reason] = (out.paused[reason] || 0) + 1; await pause(env, schedule, reason, now); };
    if (now.getTime() - Date.parse(schedule.last_seen_at) > INACTIVE_DAYS * DAY) { await note('inactive'); continue; }
    if (trial && await trialSpent(env, schedule.install)) { await note('trial-over'); continue; }
    if (await monthSpent(env, schedule.account, day) >= MONTH_COMPUTE_MICRO) { await note('guard'); continue; }
    if (allToday >= dayCaps(env).all || (trial && (trialToday >= dayCaps(env).trial || freeIsStopped))) { out.held++; continue; }
    if (!env.HOSTED_QUEUE) { out.held++; continue; }
    const run = await startRun(env, schedule, now, undefined, true);
    if (!run && await openRun(env, schedule.account, stamp)) continue;   // a run is open (the person's Test): its schedule is not moved, the next tick asks again
    // Whether or not the slot was new, the schedule moves on; a slot that already has a run is never started twice.
    await env.STATS.prepare('UPDATE hosted_schedules SET next_run_at = ? WHERE account = ?').bind(new Date(now.getTime() + schedule.freq_hours * HOUR).toISOString(), schedule.account).run();
    if (!run) continue;
    await env.HOSTED_QUEUE.send({run: run.id, token: run.token, site: env.HOSTED_SITE || SITE, account: await digestOf(schedule.account)});
    out.enqueued++; allToday++; if (trial) trialToday++;
  }
  return out;
}
