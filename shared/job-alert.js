// The one shared alert for scheduled jobs (owner, 12 Nov 2026, asked via AskUserQuestion: "One shared alert" over a step in each workflow; "let's close these gaps").
// Root cause it closes: ~40 workflows across four repos told the owner they failed only if someone had added a step (board discovery had none), and a refused Worker start (shared/intel-start.js) was silent.
// Two senders, both through the switchboard (shared/notify-send.js, channel Engineering):
//   scheduled-job-red          from the hourly Scheduled snapshot (admin/schedules.js ingest): ❌ once per red streak, ✅ "works again" on the first green after a told red.
//   scheduled-job-not-started  from the Worker's own start (workers/www/index.js tick): ⚠️ once a day per job, with GitHub's status.
// State per job lives in D1 (table job_alert, migration 0152) so a streak survives a Worker restart. A job seen for the first time is recorded silently (no flood on the first snapshot).
// The owner's per-job switch is `muted`; the global one is the registry row's switch (Admin → Notifications). Never throws: an alert is not worth a failed upload or tick.
import {INTEL_COLLECTORS} from './intel-start.js';
import {alertOwner} from './notify-send.js';
import {jobGreenCard, jobNotStartedCard, jobRedCard} from './owner-cards.js';

/** Why (12 Nov 2026, owner's target 3: "must not alert twice"): jobs whose workflow already tells the owner when it fails; the shared alert stays silent for them. Key = '<repo>/<file>' (repo without the owner).
 *  Keep the ai-skipped-alert steps too: they cover a run that ends green while every AI call failed, which this alert (red runs only) cannot see. */
export const OWN_ALERT = new Map([
  ['jobadabra-lab/central-scout.yml', 'its own failure step (central-scout.yml, "if: failure()" Telegram post)'],
  ['jobadabra-lab/product-brain.yml', 'its own failure step ("Say it failed", product_brain.telegram)'],
  ['jobadabra/daily.yml', 'its own failure step (Telegram post on failure)'],
  ['jobadabra/mail.yml', 'its own failure step (Telegram post on failure)'],
  ['jobadabra/scout.yml', 'its own failure step (Telegram post on failure)'],
  ['jobadabra/harness-daily.yml', 'registry alert harness-daily (ci-alert.mjs on failure)'],
  ['jobadabra/journeys.yml', 'registry alert journey-failing (ci-alert.mjs)'],
  ['jobadabra/site-replays.yml', 'registry alert replay-drift (ci-alert.mjs)'],
  ['jobadabra/replay-refill.yml', 'registry alert replay-refill (ci-alert.mjs)'],
  ['jobadabra/search-personas.yml', 'registry alert search-night (search-alert.mjs)'],
  ['jobadabra/e2e.yml', 'registry alert main-red (ci-alert.mjs)'],
  ['jobadabra/desktop.yml', 'registry alert release-failed / main-red'],
  ['jobadabra/canary-promote.yml', 'registry alert release-failed'],
  ['jobadabra/extension-store-publish.yml', 'registry alert chrome-store-failed'],
  ['jobadabra/msix-store.yml', 'registry alert msstore-status (a failed publish sends its own message)'],
  ['jobadabra/msix-store-weekly.yml', 'its own failure step (ci-alert.mjs)'],
  ['jobadabra/msix-store-watch.yml', 'registry alert msstore-status'],
]);
// Where each Worker-started collector's workflow lives (shared/intel-start.js `home`), as the repo name the job key uses.
const HOME_REPO = {public: 'jobadabra', web: 'jobadabra-web', lab: 'jobadabra-lab'};
const homeOf = workflow => HOME_REPO[INTEL_COLLECTORS.find(item => item.workflow === workflow)?.home] || 'jobadabra';

/** red | green | none | off from the newest run that PASSED or FAILED. Why (12 Nov 2026, Gitar on #586): schedules-model stateOf() reads a cancelled or skipped run as green (fine for the page's chip), but here it would end a red streak with
 *  a false "works again" when a concurrency group cancels the next run; a cancelled or skipped run leaves the streak as it was. */
const DECIDES = ['success', 'failure', 'timed_out'];
export function alertState(job) {
  if (job.disabled) return 'off';
  const done = (job.recent || []).find(run => DECIDES.includes(run.conclusion));
  return !done ? 'none' : done.conclusion === 'success' ? 'green' : 'red';
}
export const jobKey = job => `${String(job.repo).split('/').pop()}/${job.file}`;
const day = now => now.toISOString().slice(0, 10);
const clip = text => String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 110);

/** The jobs the owner turned the shared alert off for: Set of job keys. An unreadable table reads as none. */
export async function readMuted(db) {
  try { return new Set(((await db.prepare('SELECT job FROM job_alert WHERE muted = 1').all()).results || []).map(row => row.job)); } catch { return new Set(); }
}
/** The owner's per-job switch (Admin → Scheduled). Only a job key of the shape '<repo>/<file>.yml' is kept. */
export async function setJobMuted(db, job, muted, now = new Date()) {
  if (!/^[\w.-]{1,60}\/[\w.-]{1,80}\.ya?ml$/.test(String(job))) return false;
  await db.prepare('INSERT INTO job_alert (job, muted, at) VALUES (?, ?, ?) ON CONFLICT(job) DO UPDATE SET muted = excluded.muted, at = excluded.at').bind(job, muted ? 1 : 0, now.toISOString()).run();
  return true;
}

