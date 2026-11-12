// The one shared alert for scheduled jobs (shared/job-alert.js; owner, 12 Nov 2026: "One shared alert"): a job going green → red → red → green tells Engineering once each way,
// a refused Worker start tells once a day, a job with its own alert and a switched-off job tell nothing. Fake Telegram only, never the real one.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {connect, saveSetting} from '../../../shared/notify.js';
import {TICK, runTimers} from '../../../shared/timers.js';
import {OWN_ALERT, alertJobs, jobKey, alertNotStarted, readMuted, setJobMuted} from '../../../shared/job-alert.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', T0 = new Date('2026-11-12T10:00:00Z');
const hour = n => new Date(T0.getTime() + n * 3600000);
function telegram() {
  const calls = [];
  const fetcher = async (url, init) => {
    const [, , method] = /bot([^/]+)\/(\w+)$/.exec(url), body = JSON.parse(init.body || '{}');
    calls.push({method, body});
    const reply = result => new Response(JSON.stringify({ok: true, result}), {status: 200});
    return method === 'getMe' ? reply({username: 'a_bot'}) : method === 'getChat' ? reply({title: 'Engineering', id: body.chat_id}) : method === 'getUpdates' ? reply([{message: {chat: {id: 777}}}]) : reply({message_id: 9});
  };
  return {fetcher, sends: () => calls.filter(call => call.method === 'sendMessage').map(call => call.body.text.replace(/<[^>]+>/g, ''))};
}
async function setup({connected = true} = {}) {
  const e = {STATS: d1(), NOTIFY_SECRET: 'vault-secret'}, tg = telegram();
  if (connected) await connect(e, 'engineering', TOKEN, '', tg.fetcher, T0);
  return {e, tg};
}
const run = (conclusion, n = 0) => ({at: hour(n).toISOString(), conclusion, mins: 2, url: `https://github.com/jobadabra/jobadabra-lab/actions/runs/${100 + n}`});
const snap = (conclusion, n, extra = {}) => ({jobs: [{repo: 'jobadabra/jobadabra-lab', file: 'board-discovery.yml', name: 'Lab · Board discovery', disabled: false, recent: [run(conclusion, n)], ...extra}]});

test('a job going green, red, red, green tells once each way: ❌ with name, repo and run link, then ✅ works again', async () => {
  const {e, tg} = await setup();
  await alertJobs(e, snap('success', 0), {fetcher: tg.fetcher, now: hour(0)});
  assert.deepEqual(tg.sends(), [], 'first sight is a baseline, not news');
  const first = await alertJobs(e, snap('failure', 1), {fetcher: tg.fetcher, now: hour(1)});
  await alertJobs(e, snap('failure', 2), {fetcher: tg.fetcher, now: hour(2)});
  assert.deepEqual(first, {red: 1, green: 0});
  assert.equal(tg.sends().length, 1, 'a second red run in the same streak tells nothing');
  assert.match(tg.sends()[0], /Lab · Board discovery failed/);
  assert.match(tg.sends()[0], /jobadabra-lab/);
  const back = await alertJobs(e, snap('success', 3), {fetcher: tg.fetcher, now: hour(3)});
  assert.deepEqual(back, {red: 0, green: 1});
  assert.equal(tg.sends().length, 2);
  assert.match(tg.sends()[1], /Lab · Board discovery works again/);
  await alertJobs(e, snap('success', 4), {fetcher: tg.fetcher, now: hour(4)});
  assert.equal(tg.sends().length, 2, 'a green after a green tells nothing');
});

test('the streak survives a Worker restart: the state is in D1, a fresh call with the same database does not tell the same red again', async () => {
  const {e, tg} = await setup();
  await alertJobs(e, snap('success', 0), {fetcher: tg.fetcher, now: hour(0)});
  await alertJobs(e, snap('failure', 1), {fetcher: tg.fetcher, now: hour(1)});
  await alertJobs({...e}, snap('failure', 2), {fetcher: tg.fetcher, now: hour(2)});
  assert.equal(tg.sends().length, 1);
});

