// The Worker's every-5-minutes trigger starts every CI collector once an hour, on time (owner, 31 Oct 2026: GitHub's own schedule ran e2e-intel every ~4.5 h; 1 Nov 2026: integration-intel had
// never run, so /admin/testing/integrations read "No data yet"). Every test loops over INTEL_COLLECTORS: a collector added to the list is covered, one missing from it is caught by the folder check.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {INTEL_COLLECTORS, dueCollectors, startIntelCollectors} from '../../../shared/intel-start.js';

const tick = (hour, minute) => new Date(Date.UTC(2026, 9, 31, hour, minute));
const workflowDir = new URL('../../../.github/workflows/', import.meta.url);
const ENV = {GITHUB_REPO: 'GarryOne/jobadabra', GITHUB_TOKEN: 'site-token', E2E_INTEL_GITHUB_TOKEN: 'own-token', E2E_INTEL_REPO: 'jobadabra/jobadabra-web', TIMERS_REPO: 'jobadabra/jobadabra', TIMERS_GITHUB_TOKEN: 'timers-token', BRAIN_REPO: 'jobadabra/jobadabra-lab', BRAIN_GITHUB_TOKEN: 'brain-token'};
// Why (2 Nov 2026, owner: the CI collectors moved to the public repo, jobadabra#2989): a collector is started where its workflow lives; the pair (repo, token) travels together.
const WHERE = {public: {repo: 'jobadabra/jobadabra', token: 'timers-token'}, web: {repo: 'jobadabra/jobadabra-web', token: 'own-token'}, lab: {repo: 'jobadabra/jobadabra-lab', token: 'brain-token'}};
// A row with `hours` is due only in those UTC hours (the central scout: 4, 10, 16, 22); the other tests start it in its first hour.
const hourOf = row => row.hours?.[0] ?? 9;

test('of the twelve 5-minute ticks in an hour, each collector starts on exactly one, every hour of the day, and no two share a tick', () => {
  for (const {workflow, minute, hours} of INTEL_COLLECTORS) {
    for (let hour = 0; hour < 24; hour++) {
      const due = Array.from({length: 12}, (_, i) => i * 5).filter(at => dueCollectors(tick(hour, at)).some(item => item.workflow === workflow));
      assert.deepEqual(due, !hours || hours.includes(hour) ? [minute] : [], `${workflow} hour ${hour}`);
    }
  }
  assert.equal(new Set(INTEL_COLLECTORS.map(item => item.minute)).size, INTEL_COLLECTORS.length, 'two collectors on one tick');
});

test('on its tick each collector is dispatched on the repo that holds its workflow with that repo\'s token and no inputs; off every tick nothing starts', async () => {
  const calls = [], dispatch = async (env, inputs, workflow) => { calls.push({repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, inputs, workflow}); };
  assert.deepEqual(await startIntelCollectors(ENV, tick(9, 35), dispatch), [], 'off the ticks');
  assert.deepEqual(calls, []);
  for (const row of INTEL_COLLECTORS) {
    const {workflow, minute, home} = row, hour = hourOf(row);
    calls.length = 0;
    assert.deepEqual(await startIntelCollectors(ENV, tick(hour, minute), dispatch), [{workflow}]);
    assert.deepEqual(calls, [{repo: WHERE[home].repo, token: WHERE[home].token, inputs: undefined, workflow}], `${workflow}: the public GITHUB_REPO and the site token are not used; no inputs (the workflow declares none)`);
    await startIntelCollectors({...ENV, E2E_INTEL_REPO: 'Owner/other', TIMERS_REPO: 'Owner/other', BRAIN_REPO: 'Owner/other'}, tick(hour, minute), dispatch);
    assert.equal(calls[1].repo, 'Owner/other', 'a dedicated repo var wins');
    assert.deepEqual(await startIntelCollectors(ENV, tick(hour, minute), async () => { throw new Error('GitHub dispatch failed: 403'); }), [{workflow, error: 'GitHub dispatch failed: 403'}], 'a refused start is reported, never swallowed');
  }
});

