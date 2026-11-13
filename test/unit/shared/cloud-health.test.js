// Guard: release — the owner is told when a container nears its memory, CPU or disk size, when one of our Workers fails far above its normal week, and when Always on runs or Apply
// fills fail in numbers; without it a runner killed for memory or a site throwing 5xx stays silent (owner, 13 Nov 2026: "memory/cpu/disk alert" · "HTTP Error rate or container error rate").
// Each signal: nothing under its warning line, 🟠 past it, 🔴 at its critical line, once a day; a missing token skips the Cloudflare half only; a broken read never fails the tick.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SIZE_FROM_CODE, cloudHealth, label} from '../../../shared/cloud-health.js';
import {INSTANCE} from '../../../workers/ai-broker/lib/do-container.mjs';

const GIB = 2 ** 30, DAY = new Date('2026-11-13T19:00:00Z'), NEXT_DAY = new Date('2026-11-14T19:00:00Z');
const kv = () => { const m = new Map(); return {get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
const APPS = [{id: 'aaaa-1', name: 'www-hosted-runner-hostedrunner', configuration: {memory_mib: 4096}}, {id: '5375b146b9b34714b745514835ad10fc', name: 'ai-broker-next', configuration: {}}];

// A stand-in for Cloudflare (app list, container metrics, Worker invocations: the last hour vs the week) and Telegram (every card's text lands in `sent`).
function cloud({containers = [], hour = [], week = [], down = false} = {}) {
  const sent = [];
  const fetcher = async (url, init = {}) => {
    if (/telegram/.test(url)) { sent.push(JSON.parse(init.body).text); return new Response('{"ok":true,"result":{"message_id":1}}'); }
    if (down) throw new Error('cloudflare down');
    if (/containers\/applications/.test(url)) return Response.json({result: APPS});
    const {query, variables} = JSON.parse(init.body);
    if (/containersMetrics/.test(query)) return Response.json({data: {viewer: {accounts: [{containersMetricsAdaptiveGroups: containers}]}}});
    const longAgo = DAY - new Date(variables.since) > 2 * 3600000;
    return Response.json({data: {viewer: {accounts: [{workersInvocationsAdaptive: longAgo ? week : hour}]}}});
  };
  return {sent, fetcher};
}
const box = (id, memory, cpu = 0.2, disk = 0.2) => ({dimensions: {applicationId: id}, max: {memory, diskUsagePercentage: disk}, quantiles: {cpuUtilizationP95: cpu}});
const calls = (scriptName, ok, bad, status = 'success') => [{dimensions: {scriptName, status: 'success', httpResponseStatus: 200}, sum: {requests: ok}}, {dimensions: {scriptName, status, httpResponseStatus: status === 'success' ? 503 : 0}, sum: {requests: bad}}];
const stats = (runs = {n: 0, bad: 0}, fills = {n: 0, bad: 0}) => ({prepare: sql => ({bind: () => ({first: async () => (/hosted_runs/.test(sql) ? runs : fills)})})});
const env = extra => ({WAITLIST: kv(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c', CF_ACCOUNT_ID: 'acct', CF_HEALTH_TOKEN: 'tok', STATS: stats(), ...extra});

test('the AI broker\'s size in the check is the size its code starts it with', () => {
  assert.equal(SIZE_FROM_CODE['ai-broker-next'], INSTANCE.memoryMib);
  assert.deepEqual(['www-hosted-runner-hostedrunner', 'find-jobs-runner-x', 'www-ready-runner-readyrunner', 'apply-runner-x', 'ai-broker-next'].map(label),
    ['Find jobs runner', 'Find jobs runner', 'Apply runner', 'Apply runner', 'AI broker']);
});

test('memory, CPU, disk: nothing under 80%, 🟠 past it, 🔴 at the critical line, once a day each', async () => {
  const e = env();
  let c = cloud({containers: [box('aaaa-1', 3 * GIB), box('5375b146-b9b3-4714-b745-514835ad10fc', 4.47e9)]});   // 75% and the broker's measured 13 Nov peak (69% of 6 GiB)
  assert.deepEqual((await cloudHealth(e, {now: DAY, fetcher: c.fetcher})).told, []);
  assert.equal(c.sent.length, 0);
  c = cloud({containers: [box('aaaa-1', 3.4 * GIB, 0.85, 0.5)]});
  assert.deepEqual((await cloudHealth(e, {now: DAY, fetcher: c.fetcher})).told, ['health-memory:www-hosted-runner-hostedrunner', 'health-cpu:www-hosted-runner-hostedrunner']);
  assert.match(c.sent[0], /^🟠[^]*Find jobs runner \(www-hosted-runner-hostedrunner\): memory passed its warning line: 85% of 95%/);
  assert.match(c.sent[0], /Open Cloudflare Observability/); assert.doesNotMatch(c.sent[0], /AI costs|reopen/);
  c = cloud({containers: [box('aaaa-1', 3.9 * GIB, 1.0, 0.96)]});
  await cloudHealth(e, {now: DAY, fetcher: c.fetcher});
  assert.deepEqual(c.sent.map(text => text.slice(0, 2)), ['🔴', '🔴', '🔴'], 'memory 95%, CPU 100%, disk 96%');
  assert.match(c.sent[2], /disk is at its critical line/);
  c = cloud({containers: [box('aaaa-1', 3.9 * GIB, 1.0, 0.96)]});
  await cloudHealth(e, {now: DAY, fetcher: c.fetcher});
  assert.equal(c.sent.length, 0, 'once a day');
  await cloudHealth(e, {now: NEXT_DAY, fetcher: c.fetcher});
  assert.equal(c.sent.length, 3, 'the next day tells again');
});

test('a Worker\'s failed replies: judged against its own normal week, 10 failures an hour at least, our Workers only', async () => {
  const week = [...calls('www', 64000, 26), ...calls('jobadabra-ai-broker', 87000, 1150), ...calls('personal-finance-monitor', 100, 7, 'scriptThrewException'), ...calls('www-staging', 30, 30)];
  let c = cloud({week, hour: [...calls('www', 980, 20), ...calls('jobadabra-ai-broker', 1470, 30), ...calls('personal-finance-monitor', 10, 90, 'scriptThrewException'), ...calls('www-staging', 0, 50), ...calls('www-hosted-runner', 1, 9)]});
  const e = env();
  assert.deepEqual((await cloudHealth(e, {now: DAY, fetcher: c.fetcher})).told, ['health-errors:www'], 'www 2% against 0.04%; the broker 2% is inside 3x its 1.3%; 9 failures is noise');
  assert.match(c.sent[0], /^🟠[^]*Worker www: failed replies in the last hour \(its normal week: 0\.04%\)[^]*2% of 10%/);
  c = cloud({week, hour: [...calls('www', 850, 150), ...calls('jobadabra-ai-broker', 1000, 120, 'scriptThrewException')]});
  assert.deepEqual((await cloudHealth(e, {now: DAY, fetcher: c.fetcher})).told, ['health-errors:www', 'health-errors:jobadabra-ai-broker']);
  assert.deepEqual(c.sent.map(text => text.slice(0, 2)), ['🔴', '🔴'], 'www 15%, the broker 10.7% of crashes');
});

test('failed runs: Always on 🟠 at a quarter of 3+ runs and 🔴 at half; Apply 🟠 at half of 4+ fills and 🔴 when none worked', async () => {
  const run = async (runs, fills) => { const c = cloud(); await cloudHealth(env({STATS: stats(runs, fills)}), {now: DAY, fetcher: c.fetcher}); return c.sent.map(text => text.slice(0, 2)); };
  assert.deepEqual(await run({n: 2, bad: 2}, {n: 3, bad: 3}), [], 'too few to judge');
  assert.deepEqual(await run({n: 11, bad: 1}, {n: 15, bad: 3}), [], 'the normal week: 1 of 11 runs, 3 of 15 fills');
  assert.deepEqual(await run({n: 4, bad: 1}, {n: 4, bad: 2}), ['🟠', '🟠']);
  assert.deepEqual(await run({n: 4, bad: 2}, {n: 4, bad: 4}), ['🔴', '🔴']);
});

test('no token: the Cloudflare half is skipped and said, the runs half still tells; a broken Cloudflare never fails the tick', async () => {
  let c = cloud();
  const done = await cloudHealth(env({CF_HEALTH_TOKEN: undefined, STATS: stats({n: 4, bad: 2})}), {now: DAY, fetcher: c.fetcher});
  assert.deepEqual(done.told, ['health-runs:always-on']);
  assert.match(done.skipped.join(), /CF_HEALTH_TOKEN/);
  c = cloud({down: true});
  const broken = await cloudHealth(env({STATS: {prepare: () => { throw new Error('D1 down'); }}}), {now: DAY, fetcher: c.fetcher});
  assert.deepEqual(broken.told, []);
  assert.deepEqual(broken.skipped.map(why => why.split(':')[0]), ['containers', 'workers', 'runs']);
});
