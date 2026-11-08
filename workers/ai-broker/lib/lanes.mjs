// Which lane a call is in, read from the verified run token and never from what the caller says: PR checks always go before scheduled work and benchmarks.
// Why (31 Oct 2026, owner: "CI can use up to 100%"): all lanes may use the whole week; PR checks keep queue priority over scheduled work and benchmarks.

/** Lane of verified claims: PR first, a by-hand Search check (by its environment), the exact nightly drift workflow, benchmarks, then other scheduled/push/manual runs. */
export function laneOf(claims) {
  if (claims.event_name === 'pull_request') return 'pr';
  const workflow = String(claims.job_workflow_ref || claims.workflow_ref || '');
  // Why (8 Nov 2026, owner: "Fix Free AI + PR lane now (Recommended)": "by-hand Search checks may use the 30% PR reserve (about 1 run a day), so ps and gi can measure now"): the nightly and a by-hand run are both
  // workflow_dispatch by the same account, so the token tells them apart only by the job's environment, which only search-personas.yml sets, and only when not started by the Worker. The nightly stays scheduled.
  // Its own lane, not 'pr': it may use the PR reserve, but never goes before a PR check, never passes to Claude and has a day cap (lib/budget.mjs), none of which the owner gave it.
  if (claims.environment === 'search-check-by-hand' && /(^|\/)\.github\/workflows\/search-personas\.yml$/.test(workflow.split('@')[0])) return 'byhand';
  if (/(^|\/)\.github\/workflows\/ai-answer-drift\.yml$/.test(workflow.split('@')[0])) return 'drift';
  if (/bench/i.test(workflow)) return 'bench';
  return 'scheduled';
}

export const LANES = ['pr', 'byhand', 'scheduled', 'bench', 'drift'];
/** The queue a lane waits in: drift and by-hand checks wait with scheduled work, behind every PR check. */
export const queueOf = lane => lane === 'drift' || lane === 'byhand' ? 'scheduled' : lane;