const save = (db, job, fields, now) => db.prepare('INSERT INTO job_alert (job, state, alerted, at) VALUES (?, ?, ?, ?) ON CONFLICT(job) DO UPDATE SET state = excluded.state, alerted = excluded.alerted, at = excluded.at')
  .bind(job, fields.state, fields.alerted, now.toISOString()).run();
// Delivered, or held on purpose by the switchboard (off, rate): the streak is done with. Not delivered anywhere (via 'none'): keep the old row so the next snapshot tries again.
const settled = told => told && (told.sent || told.via === 'switchboard');

/**
 * One snapshot in: tells each job that turned red (once per streak) or green again (once, after a told red). -> {red, green} counts sent.
 * `snapshot` = the cleaned Scheduled snapshot ({jobs: [{repo, file, name, disabled, recent}]}). Jobs with state none/off are left as they were.
 */
export async function alertJobs(env, snapshot, {fetcher = fetch, now = new Date()} = {}) {
  const out = {red: 0, green: 0};
  if (!env.STATS) return out;
  try {
    const rows = new Map(((await env.STATS.prepare('SELECT job, state, alerted, muted FROM job_alert').all()).results || []).map(row => [row.job, row]));
    for (const job of snapshot?.jobs || []) {
      const state = alertState(job), key = jobKey(job), before = rows.get(key);
      if (state !== 'red' && state !== 'green') continue;
      if (!before?.state) { await save(env.STATS, key, {state, alerted: 0}, now); continue; }   // first sight: a baseline, not news
      if (before.state === state) continue;
      const quiet = OWN_ALERT.has(key) || before.muted === 1, run = (job.recent || []).find(item => item.conclusion) || {};
      const facts = {name: job.name || job.file, repo: String(job.repo).split('/').pop(), url: run.url || ''};
      if (state === 'red') {
        const told = quiet ? {sent: false, via: 'switchboard'} : await alertOwner(env, 'scheduled-job-red', {text: jobRedCard(facts).text, html: true, level: 'problem', state: `${key} red`, fetcher, now});
        if (!settled(told)) continue;
        await save(env.STATS, key, {state, alerted: told.sent ? 1 : 0}, now); out.red += told.sent ? 1 : 0;
      } else {
        const told = quiet || !before.alerted ? {sent: false, via: 'switchboard'} : await alertOwner(env, 'scheduled-job-red', {text: jobGreenCard(facts).text, html: true, level: 'ok', state: `${key} green`, fetcher, now});
        if (!settled(told)) continue;
        await save(env.STATS, key, {state, alerted: 0}, now); out.green += told.sent ? 1 : 0;
      }
    }
  } catch (error) { console.error(`job alert: ${error.message}`); }
  return out;
}

/** The job's name as the Scheduled page shows it (from the stored snapshot), else its file name. */
async function nameOf(db, key) {
  try {
    const row = await db.prepare('SELECT body FROM schedules_snapshot WHERE id = 1').first(), jobs = row ? JSON.parse(row.body).jobs || [] : [];
    return jobs.find(job => jobKey(job) === key)?.name || key.split('/').pop();
  } catch { return key.split('/').pop(); }
}
/**
 * The Worker's own starts that were refused (`results` of startIntelCollectors: {workflow, error?}): ⚠️ once per job per UTC day, with GitHub's status.
 * Not delivered anywhere = tried again on the next tick. -> number sent.
 */
export async function alertNotStarted(env, results, {fetcher = fetch, now = new Date()} = {}) {
  let sent = 0;
  if (!env.STATS) return sent;
  for (const {workflow, error} of results.filter(item => item.error)) {
    try {
      const key = `${homeOf(workflow)}/${workflow}`, row = await env.STATS.prepare('SELECT muted, start_day FROM job_alert WHERE job = ?').bind(key).first();
      if (row?.start_day === day(now)) continue;
      const status = /\b([1-5]\d\d)\b/.exec(error)?.[1], facts = {name: await nameOf(env.STATS, key), repo: key.split('/')[0], why: status ? `GitHub answered ${status}` : clip(error)};
      const told = row?.muted === 1 ? {sent: false, via: 'switchboard'} : await alertOwner(env, 'scheduled-job-not-started', {text: jobNotStartedCard(facts).text, html: true, level: 'problem', state: `${key} ${day(now)}`, fetcher, now});
      if (!settled(told)) continue;
      await env.STATS.prepare('INSERT INTO job_alert (job, start_day, at) VALUES (?, ?, ?) ON CONFLICT(job) DO UPDATE SET start_day = excluded.start_day').bind(key, day(now), now.toISOString()).run();
      if (told.sent) sent++;
    } catch (caught) { console.error(`job alert (not started): ${caught.message}`); }
  }
  return sent;
}