test('a job with its own failure alert tells nothing here, and a switched-off job (its switch or the registry switch) tells nothing', async () => {
  const {e, tg} = await setup();
  const own = {repo: 'jobadabra/jobadabra-lab', file: 'central-scout.yml', name: 'Lab · Central scout'};
  assert.ok(OWN_ALERT.has('jobadabra-lab/central-scout.yml'));
  await alertJobs(e, snap('success', 0, own), {fetcher: tg.fetcher, now: hour(0)});
  await alertJobs(e, snap('failure', 1, own), {fetcher: tg.fetcher, now: hour(1)});
  assert.deepEqual(tg.sends(), [], 'central-scout sends its own alert');
  assert.equal(e.STATS.db.prepare("SELECT state FROM job_alert WHERE job = 'jobadabra-lab/central-scout.yml'").get().state, 'red', 'its state is still kept');

  await setJobMuted(e.STATS, 'jobadabra-lab/board-discovery.yml', true, T0);
  assert.deepEqual([...await readMuted(e.STATS)], ['jobadabra-lab/board-discovery.yml']);
  await alertJobs(e, snap('success', 0), {fetcher: tg.fetcher, now: hour(0)});
  await alertJobs(e, snap('failure', 1), {fetcher: tg.fetcher, now: hour(1)});
  await alertJobs(e, snap('success', 2), {fetcher: tg.fetcher, now: hour(2)});
  assert.deepEqual(tg.sends(), [], 'the per-job switch is off: neither ❌ nor ✅');

  await setJobMuted(e.STATS, 'jobadabra-lab/board-discovery.yml', false, T0);
  await saveSetting(e, 'scheduled-job-red', {enabled: false}, T0);
  await alertJobs(e, snap('failure', 3), {fetcher: tg.fetcher, now: hour(3)});
  assert.deepEqual(tg.sends(), [], 'the registry switch (Admin → Notifications) is off');
});

test('a ❌ the switchboard could not deliver is tried again on the next snapshot, never lost', async () => {
  const {e, tg} = await setup({connected: false});
  await alertJobs(e, snap('success', 0), {fetcher: tg.fetcher, now: hour(0)});
  await alertJobs(e, snap('failure', 1), {fetcher: tg.fetcher, now: hour(1)});
  assert.deepEqual(tg.sends(), []);
  await connect(e, 'engineering', TOKEN, '', tg.fetcher, hour(2));
  await alertJobs(e, snap('failure', 2), {fetcher: tg.fetcher, now: hour(2)});
  assert.equal(tg.sends().length, 1, 'told once the channel was connected');
});

test('a refused Worker start tells once a day per job with GitHub\'s status; the next day it tells again; a start that worked tells nothing', async () => {
  const {e, tg} = await setup();
  const refused = [{workflow: 'board-discovery.yml', error: 'GitHub dispatch failed: 422'}, {workflow: 'central-scout.yml'}];
  assert.equal(await alertNotStarted(e, refused, {fetcher: tg.fetcher, now: hour(0)}), 1);
  assert.equal(await alertNotStarted(e, refused, {fetcher: tg.fetcher, now: hour(2)}), 0, 'the same job, the same day');
  assert.equal(tg.sends().length, 1);
  assert.match(tg.sends()[0], /Could not start board-discovery\.yml/);
  assert.match(tg.sends()[0], /GitHub answered 422/);
  assert.equal(await alertNotStarted(e, refused, {fetcher: tg.fetcher, now: hour(24)}), 1, 'the next day');
  const other = [{workflow: 'central-scout.yml', error: 'BRAIN_GITHUB_TOKEN is not set (the lab repo\'s token)'}];
  assert.equal(await alertNotStarted(e, other, {fetcher: tg.fetcher, now: hour(24)}), 1, 'another job, the same day');
  await setJobMuted(e.STATS, 'jobadabra-web/schedules-snapshot.yml', true, T0);
  assert.equal(await alertNotStarted(e, [{workflow: 'schedules-snapshot.yml', error: 'GitHub dispatch failed: 403'}], {fetcher: tg.fetcher, now: hour(24)}), 0, 'the job\'s switch is off');
});

