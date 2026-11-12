// Which lane a call is in, read from the verified run token and never from what the caller says: PR checks always go before scheduled work and benchmarks.
// Why (31 Oct 2026, owner: "CI can use up to 100%"): all lanes may use the whole week; PR checks keep queue priority over scheduled work and benchmarks.

/** Lane of verified claims: PR first, a by-hand Search check or press tape (by its environment), the exact nightly drift workflow, benchmarks, then other scheduled/push/manual runs. */
export function laneOf(claims) {
  if (claims.event_name === 'pull_request') return 'pr';
  const workflow = String(claims.job_workflow_ref || claims.workflow_ref || '');
  // Why (8 Nov 2026, owner: "Fix Free AI + PR lane now (Recommended)": "by-hand Search checks may use the 30% PR reserve (about 1 run a day), so ps and gi can measure now"): the nightly and a by-hand run are both
  // workflow_dispatch by the same account, so the token tells them apart only by the job's environment, which only search-personas.yml (only when not started by the Worker) and press-tapes.yml set. The nightly stays scheduled.
  // Its own lane, not 'pr': it never goes before a PR check and has a day cap (lib/budget.mjs). Since 8 Nov 2026 (owner: "codex up to 100%, Claude up to 90%") the PR reserve and the rule keeping it off Claude are gone: it uses Codex and Claude like every lane.
  // Why (8 Nov 2026, owner: "Yes, tapes use it too (Recommended)"): press-tapes.yml records the same personas by hand for The press's yardstick, under the same day cap.
  if (claims.environment === 'search-check-by-hand' && /(^|\/)\.github\/workflows\/(search-personas|press-tapes)\.yml$/.test(workflow.split('@')[0])) return 'byhand';
  if (/(^|\/)\.github\/workflows\/ai-answer-drift\.yml$/.test(workflow.split('@')[0])) return 'drift';
  if (/bench/i.test(workflow)) return 'bench';
  return 'scheduled';
}

export const LANES = ['pr', 'byhand', 'scheduled', 'bench', 'drift'];
/** The queue a lane waits in: drift and by-hand checks wait with scheduled work, behind every PR check. */
export const queueOf = lane => lane === 'drift' || lane === 'byhand' ? 'scheduled' : lane;

/** The one repository whose calls answer on Claude alone. */
export const CLAUDE_ONLY_REPOS = ['jobadabra/jobadabra-benchmarks'];

/**
 * Takes the verified claims, the parsed body (or null) and the body text; returns the text to forward: for a run of jobadabra-benchmarks a body that names no engine gets `engine: 'claude', only: true`, any other call is returned unchanged.
 * Why (12 Nov 2026, owner via bm: "Broker, Claude plan, Haiku"): the benchmark's rivals answer on Haiku 5.5, so ours must too (benchmarks CLAUDE.md "same AI for every contestant"); the app under test sends plain Messages bodies and cannot name an engine, so the broker names it from the signed repository claim, never from a header the caller sends. Tier small = Haiku 5.5 on the Claude plan; a refusal (Claude's week past 90%) is the call's own `budget:` answer, never Codex or Free AI.
 */
export function claudeOnly(claims, asked, text) {
  if (!CLAUDE_ONLY_REPOS.includes(claims?.repository) || !asked || typeof asked !== 'object' || Array.isArray(asked) || Object.hasOwn(asked, 'engine')) return text;
  return JSON.stringify({...asked, engine: 'claude', only: true});
}
