// What each CI workflow spent on the AI broker, per UTC day: calls, tokens, engine time and which engine answered.
// Why (3 Nov 2026, owner, AI user agents: "a view/report/control over how costly is each of the session, how many tokens it burns compared to all the CI workflows"): the broker only metered by lane
// (pr / scheduled / bench / drift), so no one could see a workflow's share. The name comes from the verified run token, never from what the caller sends.

/** Days kept in storage; /health returns the last 7 of them. */
export const KEEP_DAYS = 14;

/** What /health returns and the admin page shows, in days. */
export const SHOWN_DAYS = 7;

/** Distinct workflow names kept per day; the rest count under "other". Why (3 Nov 2026, review): the tally is one storage value (128 KiB cap) and anyone who can push a workflow file to an allowed repo can mint names. */
export const MAX_WORKFLOWS = 60;

const WORKFLOW = /^[^/]+\/([^/]+)\/\.github\/workflows\/([^/]+\.ya?ml)$/;

/**
 * The workflow behind a verified run token, as "<repo>/<file>" (e.g. "jobadabra/ui-findings.yml"); "unknown" when the claim has no workflow.
 * Takes the verified claims. The owner part of the repo is dropped so a move of the repos to another owner does not split one workflow in two.
 */
export function workflowOf(claims) {
  const ref = String(claims?.job_workflow_ref || claims?.workflow_ref || '').split('@')[0];
  const match = WORKFLOW.exec(ref);
  return match ? `${match[1]}/${match[2]}` : 'unknown';
}

/** Takes the header the Worker set (internal, built fresh from the claims); returns a name the tally may key on, else "unknown". "admin" is the owner's smoke call. */
export const workflowKey = value => (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.ya?ml$/.test(String(value || '')) || value === 'admin' ? String(value) : 'unknown');

/**
 * Takes an answer's `tokens` ({input, output, counted?}); returns what the broker counted for it: `counted` when the answer names it (a Codex call: input plus output, or for a kept conversation input minus cached plus output; lib/sessions.mjs), else input plus output; 0 when the engine reported none.
 * Why ([bf], 5 Nov 2026): the workflow and job rows must show the number the week meter used, not the conversation's cached context again.
 */
export const tokensOf = tokens => (Number.isFinite(tokens?.counted) ? tokens.counted : (Number.isFinite(tokens?.input) ? tokens.input : 0) + (Number.isFinite(tokens?.output) ? tokens.output : 0));

/**
 * Adds one call to the tally and returns the new tally {days: {<YYYY-MM-DD>: {<workflow>: {calls, ok, tokens, ms, engines: {<engine>: n}}}}}; days older than KEEP_DAYS are dropped.
 * Takes the stored tally (or undefined), the UTC day, the workflow key and the outcome {ok, tokens, ms, engine}. A refused or failed call counts as a call with no tokens.
 */
export function addCall(tally, day, workflow, {ok = false, tokens = 0, ms = 0, engine = ''} = {}) {
  const days = {...(tally?.days || {})};
  if (!days[day]?.[workflow] && Object.keys(days[day] || {}).length >= MAX_WORKFLOWS) workflow = 'other';
  const row = {calls: 0, ok: 0, tokens: 0, ms: 0, engines: {}, ...(days[day]?.[workflow] || {})};
  row.calls += 1;
  if (ok) row.ok += 1;
  row.tokens += tokens;
  row.ms += ms;
  if (engine) row.engines = {...row.engines, [engine]: (row.engines[engine] || 0) + 1};
  days[day] = {...(days[day] || {}), [workflow]: row};
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  return {days: Object.fromEntries(keep.map(key => [key, days[key]]))};
}

/** The last `n` days of a stored tally, in day order: what /health returns. */
export function recentDays(tally, n = SHOWN_DAYS) {
  const days = tally?.days || {};
  return {days: Object.fromEntries(Object.keys(days).sort().slice(-n).map(key => [key, days[key]]))};
}

/**
 * Bounds of the job tally, in bytes as well as keys (a review, 5 Nov 2026: 14 days x 101 keys with real names measured 135 KB, past the 128 KiB value cap): 7 days kept, 50 keys a day over all
 * workflows, 12 per workflow (the rest of a workflow under "<workflow>|other", so one workflow cannot starve the others), keys at most 100 characters. 7 x 51 x ~130 bytes stays near 46 KB.
 */
export const JOB_KEEP_DAYS = 7;
export const MAX_JOB_KEYS = 50;
export const MAX_JOBS_PER_WORKFLOW = 12;
const MAX_JOB_KEY_LENGTH = 100;

/** Takes the `x-jobadabra-job` header; returns the label (a GitHub job id: lower-case letters, digits and dashes, 40 at most) or '' (not sent or not of that shape). Display only: it never decides a lane or a cap. */
export const jobKey = value => (/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(value || '')) ? String(value) : '');

/**
 * Adds one call to the per-job tally and returns it: {days: {<YYYY-MM-DD>: {"<workflow>|<job>": {calls, tokens}}}}; days older than JOB_KEEP_DAYS are dropped.
 * Takes the stored value (or undefined), the UTC day, the verified workflow key, the job label and the call's tokens. No label: nothing is counted (the workflow tally already has the call).
 * Overflow: a workflow's 13th job counts under "<workflow>|other"; past 50 keys a day, under the shared key "|other" (it starts with the separator, so it can never be a workflow's own key).
 */
export function addJobCall(jobs, day, workflow, job, tokens = 0) {
  if (!job) return jobs || {days: {}};
  const days = {...(jobs?.days || {})}, today = days[day] || {}, own = `${workflow}|`;
  let key = `${workflow}|${job}`;
  if (!today[key]) {
    if (Object.keys(today).filter(name => name.startsWith(own) && name !== `${own}other`).length >= MAX_JOBS_PER_WORKFLOW || key.length > MAX_JOB_KEY_LENGTH) key = `${own}other`;
    if (!today[key] && (Object.keys(today).length >= MAX_JOB_KEYS || key.length > MAX_JOB_KEY_LENGTH)) key = '|other';
  }
  days[day] = {...today, [key]: {calls: (today[key]?.calls || 0) + 1, tokens: (today[key]?.tokens || 0) + tokens}};
  const keep = Object.keys(days).sort().slice(-JOB_KEEP_DAYS);
  return {days: Object.fromEntries(keep.map(k => [k, days[k]]))};
}
