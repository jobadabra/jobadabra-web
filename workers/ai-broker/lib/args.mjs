/**
 * Builds Codex arguments with a stdin prompt marker so prompt text never enters argv.
 * `keep` leaves the conversation on disk (no --ephemeral) so a later call can resume it; `resume` is that conversation's id: the call continues it instead of starting one.
 * Why (13 Nov 2026, cx; 977 calls of run 43358450676 exited 7.6 s p50, never under 5.16 s, after their answer): analytics on, codex's shutdown flushes metrics to ab.chatgpt.com, which the container cannot reach (worker.js HOSTS), and waits out the flush; off, it exits at once (0.162.1 behind a HOSTS-only proxy: 10.4 s -> 0.05 s).
 * Why (5 Nov 2026, [bf] resume, measured with 0.162.1 on this CLI): `exec resume` has no `-s`, so a resumed call carries the sandbox as `-c sandbox_mode`; it takes no `--` (its `-i` takes one file per flag, so nothing swallows the stdin marker).
 */
export function buildArgs({schema, imageNames = [], model, search, effort, resume, keep}) {
  const common = ['--skip-git-repo-check', '--ignore-user-config', ...(keep || resume ? [] : ['--ephemeral']), ...(resume ? [] : ['-s', 'read-only']), '--disable', 'shell_tool', '-c', 'analytics.enabled=false', '--json', '-o', 'out.txt'];
  const args = resume ? ['exec', 'resume', String(resume), ...common] : ['exec', ...common];
  if (model) args.push('-m', String(model));   // the worker maps a tier to one of three slugs (lib/tiers.mjs); the container runs only what it is given
  if (schema) args.push('--output-schema', 'schema.json');
  for (const name of imageNames) args.push('-i', name);
  if (search === true) args.push('-c', 'web_search="live"');
  if (effort) args.push('-c', `model_reasoning_effort="${String(effort).replace(/[^a-z]/g, '')}"`);   // validated by the worker (lib/tiers.mjs EFFORTS); the regex keeps a stray value from ever becoming another config key
  if (resume) args.push('-c', 'sandbox_mode="read-only"', '-');
  else args.push('--', '-');   // Why (5 Nov 2026, run 41960589465): long fixer prompts exceed argv limits (E2BIG); -- keeps -i from swallowing the stdin marker.
  return args;
}