test('the Worker\'s */5 tick that GitHub refuses (422) tells Engineering once; the next tick the same day is silent', async () => {
  const {e, tg} = await setup(), realFetch = globalThis.fetch, realError = console.error;
  const env = {...e, E2E_INTEL_GITHUB_TOKEN: 't', TIMERS_REPO: 'jobadabra/jobadabra', TIMERS_GITHUB_TOKEN: 't', BRAIN_GITHUB_TOKEN: 'b', GITHUB_REPO: 'jobadabra/jobadabra', GITHUB_TOKEN: 't'};
  globalThis.fetch = async (url, init) => (String(url).includes('api.github.com') ? new Response('{"message":"Unprocessable"}', {status: 422}) : tg.fetcher(url, init));
  console.error = () => {};
  try {
    const tick = async minute => { const tasks = []; await worker.scheduled({cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 10, 12, 12, minute)}, env, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
    await tick(45);
    assert.equal(tg.sends().length, 1);
    assert.match(tg.sends()[0], /Could not start board-discovery\.yml/);
    assert.match(tg.sends()[0], /GitHub answered 422/);
    await tick(45);
    assert.equal(tg.sends().length, 1, 'the same job, the same day');
  } finally { globalThis.fetch = realFetch; console.error = realError; }
});

test('the own-alert list is keyed by repo and file: the lab\'s central scout is covered, the same file name in another repo is another job', () => {
  for (const key of OWN_ALERT.keys()) assert.match(key, /^(jobadabra|jobadabra-web|jobadabra-lab)\/[\w.-]+\.yml$/, `${key}: <repo>/<file>.yml, repo without the owner`);
  assert.equal(jobKey({repo: 'jobadabra/jobadabra-lab', file: 'central-scout.yml'}), 'jobadabra-lab/central-scout.yml');
  assert.ok(OWN_ALERT.has(jobKey({repo: 'jobadabra/jobadabra-lab', file: 'central-scout.yml'})));
  assert.ok(!OWN_ALERT.has(jobKey({repo: 'jobadabra/jobadabra', file: 'central-scout.yml'})));
});

test('a cancelled or skipped run decides nothing: red, cancelled, skipped stays one red streak and tells no false "works again"; only a success ends it (Gitar, #586)', async () => {
  const {e, tg} = await setup();
  await alertJobs(e, snap('success', 0), {fetcher: tg.fetcher, now: hour(0)});
  await alertJobs(e, snap('failure', 1), {fetcher: tg.fetcher, now: hour(1)});
  const cancelled = await alertJobs(e, snap('cancelled', 2), {fetcher: tg.fetcher, now: hour(2)});
  const skipped = await alertJobs(e, snap('skipped', 3), {fetcher: tg.fetcher, now: hour(3)});
  assert.deepEqual([cancelled, skipped], [{red: 0, green: 0}, {red: 0, green: 0}]);
  assert.equal(tg.sends().length, 1, 'only the first red was told');
  await alertJobs(e, {jobs: [{...snap('cancelled', 4).jobs[0], recent: [run('cancelled', 4), run('failure', 1)]}]}, {fetcher: tg.fetcher, now: hour(4)});
  assert.equal(tg.sends().length, 1, 'a cancelled run on top of the failed one is still red: the same streak');
  await alertJobs(e, {jobs: [{...snap('success', 5).jobs[0], recent: [run('success', 5), run('cancelled', 4)]}]}, {fetcher: tg.fetcher, now: hour(5)});
  assert.equal(tg.sends().length, 2);
  assert.match(tg.sends()[1], /works again/);
});

// The public repo's on-time starts (shared/timers.js: nightly, sweeps, e2e) go through the same alert (owner, 12 Nov 2026, via mac-9a: "close the gap: the Worker can't start the run").
const TIMERS = {TIMERS: 'on', TIMERS_GITHUB_TOKEN: 't', TIMERS_REPO: 'jobadabra/jobadabra'}, at = (hour, minute, day = 12) => Date.UTC(2026, 10, day, hour, minute);
const noReport = async () => {};
test('a refused timer start tells Engineering once per job per day with GitHub\'s status; a start that worked tells nothing', async () => {
  const {e, tg} = await setup(), env = {...e, ...TIMERS}, refuse = async (_env, _inputs, workflow) => { if (workflow === 'desktop.yml') throw new Error('GitHub dispatch failed: 403'); };
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 0)}, env, {dispatch: refuse, report: noReport, fetcher: tg.fetcher}), /desktop\.yml/, 'the trigger still fails loudly, as before');
  assert.equal(tg.sends().length, 1, 'only desktop.yml was refused; pr-verdict.yml and pr-labels.yml started');
  assert.match(tg.sends()[0], /Could not start /);
  assert.match(tg.sends()[0], /GitHub answered 403/);
  assert.match(tg.sends()[0], /jobadabra\b/);
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 0)}, env, {dispatch: refuse, report: noReport, fetcher: tg.fetcher}));
  assert.equal(tg.sends().length, 1, 'the same job, the same day');
  await assert.rejects(runTimers({cron: TICK, scheduledTime: at(3, 0, 13)}, env, {dispatch: refuse, report: noReport, fetcher: tg.fetcher}));
  assert.equal(tg.sends().length, 2, 'the next day');
  await runTimers({cron: TICK, scheduledTime: at(3, 0, 14)}, env, {dispatch: async () => {}, report: noReport, fetcher: tg.fetcher});
  assert.equal(tg.sends().length, 2, 'every start worked: nothing');
});

test('a refused ten-minute sweep (pr-verdict) is told once a day, not 144 times, and the watchdog issue still hears nothing of it', async () => {
  const {e, tg} = await setup(), env = {...e, ...TIMERS}, reports = [];
  for (const minute of [10, 20, 30]) await assert.rejects(runTimers({cron: TICK, scheduledTime: at(10, minute)}, env, {dispatch: async () => { throw new Error('GitHub dispatch failed: 403'); }, report: async text => { reports.push(text); }, fetcher: tg.fetcher}));
  assert.deepEqual(reports.filter(text => /pr-verdict/.test(text)), []);
  assert.equal(tg.sends().filter(text => /pr-verdict/.test(text)).length, 1);
});
