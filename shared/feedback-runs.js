// Reconciles running feedback cards with GitHub when a workflow ended before its callback reached the site.
import {act} from './feedback-actions.js';

const FILES = ['.github/workflows/ai-fixer.yml', '.github/workflows/feedback-ai.yml'];
const FAILED = ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'];
// Why (5 Nov 2026, review): GitHub timestamps have seconds only; a same-second dispatch must match a click stored with milliseconds.
const clickSecond = row => Math.floor(Date.parse(row.state_at) / 1000) * 1000;

/** Checks only this card's main-branch dispatch, created after its click; unrelated or older runs never change it. */
function matches(run, row) {
  return run?.event === 'workflow_dispatch' && run.head_branch === 'main' && FILES.includes(run.path)
    && [`AI fixer feedback ${row.ref}`, `Send to AI ${row.ref}`].includes(run.display_title)
    && Date.parse(run.created_at) >= clickSecond(row);
}

/**
 * Restores retry on a GitHub-confirmed failed run. Invariants: no AI or dispatch; unknown/running runs stay running;
 * the state write compares the attempt read before the request, so a late response cannot reset a newer attempt.
 * Uses the existing dispatch token only for read-only requests to GitHub; no report text or token is logged.
 */
export async function reconcileRuns(env, now = new Date(), fetcher = fetch) {
  if (!env.STATS || !env.TIMERS_GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.TIMERS_REPO || '')) return 0;
  const rows = (await env.STATS.prepare("SELECT ref, state_at, ai_run FROM feedback WHERE state = 'ai_running'").all()).results || [];
  let changed = 0;
  for (const row of rows) {
    try {
      const bound = /^\d+$/.test(row.ai_run || '');
      const tail = bound ? `actions/runs/${row.ai_run}` : `actions/runs?event=workflow_dispatch&branch=main&created=${encodeURIComponent(`>=${new Date(clickSecond(row)).toISOString()}`)}&per_page=100`;
      const response = await fetcher(`https://api.github.com/repos/${env.TIMERS_REPO}/${tail}`, {
        headers: {Authorization: `Bearer ${env.TIMERS_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Jobadabra'},
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const answer = await response.json();
      const run = bound ? answer : (answer.workflow_runs || []).filter(run => matches(run, row)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (!matches(run, row) || run.status !== 'completed' || !FAILED.includes(run.conclusion)) continue;
      if (bound && String(run.id) !== row.ai_run) continue;
      const ended = run.conclusion === 'failure' ? 'failed' : `ended (${run.conclusion.replaceAll('_', ' ')})`;
      const why = `GitHub workflow ${ended}; you can send this feedback to AI again.`;
      const done = await act(env, {ref: row.ref, action: 'ai_failed', why}, 'system (GitHub)', now, {trusted: true, run: row});
      if (done.ok) changed++;
    } catch { /* GitHub is unavailable: keep the last known state; the existing stale-run timeout still applies. */ }
  }
  return changed;
}
