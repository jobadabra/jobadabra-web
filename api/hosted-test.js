// Hosted Always on, "Test it" (owner, 4 Nov 2026: "the test button should be both for easiest (our servers) and for Advanced"; 5 Nov: "One real run"): the person presses Test on our servers' card and one real
// run starts now, the same run the cron tick would start, with each step answered in words. POST /api/hosted/test starts it; GET /api/hosted/test[?run=<id>] reads it (the install key).
// It counts like a normal run: the trial budget, the month's compute guard, the day caps and the Free AI stop all apply, plus TESTS_PER_DAY presses a day, one run at a time and COOLDOWN_MS apart.
// The schedule's own next run is never moved by a test (shared/hosted.js result()).
import {accountOf} from '../shared/pro.js';
import {digestOf} from '../shared/guard.js';
import {hostedOn, installOf, startRun} from '../shared/hosted.js';
import {addrOf} from '../shared/mail.js';
import {dayCaps, freeStopped, MONTH_COMPUTE_MICRO, monthSpent, openRun, runsToday, SITE, trialSpent} from './hosted-tick.js';

export const COOLDOWN_MS = 10 * 60 * 1000, TESTS_PER_DAY = 5, MAIL_WAIT_MS = 30 * 1000;
const say = (status, error, extra = {}) => Response.json({ok: false, error, ...extra}, {status});
const PAUSED = {'trial-over': 'Your free trial is used up.', inactive: 'Always on paused after two weeks without opening the app. Open the app to resume it.', guard: 'Always on is paused for this month.'};

/** POST starts one real run now; GET reads the latest test run (or `?run=`) as steps in words. */
export async function test(request, env, now = new Date()) {
  if (!hostedOn(env)) return new Response('Not found', {status: 404});
  const install = await installOf(request, env);
  if (!install) return say(401, 'unauthorized');
  const account = await accountOf(env, install);
  const schedule = account && await env.STATS.prepare('SELECT account, install, state, pause_reason FROM hosted_schedules WHERE account = ?').bind(account.id).first();
  if (request.method === 'GET') return report(env, account, schedule, new URL(request.url).searchParams.get('run'), now);
  if (request.method !== 'POST') return say(405, 'Use GET or POST');
  if (!schedule || schedule.state === 'off') return say(409, 'Turn Always on on first, then test it.', {reason: 'off'});
  if (schedule.state === 'paused') return say(409, PAUSED[schedule.pause_reason] || 'Always on is paused.', {reason: schedule.pause_reason || 'paused'});
  const stamp = now.toISOString();
  await env.STATS.prepare("UPDATE hosted_runs SET status = 'failed', finished_at = ? WHERE finished_at IS NULL AND expires_at < ?").bind(stamp, stamp).run();   // a run that never reported is over, as the tick treats it
  const open = await openRun(env, account.id, stamp);
  if (open) return Response.json({ok: true, run: open.id, joined: true});   // one run at a time: pressing again watches the one that is running
  // The gap is read from a window that reaches back past UTC midnight; only the daily count starts at midnight (Gitar on #372).
  const tests = await env.STATS.prepare("SELECT SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS n, MAX(started_at) AS last FROM hosted_runs WHERE account = ? AND slot LIKE 'test-%' AND started_at >= ?")
    .bind(`${stamp.slice(0, 10)}T00:00:00`, account.id, new Date(Math.min(now.getTime() - COOLDOWN_MS, Date.parse(`${stamp.slice(0, 10)}T00:00:00Z`))).toISOString()).first();
  if (tests.last && now.getTime() - Date.parse(tests.last) < COOLDOWN_MS) return say(429, 'A test ran a moment ago. Try again in a few minutes.', {reason: 'cooldown'});
  if ((tests.n || 0) >= TESTS_PER_DAY) return say(429, 'You have tested a few times today. Try again tomorrow.', {reason: 'daily'});
  if (await monthSpent(env, account.id, stamp) >= MONTH_COMPUTE_MICRO) return say(409, PAUSED.guard, {reason: 'guard'});
  const trial = !(account.plan === 'pro' && account.status === 'active');
  if (trial && await trialSpent(env, schedule.install)) return say(402, PAUSED['trial-over'], {reason: 'trial-over'});
  const today = await runsToday(env, stamp.slice(0, 10)), caps = dayCaps(env);
  if (!env.HOSTED_QUEUE || today.all >= caps.all || (trial && (today.trial >= caps.trial || await freeStopped(env, stamp)))) return say(503, 'Always on is busy right now. Try again later.', {reason: 'busy'});
  const run = await startRun(env, {account: account.id}, now, `test-${stamp.slice(0, 16)}`, true);
  if (!run) { const again = await openRun(env, account.id, stamp); return again ? Response.json({ok: true, run: again.id, joined: true}) : say(429, 'A test ran a moment ago. Try again in a few minutes.', {reason: 'cooldown'}); }
  try {
    await env.HOSTED_QUEUE.send({run: run.id, token: run.token, site: env.HOSTED_SITE || SITE, account: await digestOf(account.id), test: true});
  } catch (error) {   // a row nothing will ever post to would block the next press for 30 minutes
    await env.STATS.prepare("UPDATE hosted_runs SET status = 'failed', finished_at = ? WHERE id = ?").bind(stamp, run.id).run();
    return say(503, 'Always on is busy right now. Try again later.', {reason: 'busy'});
  }
  return Response.json({ok: true, run: run.id});
}

