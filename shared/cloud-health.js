// The cloud's health in the 5-minute tick: each container app's memory, CPU and disk, each Worker's error rate, and the share of failed Always on runs and Apply fills, told to the owner
// as 🟠 warning and 🔴 critical cards through the cap alert (shared/cap-check.js, once a day per thing and level, flags in KV).
// Why (13 Nov 2026, owner: "if some runners/containers are getting low on memory or CPU, can I get alerted?" · "memory/cpu/disk alert" · "HTTP Error rate or container error rate or log
// error rate"; asked via AskUserQuestion: "Add it as PR 2/6 (Recommended)", "All ours (Recommended)"): Cloudflare's own Monitors cannot read container metrics or our D1, and they would sit
// outside the switchboard. Lines: resources 80% / 95% of the app's size (100% is never seen, the container is killed first), CPU 80% / 100%; error and failure lines start from a normal
// week (13 Nov 2026, 7 days: www 0.04% 5xx, AI broker 1.3%, Always on 1 of 11 runs failed, Apply 3 of 15 fills failed).
// Needs CF_ACCOUNT_ID (wrangler var) and the Worker secret CF_HEALTH_TOKEN (Workers Containers: Read + Account Analytics: Read); without it the Cloudflare half is skipped, the D1 half runs.
// Invariants: never rejects, so the tick cannot fail on it; a card holds app and Worker names and counts only, never a person.
import {checkCap} from './cap-check.js';
import {send} from './cap-alerts.js';

const API = 'https://api.cloudflare.com/client/v4';
const HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY;
// Our Workers, by name: the site, its runners, the AI broker; the staging copies and the account's other Workers are left out.
export const OURS = name => /^(www|jobadabra-|find-jobs-runner|apply-runner)/.test(name) && !/-staging/.test(name);
// What the owner calls each container app (an app is named by its Worker and class).
export const label = app => /hosted-runner|find-jobs/.test(app) ? 'Find jobs runner' : /ready-runner|apply-runner/.test(app) ? 'Apply runner' : /ai-broker/.test(app) ? 'AI broker' : app;
// A status that is the Worker's own failure, not the caller's (a disconnect is the caller leaving).
const FAILED = new Set(['scriptThrewException', 'exceededResources', 'exceededCpu', 'exceededMemory', 'internalError']);

// An app on the durable_object policy sets its own size when it starts, so Cloudflare's app list has none: its memory in MiB, held equal to the code by test/unit/shared/cloud-health.test.js.
export const SIZE_FROM_CODE = {'ai-broker-next': 6144};   // workers/ai-broker/lib/do-container.mjs INSTANCE.memoryMib