test('without its own token the tick refuses out loud and never sends the site token to either repo (Gitar, #240): E2E_INTEL_GITHUB_TOKEN here, TIMERS_GITHUB_TOKEN for the public repo', async () => {
  const calls = [];
  const MISSING = {public: /TIMERS_GITHUB_TOKEN is not set/, web: /E2E_INTEL_GITHUB_TOKEN is not set/, lab: /BRAIN_GITHUB_TOKEN is not set/};
  for (const row of INTEL_COLLECTORS) {
    const {workflow, minute, home} = row;
    const [result] = await startIntelCollectors({GITHUB_REPO: 'GarryOne/jobadabra', GITHUB_TOKEN: 'site-token', TIMERS_REPO: 'jobadabra/jobadabra', TIMERS_GITHUB_TOKEN: home === 'public' ? '' : 'timers-token', E2E_INTEL_GITHUB_TOKEN: home === 'web' ? '' : 'own-token'}, tick(hourOf(row), minute), async (...args) => { calls.push(args); });
    assert.equal(result.workflow, workflow);
    assert.match(result.error, MISSING[home], `${workflow}: another home's token is never used in its place`);
  }
  const [noRepo] = await startIntelCollectors({TIMERS_GITHUB_TOKEN: 'timers-token'}, tick(9, INTEL_COLLECTORS.find(item => item.home === 'public').minute), async (...args) => { calls.push(args); });
  assert.match(noRepo.error, /TIMERS_REPO is not set/, 'a public start without its repo var is refused, never sent to a guessed repo');
  assert.deepEqual(calls, []);
  assert.deepEqual(await startIntelCollectors({}, tick(9, 35), async () => { calls.push(1); }), [], 'off the tick a missing token is not an error');
});

test('the Worker\'s */5 trigger really sends GitHub the request each collector needs, on its tick only, and a refusal does not break the tick or the other work', async () => {
  const requests = [], realFetch = globalThis.fetch, realError = console.error, errors = [];
  globalThis.fetch = async (url, init) => { requests.push({url: String(url), method: init?.method, auth: init?.headers?.Authorization, body: init?.body}); return new Response(null, {status: String(url).includes('api.github.com') ? 204 : 200}); };
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const run = async (minute, env, hour = 12) => { const tasks = []; await worker.scheduled({cron: '*/5 * * * *', scheduledTime: tick(hour, minute).getTime()}, env, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
    const starts = () => requests.filter(request => request.url.includes('/actions/workflows/'));
    await run(35, ENV);
    assert.deepEqual(starts(), [], ':35 starts nothing');
    for (const row of INTEL_COLLECTORS) {
      const {workflow, minute, home} = row, hour = hourOf(row);
      requests.length = 0;
      await run(minute, ENV, hour);
      assert.deepEqual(starts().map(r => [r.url, r.method, r.auth, JSON.parse(r.body)]), [[`https://api.github.com/repos/${WHERE[home].repo}/actions/workflows/${workflow}/dispatches`, 'POST', `Bearer ${WHERE[home].token}`, {ref: 'main'}]], `${workflow} at :${minute}`);
      globalThis.fetch = async () => new Response(null, {status: 403});
      await run(minute, ENV, hour);
      assert.ok(errors.some(line => line.includes(`${workflow.replace('.yml', '')} start failed: GitHub dispatch failed: 403`)), `${workflow}: a refusal is logged, the other 5-minute work still ran`);
      globalThis.fetch = async (url, init) => { requests.push({url: String(url), method: init?.method, auth: init?.headers?.Authorization, body: init?.body}); return new Response(null, {status: String(url).includes('api.github.com') ? 204 : 200}); };
    }
  } finally { globalThis.fetch = realFetch; console.error = realError; }
});

test('every collector workflow keeps its GitHub schedule as the backup (after the Worker\'s tick), can be dispatched, runs one at a time and says who started it', () => {
  for (const {workflow, minute, backup, home} of INTEL_COLLECTORS) {
    if (home === 'lab') continue;   // its workflow is in jobadabra-lab (the same checks run there: central-scout.yml keeps cron `26 4,10,16,22`, a concurrency group and the Worker timer run-name)
    const yml = readFileSync(new URL(workflow, workflowDir), 'utf8'), name = workflow.replace('.yml', '');
    assert.ok(backup > minute && backup < minute + 5, `${workflow}: the backup minute follows the Worker's tick within the same 5 minutes`);
    assert.ok(yml.includes(`cron: '${backup} * * * *'`), `${workflow}: backup cron minute ${backup}`);
    assert.match(yml, /^  workflow_dispatch:\s*$/m, workflow);
    assert.doesNotMatch(yml.slice(yml.indexOf('workflow_dispatch:'), yml.indexOf('permissions:')), /required: true/, `${workflow}: no required input, the Worker sends none`);
    assert.match(yml, new RegExp(`group: ${name}\\n\\s+cancel-in-progress: false`), workflow);
    assert.match(yml, /^run-name: .*Worker timer/m, workflow);
  }
});

test('every *-intel.yml workflow with an hourly cron that publishes to the site is in the list (integration-intel.yml was missing from it); other hourly publishers (ops-overview.yml ...) are not collectors and stay out', () => {
  const intel = readdirSync(workflowDir).filter(file => /-intel\.yml$/.test(file));
  assert.ok(intel.includes('integration-intel.yml') && intel.includes('e2e-intel.yml'));
  for (const file of intel) {
    const yml = readFileSync(new URL(file, workflowDir), 'utf8');
    if (!/SELFHEAL_PUBLISH_KEY/.test(yml) || !/^\s+- cron: '\d+ \* \* \* \*'/m.test(yml)) continue;   // the naming convention *-intel.yml is the scope: a collector under another name must be added to the list by hand
    assert.ok(INTEL_COLLECTORS.some(item => item.workflow === file), `${file} is an hourly collector: add it to INTEL_COLLECTORS (shared/intel-start.js)`);
  }
});

test('www sets E2E_INTEL_REPO to the repo that holds the collectors, so the start does not lean on the old path\'s redirect', () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^E2E_INTEL_REPO = "jobadabra\/jobadabra-web"$/m);
});