// The steps of one run, each as {key, label, state: ok | running | failed | skipped, note?}. Only what the site recorded is claimed.
async function report(env, account, schedule, runId, now) {
  const run = account && await env.STATS.prepare(runId ? 'SELECT * FROM hosted_runs WHERE account = ? AND id = ?' : "SELECT * FROM hosted_runs WHERE account = ? AND slot LIKE 'test-%' ORDER BY started_at DESC LIMIT 1")
    .bind(...(runId ? [account.id, runId] : [account.id])).first();
  if (!run) return Response.json({ok: true, run: null});
  const over = !run.finished_at && Date.parse(run.expires_at) < now.getTime();
  const status = over ? 'failed' : run.finished_at ? run.status : 'running';
  const held = env.HOSTED_STATE?.head ? !!await env.HOSTED_STATE.head(`hosted/${account.id}/config.json`) : false;
  const found = status === 'ok' ? (await env.STATS.prepare('SELECT COUNT(*) AS n FROM hosted_inbox WHERE run = ?').bind(run.id).first()).n : 0;   // what reached the inbox, not what the run reported (a job already held is dropped)
  const mailed = status === 'ok' && found ? await digestSent(env, account, run) : false;
  // The result post closes the run first and sends the digest last: a read in between is not an answer yet.
  const settling = status === 'ok' && found > 0 && !mailed && now.getTime() - Date.parse(run.finished_at) < MAIL_WAIT_MS;
  const steps = [
    {key: 'on', label: 'Always on is on for you', state: schedule?.state === 'on' ? 'ok' : 'failed'},
    {key: 'profile', label: 'Your profile is held on our servers', state: held ? 'ok' : 'failed'},
    {key: 'started', label: 'The search started', state: 'ok'},
    {key: 'finished', label: 'The search finished', state: status === 'running' ? 'running' : status === 'ok' ? 'ok' : 'failed', ...(over ? {note: 'It did not report back.'} : {})},
  ];
  if (status === 'ok') {
    steps.push({key: 'found', label: 'New jobs found', state: 'ok', note: `${found}`});
    steps.push({key: 'mail', label: 'The e-mail was sent', state: mailed ? 'ok' : settling ? 'running' : 'skipped', ...(mailed || settling ? {} : {note: found ? 'No e-mail went out (one every 4 hours, or the address is off).' : 'Nothing new, so no e-mail.'})});
  }
  return Response.json({ok: true, run: {id: run.id, startedAt: run.started_at, status: settling ? 'running' : status, found: status === 'ok' ? found : null, steps}});
}

// A digest sent to this account's address while this run was open or just after it: not a later run's.
async function digestSent(env, account, run) {
  const row = await env.STATS.prepare('SELECT email FROM pro_accounts WHERE id = ?').bind(account.id).first();
  if (!row?.email) return false;
  const until = new Date(Date.parse(run.finished_at) + 10 * 60 * 1000).toISOString();
  const sent = await env.STATS.prepare("SELECT 1 AS x FROM mail_log WHERE addr = ? AND template = 'digest' AND status = 'sent' AND at >= ? AND at <= ? LIMIT 1").bind(await addrOf(row.email), run.started_at, until).first();
  return !!sent;
}
