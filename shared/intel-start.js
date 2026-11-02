// On-time hourly start of the CI collectors that feed /admin/testing/e2e and /admin/testing/integrations (owner, 31 Oct 2026: "Start it from the Worker").
// GitHub's own `schedule:` in each collector's workflow is best-effort: 60 e2e-intel runs from 21 to 31 Oct came a median 4.5 h apart (up to 7.6 h gaps), so the page showed runs hours old, and
// integration-intel.yml had 0 schedule runs in its first 3 h (1 Nov 2026: the page read "No data yet"). Cloudflare's cron fires on time, so the Worker starts each workflow through the API;
// GitHub's cron stays as the backup (the workflow's concurrency group queues a second start, it never runs two at once).
// Same pattern as the public repo's app-core/src/scheduler.js (#2653). The Worker's account has no free cron trigger (5 of 5 used), so this shares the Worker's every-5-minutes trigger and
// acts on one tick an hour per collector. A new collector is one row below plus the same `run-name` and `workflow_dispatch:` in its workflow; the test loops over this list. Guard: test/shared/intel-start.test.js.

import {WEB_REPO} from './repos.js';

/** Why (1 Nov 2026, owner "delegate" on the empty integrations page): ONE list, so a collector cannot be added to the workflows and forgotten here (integration-intel.yml was).
 *  minute: the 5-minute tick (UTC) that starts it; backup: the minute of the workflow's own GitHub `cron`, always after `minute`. The minutes differ so two starts never share a tick. */
export const INTEL_COLLECTORS = [
  {workflow: 'e2e-intel.yml', minute: 40, backup: 41},
  {workflow: 'integration-intel.yml', minute: 15, backup: 17},
  // Why (1 Nov 2026, coordinator mac-07: /admin/testing/scheduled read "as of 15:02" at 18:41 while claiming "refreshed hourly"; GitHub ran it at 01:05, 07:29, 15:02): the Scheduled pages' own snapshot is a collector too, on the tick that was free.
  {workflow: 'schedules-snapshot.yml', minute: 0, backup: 3},
];

/** The collectors whose hourly tick is `date` (a 5-minute tick: at most one). */
export const dueCollectors = date => INTEL_COLLECTORS.filter(collector => collector.minute === date.getUTCMinutes());

/**
 * Starts every collector due at `now` on main of the repo that holds the workflows (this one, private). `dispatch(env, inputs, workflow)` is the Worker's (workers/www/index.js).
 * The repo is E2E_INTEL_REPO (default jobadabra/jobadabra-web) and the token MUST be E2E_INTEL_GITHUB_TOKEN (a fine-grained token on this repo, Actions: write; one token for every collector):
 * repo and token travel together, as in api/brain.js. Why (31 Oct 2026, Gitar on #240): the site's GITHUB_TOKEN is the public repo's (index.js dispatch), so falling back to it would answer 403/404
 * every hour, only as a log line, while the page quietly went back to GitHub's late schedule. Without the token the start is refused out loud (GitHub's own schedule stays the backup).
 * Resolves to one `{workflow, error?}` per due collector, never throws: one collector's refusal must not hide another's start. Off-tick it is [].
 */
export async function startIntelCollectors(env, now, dispatch) {
  return Promise.all(dueCollectors(now).map(async ({workflow}) => {
    try {
      if (!env.E2E_INTEL_GITHUB_TOKEN) throw new Error('E2E_INTEL_GITHUB_TOKEN is not set (the site GITHUB_TOKEN covers the public repo, not this one)');
      await dispatch({...env, GITHUB_REPO: env.E2E_INTEL_REPO || WEB_REPO, GITHUB_TOKEN: env.E2E_INTEL_GITHUB_TOKEN}, undefined, workflow);
      return {workflow};
    } catch (error) { return {workflow, error: error.message}; }
  }));
}

/**
 * Keeps each due collector's last start outcome (table intel_start, db/migrations/0119): a good start clears the row's problem, a refused one stores why. Why (1 Nov 2026, owner: "Red line on the
 * page"): the Worker had no E2E_INTEL_GITHUB_TOKEN, so neither collector was ever started and only a console line said so; the pages now show it. Never throws (a page line is not worth a failed tick).
 */
export async function recordStarts(db, results, now = new Date()) {
  if (!db || !results.length) return;
  try {
    await db.batch(results.map(({workflow, error}) => db.prepare('INSERT INTO intel_start (workflow, at, ok, reason) VALUES (?, ?, ?, ?) ON CONFLICT(workflow) DO UPDATE SET at = excluded.at, ok = excluded.ok, reason = excluded.reason')
      .bind(workflow, now.toISOString(), error ? 0 : 1, error ? String(error).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : '')));
  } catch (error) { console.error(`intel start record: ${error.message}`); }
}

/** Why the Worker's last start of `workflow` failed, {reason, at}; null when it succeeded, was never tried, or the table is unreadable. */
export async function readStartProblem(db, workflow) {
  try {
    const row = db ? await db.prepare('SELECT at, ok, reason FROM intel_start WHERE workflow = ?').bind(workflow).first() : null;
    return row && !row.ok ? {reason: row.reason || 'the start was refused', at: row.at} : null;
  } catch { return null; }
}