test('www names the public repo for the collectors that moved there (TIMERS_REPO), and no collector in the list lives only in a deleted web workflow', () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^TIMERS_REPO = "jobadabra\/jobadabra"$/m);
  assert.deepEqual(INTEL_COLLECTORS.filter(item => item.home === 'public').map(item => item.workflow).sort(), ['e2e-intel.yml', 'integration-intel.yml']);
  for (const {workflow, home} of INTEL_COLLECTORS.filter(item => item.home === 'web')) readFileSync(new URL(workflow, workflowDir), 'utf8');   // throws when a 'web' collector's file is gone
});

test('the central scout is a lab row: four starts a day at :25 on jobadabra-lab with the lab token, and the lab repo var names the repo that holds it', async () => {
  const scout = INTEL_COLLECTORS.find(item => item.workflow === 'central-scout.yml');
  assert.deepEqual([scout.home, scout.minute, scout.backup, scout.hours], ['lab', 25, 26, [4, 10, 16, 22]]);
  const perDay = Array.from({length: 24 * 12}, (_, i) => tick(Math.floor(i / 12), (i % 12) * 5)).filter(at => dueCollectors(at).some(item => item.workflow === scout.workflow));
  assert.deepEqual(perDay.map(at => at.toISOString().slice(11, 16)), ['04:25', '10:25', '16:25', '22:25']);
  const calls = [];
  assert.deepEqual(await startIntelCollectors({BRAIN_GITHUB_TOKEN: 'brain-token'}, tick(16, 25), async (env, inputs, workflow) => { calls.push([env.GITHUB_REPO, env.GITHUB_TOKEN, inputs, workflow]); }), [{workflow: 'central-scout.yml'}], 'BRAIN_REPO unset: the lab repo constant');
  assert.deepEqual(calls, [['jobadabra/jobadabra-lab', 'brain-token', undefined, 'central-scout.yml']]);
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^BRAIN_REPO = "jobadabra\/jobadabra-lab"$/m);
});

test('board discovery is a lab row: every 2 h at :45 UTC on jobadabra-lab with the lab token, no inputs, and no GitHub cron behind it', async () => {
  const row = INTEL_COLLECTORS.find(item => item.workflow === 'board-discovery.yml');
  assert.deepEqual([row.home, row.minute, row.backup], ['lab', 45, null]);
  const perDay = Array.from({length: 24 * 12}, (_, i) => tick(Math.floor(i / 12), (i % 12) * 5)).filter(at => dueCollectors(at).some(item => item.workflow === row.workflow));
  assert.deepEqual(perDay.map(at => at.toISOString().slice(11, 16)), Array.from({length: 12}, (_, i) => `${String(i * 2).padStart(2, '0')}:45`));
  const calls = [];
  assert.deepEqual(await startIntelCollectors({BRAIN_GITHUB_TOKEN: 'brain-token'}, tick(2, 45), async (env, inputs, workflow) => { calls.push([env.GITHUB_REPO, env.GITHUB_TOKEN, inputs, workflow]); }), [{workflow: 'board-discovery.yml'}]);
  assert.deepEqual(calls, [['jobadabra/jobadabra-lab', 'brain-token', undefined, 'board-discovery.yml']], 'the timer sends no inputs: the engine picks the weakest cells');
  assert.deepEqual(await startIntelCollectors({BRAIN_GITHUB_TOKEN: 'brain-token'}, tick(3, 45), async () => { calls.push(1); }), [], 'odd hours: nothing');
});
