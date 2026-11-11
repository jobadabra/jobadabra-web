// On-time hourly start of the CI collectors that feed /admin/testing/e2e and /admin/testing/integrations (owner, 31 Oct 2026: "Start it from the Worker").
// GitHub's own `schedule:` in each collector's workflow is best-effort: 60 e2e-intel runs from 21 to 31 Oct came a median 4.5 h apart (up to 7.6 h gaps), so the page showed runs hours old, and
// integration-intel.yml had 0 schedule runs in its first 3 h (1 Nov 2026: the page read "No data yet"). Cloudflare's cron fires on time, so the Worker starts each workflow through the API;
// GitHub's cron stays as the backup (the workflow's concurrency group queues a second start, it never runs two at once).
// Same pattern as the public repo's app-core/src/scheduler.js (#2653). The Worker's account has no free cron trigger (5 of 5 used), so this shares the Worker's every-5-minutes trigger and
// acts on one tick an hour per collector. A new collector is one row below plus the same `run-name` and `workflow_dispatch:` in its workflow; the test loops over this list. Guard: test/unit/shared/intel-start.test.js.

import {LAB_REPO, WEB_REPO} from './repos.js';

/** Why (1 Nov 2026, owner "delegate" on the empty integrations page): ONE list, so a collector cannot be added to the workflows and forgotten here (integration-intel.yml was).
 *  minute: the 5-minute tick (UTC) that starts it; backup: the minute of the workflow's own GitHub `cron`, always after `minute`. The minutes differ so two starts never share a tick.
 *  home: 'public' = the workflow lives in the public repo (TIMERS_REPO, token TIMERS_GITHUB_TOKEN), 'web' = in this repo (E2E_INTEL_REPO, token E2E_INTEL_GITHUB_TOKEN).
 *  home 'lab' = the workflow lives in jobadabra-lab (BRAIN_REPO, token BRAIN_GITHUB_TOKEN: the pair that already starts the lab's product-brain.yml, api/brain.js). hours: optional UTC hours it runs at (default: every hour).
 *  Why (2 Nov 2026, owner: the CI collectors move to the public repo, they read its CI): e2e-intel and integration-intel moved there (jobadabra#2989, tools/ci-intel); without this the tick kept starting the deleted copies. */
export const INTEL_COLLECTORS = [
  {workflow: 'e2e-intel.yml', minute: 40, backup: 41, home: 'public'},
  {workflow: 'integration-intel.yml', minute: 15, backup: 17, home: 'public'},
  // Why (1 Nov 2026, coordinator mac-07: /admin/operations/scheduled read "as of 15:02" at 18:41 while claiming "refreshed hourly"; GitHub ran it at 01:05, 07:29, 15:02): the Scheduled pages' own snapshot is a collector too, on the tick that was free.
  {workflow: 'schedules-snapshot.yml', minute: 0, backup: 3, home: 'web'},
  // Why (4 Nov 2026, owner chose "the Worker cron"): GitHub ran the "hourly" digest 32 times in 7 days, so a failed night waited until morning. Not a collector, but the same start and the same red line, on the Build log page.
  {workflow: 'daily-digest.yml', minute: 10, backup: 11, home: 'web'},
  // Why (11 Nov 2026, owner, asked via AskUserQuestion: "Fix now in a new session (Recommended)"): GitHub's schedule ran the central scout 2-3 times a day instead of 4, 1-2 h late (11 Nov: 01:58Z, 11:56Z, the 16:20Z slot never fired), so the employer index the app reads went stale by hours.
  // The Worker starts it at :25 of 4, 10, 16 and 22 UTC (:25 is on no other tick: collectors 0/10/15/40, probes 5/20/35/50, timers 0/5/30/40); the workflow's cron stays as the backup.
  {workflow: 'central-scout.yml', minute: 25, backup: 26, home: 'lab', hours: [4, 10, 16, 22]},
];

/** The collectors due at `date` (a 5-minute tick): its minute, and its hour when the row lists `hours`. */
export const dueCollectors = date => INTEL_COLLECTORS.filter(collector => collector.minute === date.getUTCMinutes() && (!collector.hours || collector.hours.includes(date.getUTCHours())));

// Where each home's workflows live and the token that may start them: repo and token travel together, and a missing token is a named refusal, never another home's token.
const TARGETS = {
  public: env => ({repo: env.TIMERS_REPO, token: env.TIMERS_GITHUB_TOKEN, missing: 'TIMERS_GITHUB_TOKEN is not set (the site GITHUB_TOKEN is not sent to the public repo in its place)', noRepo: 'TIMERS_REPO is not set (the public repo as owner/name, a var in wrangler.toml)'}),
  web: env => ({repo: env.E2E_INTEL_REPO || WEB_REPO, token: env.E2E_INTEL_GITHUB_TOKEN, missing: 'E2E_INTEL_GITHUB_TOKEN is not set (the site GITHUB_TOKEN covers the public repo, not this one)'}),
  lab: env => ({repo: env.BRAIN_REPO || LAB_REPO, token: env.BRAIN_GITHUB_TOKEN, missing: 'BRAIN_GITHUB_TOKEN is not set (the lab repo\'s token; the site GITHUB_TOKEN is not sent there in its place)'}),
};

/**
 * Starts every collector due at `now` on main of the repo that holds its workflow (its `home`: the public repo, this one or the lab). `dispatch(env, inputs, workflow)` is the Worker's (workers/www/index.js).
 * A 'web' collector: the repo is E2E_INTEL_REPO (default jobadabra/jobadabra-web) and the token MUST be E2E_INTEL_GITHUB_TOKEN (a fine-grained token on this repo, Actions: write). A 'public' one: TIMERS_REPO and TIMERS_GITHUB_TOKEN (the bot timers' pair):
 * repo and token travel together, as in api/brain.js. Why (31 Oct 2026, Gitar on #240): the site's GITHUB_TOKEN is the public repo's (index.js dispatch), so falling back to it would answer 403/404
 * every hour, only as a log line, while the page quietly went back to GitHub's late schedule. Without the token the start is refused out loud (GitHub's own schedule stays the backup).
 * Resolves to one `{workflow, error?}` per due collector, never throws: one collector's refusal must not hide another's start. Off-tick it is [].
 */
export async function startIntelCollectors(env, now, dispatch) {
  return Promise.all(dueCollectors(now).map(async ({workflow, home}) => {
    try {
      const target = TARGETS[home](env);
      if (!target.token) throw new Error(target.missing);
      if (!target.repo) throw new Error(target.noRepo);
      await dispatch({...env, GITHUB_REPO: target.repo, GITHUB_TOKEN: target.token}, undefined, workflow);
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
