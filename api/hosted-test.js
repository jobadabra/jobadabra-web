// Hosted Always on, "Test it" (owner, 4 Nov 2026: "the test button should be both for easiest (our servers) and for Advanced"): the person presses Test on our servers' card and one real
// run starts now, the same run the cron tick would start. POST /api/hosted/test starts it; GET /api/hosted/test[?run=<id>] reads it (the install key).
// Design (owner, 5 Nov 2026: "a test shuold not take more than 10 seconds"; replaces 5 Nov "One real run", whose verdict waited for the whole search):
//   the Test's verdict = four steps the site sees within seconds: Always on is on, the profile is held, our server started and read it (hosted_runs.read_at,
//   api/hosted-state.js), the AI answered one short call made with the run's own token (ai_at / ai_error, at the press). Any failed -> failed; all ok -> ok.
//   The search goes on after the verdict and is reported apart (run.search: finished, jobs found, the e-mail), never as the Test's state.
// It counts like a normal run: the trial budget, the month's compute guard, the day caps and the Free AI stop all apply, plus TESTS_PER_DAY presses a day, one run at a time and COOLDOWN_MS apart.
// The schedule's own next run is never moved by a test (shared/hosted.js result()).
import {accountOf} from '../shared/pro.js';
import {freeAi} from '../shared/free-ai.js';
import {digestOf} from '../shared/guard.js';
import {hostedOn, installOf, startRun} from '../shared/hosted.js';
import {addrOf} from '../shared/mail.js';
import {dayCaps, freeStopped, MONTH_COMPUTE_MICRO, monthSpent, openRun, runsToday, SITE, trialSpent} from './hosted-tick.js';

// READ_WAIT_MS: a container starts and reads the profile in ~10 s (production, 5 Nov 2026: 10 s); past this it did not start. AI_WAIT_MS: the AI's one short answer.
export const COOLDOWN_MS = 10 * 60 * 1000, TESTS_PER_DAY = 5, MAIL_WAIT_MS = 30 * 1000, READ_WAIT_MS = 60 * 1000, AI_WAIT_MS = 8 * 1000;

/** One short call through the Free AI route with the run's token, as the container's engine makes them. -> {ok} or {ok: false, error}, within AI_WAIT_MS. */
export async function aiAnswers(env, token, now, wait = AI_WAIT_MS) {
  const ask = freeAi(new Request(`${SITE}/api/ai/v1/messages`, {method: 'POST', headers: {'x-api-key': token, 'content-type': 'application/json', 'x-jp-action': 'hosted-test'},
    body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 5, messages: [{role: 'user', content: 'Answer with the word ok.'}]})}), env, now)
    .then(async reply => (reply.ok ? {ok: true} : {ok: false, error: (await reply.json().catch(() => ({})))?.error?.message || `The AI answered ${reply.status}.`}), () => ({ok: false, error: 'The AI did not answer.'}));
  let timer;
  const late = new Promise(done => { timer = setTimeout(() => done({ok: false, error: 'The AI is slow right now.'}), wait); });
  try { return await Promise.race([ask, late]); } finally { clearTimeout(timer); }
}
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
  const ai = await aiAnswers(env, run.token, now);
  await env.STATS.prepare('UPDATE hosted_runs SET ai_at = ?, ai_error = ? WHERE id = ?').bind(ai.ok ? new Date().toISOString() : null, ai.ok ? null : ai.error, run.id).run()
    .catch(error => console.error(`hosted ai_at not stamped for ${run.id}: ${error.message}`));   // the run is queued: a failed stamp costs the Test its step, not the press
  return Response.json({ok: true, run: run.id});
}

const verdict = steps => (steps.some(s => s.state === 'failed') ? 'failed' : steps.every(s => s.state === 'ok') ? 'ok' : 'running');

// One Test: {status (the verdict of `steps`), steps, search: {status, found, steps}}; each step {key, label, state: ok | running | failed | skipped, note?}. Only what the site recorded is claimed.
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
  const age = now.getTime() - Date.parse(run.started_at);
  const notStarted = !run.read_at && (age > READ_WAIT_MS || status !== 'running');
  const steps = [
    {key: 'on', label: 'Always on is on for you', state: schedule?.state === 'on' ? 'ok' : 'failed'},
    {key: 'profile', label: 'Your profile is held on our servers', state: held ? 'ok' : 'failed'},
    {key: 'started', label: 'Our server started and read it', state: run.read_at ? 'ok' : notStarted ? 'failed' : 'running', ...(notStarted ? {note: 'Our server did not start. Press Test again in a few minutes.'} : {})},
    {key: 'ai', label: 'The AI answers', state: run.ai_at ? 'ok' : run.ai_error ? 'failed' : age > READ_WAIT_MS ? 'failed' : 'running', ...(run.ai_error ? {note: run.ai_error} : !run.ai_at && age > READ_WAIT_MS ? {note: 'The AI did not answer.'} : {})},
  ];
  const search = [
    {key: 'finished', label: 'The search finished', state: status === 'running' ? 'running' : status === 'ok' ? 'ok' : 'failed', ...(over ? {note: 'It did not report back.'} : {})},
  ];
  if (status === 'ok') {
    search.push({key: 'found', label: 'New jobs found', state: 'ok', note: `${found}`});
    search.push({key: 'mail', label: 'The e-mail was sent', state: mailed ? 'ok' : settling ? 'running' : 'skipped', ...(mailed || settling ? {} : {note: found ? 'No e-mail went out (one every 4 hours, or the address is off).' : 'Nothing new, so no e-mail.'})});
  }
  return Response.json({ok: true, run: {id: run.id, startedAt: run.started_at, status: verdict(steps), steps,
    search: {status: settling ? 'running' : status, found: status === 'ok' ? found : null, steps: search}, found: status === 'ok' ? found : null}});
}

// A digest sent to this account's address while this run was open or just after it: not a later run's.
async function digestSent(env, account, run) {
  const row = await env.STATS.prepare('SELECT email FROM pro_accounts WHERE id = ?').bind(account.id).first();
  if (!row?.email) return false;
  const until = new Date(Date.parse(run.finished_at) + 10 * 60 * 1000).toISOString();
  const sent = await env.STATS.prepare("SELECT 1 AS x FROM mail_log WHERE addr = ? AND template = 'digest' AND status = 'sent' AND at >= ? AND at <= ? LIMIT 1").bind(await addrOf(row.email), run.started_at, until).first();
  return !!sent;
}
