/** Builds Codex arguments with a stdin prompt marker after -- so images cannot swallow it; prompt text never enters argv. */
export function buildArgs({schema, imageNames = [], model, search, effort}) {
  const args = ['exec', '--skip-git-repo-check', '--ignore-user-config', '--ephemeral', '-s', 'read-only', '--disable', 'shell_tool', '--json', '-o', 'out.txt'];
  if (model) args.push('-m', String(model));   // the worker maps a tier to one of three slugs (lib/tiers.mjs); the container runs only what it is given
  if (schema) args.push('--output-schema', 'schema.json');
  for (const name of imageNames) args.push('-i', name);
  if (search === true) args.push('-c', 'web_search="live"');
  if (effort) args.push('-c', `model_reasoning_effort="${String(effort).replace(/[^a-z]/g, '')}"`);   // validated by the worker (lib/tiers.mjs EFFORTS); the regex keeps a stray value from ever becoming another config key
  args.push('--', '-');   // Why (5 Nov 2026, run 41960589465): long fixer prompts exceed argv limits (E2BIG); -- keeps -i from swallowing the stdin marker.
  return args;
}
