#!/usr/bin/env node
// Collects every workflow of our repos (files, schedules, latest runs) into ONE snapshot and sends it to /admin/operations/scheduled (schedules-snapshot.yml, hourly).
// A job that moves to another repo just shows under its new repo. Needs gh with SCHEDULES_READ_TOKEN (read-only: Actions + Contents on each repo; the Actions token reads only its own repo)
// and SELFHEAL_PUBLISH_KEY to publish. Pure parts: site/src/schedules-model.js. Guard: test/schedules.test.js.
//   node jobs/schedules-snapshot.mjs [--dry [--out snapshot.json]]     --dry reads and prints the counts without publishing
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {billedWeight, parseWorkerCrons, parseWorkflow, RUN_DOTS} from '../shared/schedules-model.js';
import {pathToFileURL} from 'node:url';
import {LAB_REPO, PUBLIC_REPO, WEB_REPO} from '../shared/repos.js';

const REPOS = (process.env.SCHEDULES_REPOS || [PUBLIC_REPO, WEB_REPO, LAB_REPO].join(',')).split(',');
const WORKER_REPO = PUBLIC_REPO, WORKER_FILES = ['app-core/src/scheduler.js', 'worker/src/scheduler.js'];   // Why (1 Nov 2026, owner: jobadabra is desktop + extension only): the Worker's code moved to app-core/; the old path answers until the public move is on main
const base = process.env.SCHEDULES_URL || 'https://www.jobpilotto.top/ops/data?kind=schedules';
const WEEK = 7 * 86400000;

const realGh = (path, raw = false) => {
  const out = execFileSync('gh', ['api', path, ...(raw ? ['-H', 'Accept: application/vnd.github.raw'] : [])], {encoding: 'utf8', maxBuffer: 1 << 27});
  return raw ? out : JSON.parse(out);
};
const mins = run => Math.max(0, (Date.parse(run.updated_at) - Date.parse(run.run_started_at || run.created_at)) / 60000) || 0;
const runOf = run => ({at: run.run_started_at || run.created_at, conclusion: run.status === 'completed' ? run.conclusion : null, mins: Math.round(mins(run) * 10) / 10, url: run.html_url, event: run.event || '', branch: run.head_branch || ''});
// Why (12 Nov 2026, mac-9a: "does alertState count a red run on a PR branch?"): the runs above are every branch's, so a PR-triggered workflow's newest 14 are mostly pull_request runs. The shared failure alert (shared/job-alert.js) reads only
// runs on main that are not pull_request ones (push, schedule, dispatch on main): MAIN_RUNS of them, from the same list when it already is that, else one more call with GitHub's own filters.
export const MAIN_RUNS = 5;
export const onMain = run => run.head_branch === 'main' && run.event !== 'pull_request';

// One repo: its workflow files, parsed, with the newest runs and the minutes of the last 7 days. A repo that cannot be read is {ok: false} with no jobs (never an error that stops the others).
export async function collectRepo(repo, {gh = realGh, workerCrons = {}, now = new Date()} = {}) {
  let info, workflows;
  try { info = gh(`repos/${repo}`); workflows = gh(`repos/${repo}/actions/workflows?per_page=100`).workflows; } catch { return {repo: {name: repo, private: true, ok: false}, jobs: []}; }
  const isPrivate = Boolean(info.private), since = new Date(now.getTime() - WEEK).toISOString().slice(0, 10);
  const jobs = [];
  for (const workflow of workflows) {
    if (!/^\.github\/workflows\//.test(workflow.path)) continue;
    const file = workflow.path.split('/').pop();
    let parsed;
    try { parsed = parseWorkflow(gh(`repos/${repo}/contents/${workflow.path}`, true)); } catch { continue; }
    const week = gh(`repos/${repo}/actions/workflows/${workflow.id}/runs?per_page=100&created=%3E%3D${since}`), weekRuns = week.workflow_runs || [];
    const recentRuns = weekRuns.length >= RUN_DOTS ? weekRuns : gh(`repos/${repo}/actions/workflows/${workflow.id}/runs?per_page=${RUN_DOTS}`).workflow_runs || [];
    const mainRuns = (recentRuns.every(onMain) ? recentRuns : gh(`repos/${repo}/actions/workflows/${workflow.id}/runs?branch=main&exclude_pull_requests=true&per_page=${MAIN_RUNS}`).workflow_runs || []).filter(onMain).slice(0, MAIN_RUNS);
    const total = week.total_count || weekRuns.length, wall = weekRuns.reduce((sum, run) => sum + mins(run), 0) * (weekRuns.length ? total / weekRuns.length : 0);
    const worker = repo === WORKER_REPO ? workerCrons[file] || [] : [];
    const crons = [...new Set([...parsed.crons, ...worker])];
    jobs.push({repo, file, name: parsed.name || file, about: parsed.about, crons, source: worker.length && parsed.crons.length ? 'both' : worker.length ? 'worker' : 'github', manual: parsed.manual, disabled: workflow.state !== 'active',
      ai: parsed.ai, weeklyMin: Math.round(wall), billedMin: Math.round(wall * billedWeight(parsed.runner, isPrivate)), recent: recentRuns.slice(0, RUN_DOTS).map(runOf), main: mainRuns.map(runOf)});
  }
  return {repo: {name: repo, private: isPrivate, ok: true}, jobs};
}

export async function collect({gh = realGh, repos = REPOS, now = new Date()} = {}) {
  let workerCrons = {};
  for (const file of WORKER_FILES) { try { workerCrons = parseWorkerCrons(gh(`repos/${WORKER_REPO}/contents/${file}`, true)); break; } catch { /* try the next path; none readable: the Worker's own starts are not listed */ } }
  const parts = [];
  for (const repo of repos) parts.push(await collectRepo(repo, {gh, workerCrons, now}));
  return {schema: 1, at: now.toISOString(), repos: parts.map(part => part.repo), jobs: parts.flatMap(part => part.jobs)};
}

async function main() {
  const key = process.env.SELFHEAL_PUBLISH_KEY, dry = process.argv.includes('--dry');
  if (!key && !dry) { console.log('::warning::SELFHEAL_PUBLISH_KEY is not set: nothing published.'); return; }
  const snapshot = await collect();
  const bad = snapshot.repos.filter(repo => !repo.ok).map(repo => repo.name);
  console.log(`${snapshot.jobs.length} workflows in ${snapshot.repos.length} repos${bad.length ? `; could not read: ${bad.join(', ')}` : ''}`);
  const out = process.argv.indexOf('--out');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(snapshot));
  if (dry) return;
  if (bad.length === snapshot.repos.length) { console.log('::error::no repo could be read (is SCHEDULES_READ_TOKEN set?)'); process.exitCode = 1; return; }
  const response = await fetch(base, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(snapshot)});
  console.log(`published: HTTP ${response.status} ${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
