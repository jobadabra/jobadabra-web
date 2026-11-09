// The body of POST /run, checked (main.mjs): the Worker names the night's task (cloud runner 2/4; spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md).
// Self-contained so a test loads it without Playwright or the night's files (stop.mjs does the same); the tasks come from night.mjs (TASKS) through main.mjs.

/**
 * Pure. `tasks`: the tasks the night can run. -> {site, token, task}, or {error} for a task not in `tasks` (`auto` and any typo are refused before a browser opens).
 * Why (8 Nov 2026): a body without a task is a fill, so a Worker from before the cloud runner starts the night it always did.
 */
export function parseRun(given, tasks) {
  const task = given?.task === undefined ? 'fill' : given.task;
  if (!tasks.includes(task)) return {error: `unknown night task: ${String(task).slice(0, 20)}`};
  return {site: String(given?.site || ''), token: String(given?.token || ''), task};
}
