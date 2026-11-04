// The old bot Worker's timers on the site Worker's triggers (owner, 1 Nov 2026: "Timers to site Worker, delete bot"). The rules stay in the public repo's app-core/src/scheduler.js (CRONS, jobsFor, NIGHT_SLOTS)
// and watchdog.js (fires, LABEL): this module only decides WHICH of those crons a www trigger stands for. Dormant until env.TIMERS === 'on'. Guard for the rest of the wiring: the last test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {queued} from '../../../api/triage.js';
import {CRONS, NIGHT_SLOTS, jobsFor} from '../../../app-core/src/scheduler.js';
import {dueStarts, fires} from '../../../app-core/src/watchdog.js';
import {OWN_CRON, TICK, cronsAt, runTimers} from '../../../shared/timers.js';

const at = (hour, minute, day = 2) => new Date(Date.UTC(2026, 10, day, hour, minute));   // 2 Nov 2026: Zurich is UTC+1, so 03:00 UTC is 04:00 there
const ON = {TIMERS: 'on', TIMERS_GITHUB_TOKEN: 'timers-token', TIMERS_REPO: 'GarryOne/jobadabra'};
const started = async (event, env = ON, dispatchError) => {
  const calls = [];
  const dispatch = async (scoped, inputs, workflow) => { calls.push({repo: scoped.GITHUB_REPO, token: scoped.GITHUB_TOKEN, inputs, workflow}); if (dispatchError) throw dispatchError; };
  const result = await runTimers(event, env, {dispatch, report: async () => {}});
  return {calls, result};
};

test('the */5 trigger stands, at every tick of the day, for exactly the bot crons that fire then, never the 47 one; the other triggers stand for themselves or nothing', () => {
  for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
    const date = at(Math.floor(minutes / 60), minutes % 60);
    assert.deepEqual(cronsAt({cron: TICK, scheduledTime: date.getTime()}), CRONS.filter(cron => cron !== OWN_CRON && fires(cron, date)), date.toISOString());
  }
  assert.deepEqual(cronsAt({cron: TICK, scheduledTime: at(3, 0).getTime()}), ['0 0,1,2,3 * * *', '*/10 * * * *'], '03:00 UTC: the nightly hour and the ten-minute sweep');
  assert.deepEqual(cronsAt({cron: TICK, scheduledTime: at(3, 5).getTime()}), [], ':05 is not a ten-minute mark');
  assert.deepEqual(cronsAt({cron: OWN_CRON, scheduledTime: at(21, 47).getTime()}), [OWN_CRON], 'its own trigger stands for itself');
  assert.deepEqual(cronsAt({cron: '30 5 * * *', scheduledTime: at(5, 30).getTime()}), [], 'the daily trigger is not a timer');
});

test('every start the bot Worker made over a day is made, once, by the site Worker\'s two triggers: same workflow, same inputs, same minute', () => {
  const line = (date, job) => `${date.toISOString()} ${job.workflow} ${JSON.stringify(job.inputs || {})}`;
  const bot = [], site = [];
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const date = at(Math.floor(minute / 60), minute % 60);
    for (const cron of CRONS.filter(entry => fires(entry, date))) for (const job of jobsFor(cron, date)) bot.push(line(date, job));
    const event = fires(OWN_CRON, date) ? {cron: OWN_CRON, scheduledTime: date.getTime()} : minute % 5 === 0 ? {cron: TICK, scheduledTime: date.getTime()} : null;
    if (event) for (const cron of cronsAt(event)) for (const job of jobsFor(cron, date)) site.push(line(date, job));
  }
  assert.deepEqual(site, bot, 'a start is missing, doubled or at another minute');
  assert.ok(bot.some(entry => entry.includes('desktop.yml') && entry.includes('"nightly":"true"')), 'the nightly');
  for (const [index, slot] of NIGHT_SLOTS.entries()) assert.ok(bot.some(entry => entry.includes(`"night_pass":"${index + 1}/5"`) && entry.includes(`T${slot}:00`)), `night pass ${index + 1} at ${slot}`);
  assert.equal(bot.filter(entry => entry.includes('e2e.yml') && entry.includes('"scheduled":"true"')).length, 3, 'the three-a-day e2e');
  assert.ok(dueStarts(at(12, 0)).length > 0, 'the watchdog still derives its due starts from CRONS');
});