// A health card's words: a warning and a critical line, not a spend stop; its link is the Cloudflare dashboard's observability, where the cause is.
const WORDS = {reached: 'is at its critical line', approaching: 'passed its warning line', reopen: 'To fix it', move: 'Before it gets there'};
const LINK = {text: 'Open Cloudflare Observability', url: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages/observability'};
const cap = (name, title, event, approach, line, sees, fix) => ({name, title, event, period: 'day', unit: 'share', line: () => line, approach: () => approach, sees, fix, words: WORDS, link: LINK});

/** One Cloudflare GraphQL read. -> the account's node, or null. */
async function graphql(env, query, variables, fetcher) {
  const answer = await fetcher(`${API}/graphql`, {method: 'POST', headers: {authorization: `Bearer ${env.CF_HEALTH_TOKEN}`, 'content-type': 'application/json'},
    body: JSON.stringify({query, variables: {account: env.CF_ACCOUNT_ID, ...variables}}), signal: AbortSignal.timeout(20000)});
  return (await answer.json())?.data?.viewer?.accounts?.[0] ?? null;
}

/** Each container app's peak memory and disk (% of its size) and hourly p95 CPU (% of its vCPU) over the last hour. -> [{app, memory, cpu, disk}] (null where unknown). */
export async function containerLoad(env, {now = new Date(), fetcher = fetch} = {}) {
  const apps = (await (await fetcher(`${API}/accounts/${env.CF_ACCOUNT_ID}/containers/applications`, {headers: {authorization: `Bearer ${env.CF_HEALTH_TOKEN}`}, signal: AbortSignal.timeout(20000)})).json())?.result || [];
  const node = await graphql(env, `query($account: String, $since: Time) { viewer { accounts(filter: {accountTag: $account}) { containersMetricsAdaptiveGroups(limit: 200, filter: {datetime_geq: $since}) {
    dimensions { applicationId } max { memory diskUsagePercentage } quantiles { cpuUtilizationP95 } } } } }`, {since: new Date(now - HOUR).toISOString()}, fetcher);
  const plain = id => String(id).replace(/-/g, '');
  return (node?.containersMetricsAdaptiveGroups || []).map(row => {
    const app = apps.find(a => plain(a.id) === plain(row.dimensions.applicationId)), size = Number(app?.configuration?.memory_mib || SIZE_FROM_CODE[app?.name]) * 1048576;
    return {app: app?.name ?? row.dimensions.applicationId, memory: size > 0 ? 100 * row.max.memory / size : null,
      cpu: row.quantiles.cpuUtilizationP95 == null ? null : 100 * row.quantiles.cpuUtilizationP95, disk: row.max.diskUsagePercentage == null ? null : 100 * row.max.diskUsagePercentage};
  });
}

/** Each of our Workers' failed share (its own crashes and 5xx replies) in the last hour and the last week. -> [{script, bad, requests, hour, week}] (shares in %). */
export async function workerErrors(env, {now = new Date(), fetcher = fetch} = {}) {
  const read = async since => (await graphql(env, `query($account: String, $since: Time) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 2000, filter: {datetime_geq: $since}) {
    dimensions { scriptName status httpResponseStatus } sum { requests } } } } }`, {since: new Date(now - since).toISOString()}, fetcher))?.workersInvocationsAdaptive || [];
  const tally = rows => rows.reduce((all, {dimensions: d, sum}) => {
    if (!OURS(d.scriptName)) return all;
    const one = all[d.scriptName] ??= {bad: 0, requests: 0};
    one.requests += sum.requests;
    if (FAILED.has(d.status) || d.httpResponseStatus >= 500) one.bad += sum.requests;
    return all;
  }, {});
  const [hour, week] = await Promise.all([read(HOUR), read(WEEK)]).then(([h, w]) => [tally(h), tally(w)]);
  const share = one => one && one.requests ? 100 * one.bad / one.requests : 0;
  return Object.entries(hour).map(([script, one]) => ({script, bad: one.bad, requests: one.requests, hour: share(one), week: share(week[script])}));
}

/** The last day's ended Always on runs and Apply fills, and how many failed (a run past its token without a result counts as failed: the container died). */
export async function runFailures(env, {now = new Date()} = {}) {
  const since = new Date(now - DAY).toISOString(), at = now.toISOString();
  const [runs, fills] = await Promise.all([
    env.STATS.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'failed' OR (status = 'running' AND expires_at < ?) THEN 1 ELSE 0 END) AS bad FROM hosted_runs WHERE started_at > ? AND (finished_at IS NOT NULL OR expires_at < ?)").bind(at, since, at).first(),
    env.STATS.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS bad FROM ready_jobs WHERE at > ? AND state != 'queued'").bind(since).first()]);
  return {runs: {n: Number(runs?.n) || 0, bad: Number(runs?.bad) || 0}, fills: {n: Number(fills?.n) || 0, bad: Number(fills?.bad) || 0}};
}

/**
 * The 5-minute look: reads the three, then one cap check per container metric, Worker and run kind. -> {told: [cap names a card went out for], skipped: [why a half did not run]}.
 * A metric is reached (🔴) at its line; the cap alert sends each level once a day. Never rejects.
 */
export async function cloudHealth(env, {now = new Date(), fetcher = fetch} = {}) {
  const told = [], skipped = [], store = env.WAITLIST;
  const check = async (c, used, reached) => { if (store && await checkCap(env, c, used, {now, reached, store, send: (event, level, text) => send(env, event, level, text, fetcher)})) told.push(c.name); };
  const half = async (why, work) => { try { await work(); } catch (error) { skipped.push(`${why}: ${error.message}`); } };
  if (env.CF_HEALTH_TOKEN && env.CF_ACCOUNT_ID) {
    await half('containers', async () => {
      for (const {app, memory, cpu, disk} of await containerLoad(env, {now, fetcher})) {
        const who = `${label(app)} (${app})`;
        if (memory != null) await check(cap(`health-memory:${app}`, `${who}: memory`, 'cloud-resources', 80, 95, 'past 100% the container is killed and its run or night is lost', 'a bigger instance_type in its wrangler.jsonc, or find what holds the memory'), memory, memory >= 95);
        if (cpu != null) await check(cap(`health-cpu:${app}`, `${who}: CPU (p95 over the last hour)`, 'cloud-resources', 80, 100, 'at 100% every run on it is slowed down', 'more vCPU (instance_type) or less work per container'), cpu, cpu >= 100);
        if (disk != null) await check(cap(`health-disk:${app}`, `${who}: disk`, 'cloud-resources', 80, 95, 'a full disk fails the next file write of the run', 'a bigger disk (instance_type) or clean the work folder'), disk, disk >= 95);
      }
    });
    await half('workers', async () => {
      for (const {script, bad, hour, week} of await workerErrors(env, {now, fetcher})) {
        if (bad < 10) continue;   // a handful of failures in an hour is noise at our traffic, whatever the share
        const near = Math.max(1, 3 * week), line = Math.max(10, near);
        await check(cap(`health-errors:${script}`, `Worker ${script}: failed replies in the last hour (its normal week: ${week.toFixed(2)}%)`, 'cloud-errors', near, line,
          'people get errors from it', 'Workers → Observability for the failing route, then Sentry'), hour, hour >= line);
      }
    });
  } else skipped.push('cloudflare: CF_HEALTH_TOKEN or CF_ACCOUNT_ID missing');
  await half('runs', async () => {
    const {runs, fills} = await runFailures(env, {now});
    const share = one => 100 * one.bad / one.n;
    if (runs.n >= 3 && runs.bad) await check(cap('health-runs:always-on', `Always on: failed runs in the last day (${runs.bad} of ${runs.n})`, 'cloud-runs', 25, 50, 'those people got no new jobs from that run', 'the run\'s log in Workers → Observability (find-jobs-runner)'), share(runs), share(runs) >= 50);
    if (fills.n >= 4 && fills.bad) await check(cap('health-runs:apply', `Apply: failed fills in the last day (${fills.bad} of ${fills.n})`, 'cloud-runs', 50, 100, 'those jobs were not prepared for the person', 'the night\'s log (apply-runner)'), share(fills), share(fills) >= 100);
  });
  return {told, skipped};
}