test('it is dormant: without TIMERS=on nothing is dispatched and nothing is asked of the token', async () => {
  for (const env of [{}, {TIMERS: 'off', TIMERS_GITHUB_TOKEN: 't'}, {TIMERS_GITHUB_TOKEN: 't'}]) {
    const {calls, result} = await started({cron: TICK, scheduledTime: at(3, 0).getTime()}, env);
    assert.deepEqual(calls, []);
    assert.deepEqual(result, []);
  }
});

test('on, each start goes to the public repo with the timers token, never the site token; the nightly only at 04:00 Zurich', async () => {
  const {calls} = await started({cron: TICK, scheduledTime: at(3, 0).getTime()}, {...ON, GITHUB_TOKEN: 'site-token', GITHUB_REPO: 'GarryOne/jobadabra-web'});
  assert.deepEqual(calls.map(call => [call.workflow, call.inputs?.nightly, call.repo, call.token]), [['desktop.yml', 'true', 'GarryOne/jobadabra', 'timers-token'], ['pr-verdict.yml', undefined, 'GarryOne/jobadabra', 'timers-token']]);
  assert.deepEqual((await started({cron: TICK, scheduledTime: at(2, 0).getTime()})).calls.map(call => call.workflow), ['pr-verdict.yml'], '03:00 Zurich: no nightly');
  assert.deepEqual((await started({cron: TICK, scheduledTime: at(21, 0).getTime()})).calls.map(call => [call.workflow, call.inputs?.night_pass]), [['pr-verdict.yml', undefined], ['e2e.yml', '1/5']], 'the first night pass');
  assert.deepEqual((await started({cron: TICK, scheduledTime: at(21, 40).getTime()})).calls.map(call => [call.workflow, call.inputs?.scheduled]), [['pr-verdict.yml', undefined], ['self-heal-stats.yml', 'true']], 'the stats every third hour at :40');
  assert.deepEqual((await started({cron: OWN_CRON, scheduledTime: at(23, 47).getTime()})).calls.map(call => [call.workflow, call.inputs?.scheduled]), [['e2e.yml', 'true']], 'the three-a-day e2e');
});

test('without the timers token the start is refused out loud, and the site token is never sent to the public repo in its place', async () => {
  const calls = [];
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 0).getTime()}, {TIMERS: 'on', GITHUB_TOKEN: 'site-token'}, {dispatch: async (...args) => { calls.push(args); }, report: async () => {}}), /TIMERS_GITHUB_TOKEN is not set/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await runTimers({cron: TICK, scheduledTime: at(3, 5).getTime()}, {TIMERS: 'on'}, {dispatch: async () => { calls.push(1); }, report: async () => {}}), [], 'off a due tick a missing token is no error');
});

test('the repo is the TIMERS_REPO var, never a literal: after the org move one edit points the starts at jobadabra/jobadabra', async () => {
  const {calls} = await started({cron: OWN_CRON, scheduledTime: at(23, 47).getTime()}, {...ON, TIMERS_REPO: 'jobadabra/jobadabra'});
  assert.deepEqual(calls.map(call => [call.workflow, call.repo]), [['e2e.yml', 'jobadabra/jobadabra']]);
  const none = [];
  await assert.rejects(runTimers({cron: OWN_CRON, scheduledTime: at(23, 47).getTime()}, {TIMERS: 'on', TIMERS_GITHUB_TOKEN: 't'}, {dispatch: async () => { none.push(1); }, report: async () => {}}), /TIMERS_REPO is not set/);
  assert.deepEqual(none, [], 'no start goes to a guessed repo');
});

test('a refused start fails the trigger (after every job had its try), is reported to the watchdog issue, but a refused PR-verdict sweep is not', async () => {
  const reports = [], dispatch = async (env, inputs, workflow) => { if (workflow !== 'pr-verdict.yml') throw new Error('GitHub dispatch failed: 403'); };
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 0).getTime()}, ON, {dispatch, report: async text => { reports.push(text); }}), /scheduled start failed: desktop\.yml: GitHub dispatch failed: 403/);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /could not start desktop\.yml/);
  const sweep = [];
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 10).getTime()}, ON, {dispatch: async () => { throw new Error('GitHub dispatch failed: 403'); }, report: async text => { sweep.push(text); }}), /pr-verdict\.yml/);
  assert.deepEqual(sweep, [], 'a failed ten-minute sweep does not page the issue 144 times a day');
});

test('no timer workflow is one the site Worker queues for triage instead of starting', () => {
  for (const cron of CRONS) for (const job of jobsFor(cron, at(3, 0)).concat(jobsFor(cron, at(21, 40)), jobsFor(cron, at(21, 0)), jobsFor(cron, at(21, 47)))) assert.equal(queued(job.workflow), false, job.workflow);
});

test('the site Worker\'s */5 trigger starts the due timers through GitHub, and a refusal does not stop the tick\'s other work', async () => {
  const requests = [], realFetch = globalThis.fetch, realError = console.error, errors = [];
  globalThis.fetch = async (url, init) => { requests.push({url: String(url), method: init?.method, auth: init?.headers?.Authorization, body: init?.body}); return new Response(null, {status: String(url).includes('api.github.com') ? 204 : 200}); };
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const run = async (cron, date, env) => { const tasks = []; await worker.scheduled({cron, scheduledTime: date.getTime()}, env, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
    const starts = () => requests.filter(request => request.url.includes('/actions/workflows/')).map(request => [request.url.split('/workflows/')[1].split('/')[0], request.auth]);
    await run(TICK, at(21, 0), {...ON, GITHUB_REPO: 'GarryOne/jobadabra-web', GITHUB_TOKEN: 'site-token'});
    assert.deepEqual(starts().filter(([workflow]) => ['pr-verdict.yml', 'e2e.yml'].includes(workflow)), [['pr-verdict.yml', 'Bearer timers-token'], ['e2e.yml', 'Bearer timers-token']]);
    requests.length = 0;
    await run(TICK, at(21, 0), {GITHUB_REPO: 'GarryOne/jobadabra-web', GITHUB_TOKEN: 'site-token'});
    assert.deepEqual(starts().filter(([workflow]) => ['pr-verdict.yml', 'desktop.yml'].includes(workflow)), [], 'dormant by default');
    requests.length = 0;
    globalThis.fetch = async () => new Response(null, {status: 403});
    await run(TICK, at(21, 0), ON);
    assert.ok(errors.some(line => line.startsWith('timers:') && line.includes('403')), 'a refusal is logged by the trigger');
  } finally { globalThis.fetch = realFetch; console.error = realError; }
});

test('the 47 trigger starts the e2e run and nothing else: it never falls through to the daily jobs, and a refused start fails the trigger itself', async () => {
  const touched = [], realFetch = globalThis.fetch, requests = [];
  const env = {...ON, STATS: new Proxy({}, {get: (_, name) => { touched.push(String(name)); return () => { throw new Error('daily job ran'); }; }})};
  globalThis.fetch = async (url) => { requests.push(String(url)); return new Response(null, {status: 204}); };
  try {
    await worker.scheduled({cron: OWN_CRON, scheduledTime: at(23, 47).getTime()}, env, {waitUntil: () => { touched.push('waitUntil'); }});
    assert.deepEqual(touched, [], 'no daily job (pool rollup, canary, mail digests …) started');
    assert.deepEqual(requests.map(url => url.split('/workflows/')[1]), ['e2e.yml/dispatches']);
    globalThis.fetch = async () => new Response(null, {status: 403});
    await assert.rejects(worker.scheduled({cron: OWN_CRON, scheduledTime: at(23, 47).getTime()}, env, {waitUntil: () => {}}), /e2e\.yml: GitHub dispatch failed: 403/);
  } finally { globalThis.fetch = realFetch; }
});

test('www\'s wrangler.toml carries the timers: the 47 trigger, TIMERS on, and the public repo as TIMERS_REPO (the account allows 5 cron triggers)', () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  const crons = JSON.parse(toml.match(/^crons = (\[[^\]]*\])/m)[1]);
  assert.ok(crons.includes(OWN_CRON) && crons.includes(TICK), 'the */5 tick and the 47 trigger are both listed');
  assert.ok(crons.length <= 3, `www uses ${crons.length} of the account's 5 cron triggers; the other Workers need the rest`);
  assert.match(toml, /^TIMERS = "on"$/m);
  assert.match(toml, /^TIMERS_REPO = "[\w.-]+\/[\w.-]+"$/m);
});
