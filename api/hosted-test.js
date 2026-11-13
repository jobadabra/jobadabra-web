// Hosted Always on, "Test it" (owner, 4 Nov 2026: "the test button should be both for easiest (our servers) and for Advanced"): the person presses Test on our servers' card and one real
// run starts now, the same run the cron tick would start. POST /api/hosted/test starts it; GET /api/hosted/test[?run=<id>] reads it (the install key).
// Design (owner, 5 Nov 2026: "a test shuold not take more than 10 seconds"; replaces 5 Nov "One real run", whose verdict waited for the whole search):
//   the Test's verdict = five steps the site sees within seconds: Always on is on, the profile is held, our server started and read it (hosted_runs.read_at,
//   api/hosted-state.js), the AI answered one short call made with the run's own token (ai_at / ai_error, at the press), a test e-mail went to the alert address
//   (mail_at / mail_error). Running while any step still runs (each settles within READ_WAIT_MS); then any failed -> failed, all ok -> ok. Why (owner's press,
//   5 Nov 2026, run_1e97a4cc): "failed" at the first failed step was final, the app stopped reading and "Our server started and read it" stayed on Checking
//   though the server read the profile 7 s after the press.
//   The search goes on after the verdict and is reported apart (run.search: finished, jobs found, the e-mail), never as the Test's state.
// It counts like a normal run: the trial budget, the month's compute guard, the day caps and the Free AI stop all apply, plus TESTS_PER_DAY presses a day, one run at a time and COOLDOWN_MS apart.
// The schedule's own next run is never moved by a test (shared/hosted.js result()).
import {accountOf} from '../shared/pro.js';
import {freeAi} from '../shared/free-ai.js';
import {digestOf} from '../shared/guard.js';
import {hostedOn, installOf, runToken, startRun} from '../shared/hosted.js';
import {addrOf} from '../shared/mail.js';
import {testAlert} from './mail-held.js';
import {dayCaps, freeStopped, MONTH_COMPUTE_MICRO, monthSpent, openRun, runsToday, SITE, trialSpent} from './hosted-tick.js';
import {installHit} from '../shared/install-caps.js';

// READ_WAIT_MS: a container starts and reads the profile in ~10 s (production, 5 Nov 2026: 7-10 s); past this it did not start. Why (review of hr-23): well under the app's 60 s give-up
// (desktop/renderer/always-on-test-words.js), so the site's failed verdict always arrives first and no step is left on Checking. AI_WAIT_MS: the AI's one short answer.
export const COOLDOWN_MS = 10 * 60 * 1000, TESTS_PER_DAY = 5, MAIL_WAIT_MS = 30 * 1000, READ_WAIT_MS = 45 * 1000, AI_WAIT_MS = 8 * 1000;

/** One short call through the Free AI route with the run's token, as the container's engine makes them. -> {ok} or {ok: false, error}, within AI_WAIT_MS. */
export async function aiAnswers(env, token, now, wait = AI_WAIT_MS) {
  const books = [];   // the route's counting and billing, awaited after the verdict: slow KV is not a slow AI (review of hr21)
  const ask = freeAi(new Request(`${SITE}/api/ai/v1/messages`, {method: 'POST', headers: {'x-api-key': token, 'content-type': 'application/json', 'x-jp-action': 'hosted-test'},
    body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 5, messages: [{role: 'user', content: 'Answer with the word ok.'}]})}), env, now, {waitUntil: work => books.push(work)})
    .then(async reply => (reply.ok ? {ok: true} : {ok: false, error: (await reply.json().catch(() => ({})))?.error?.message || `The AI answered ${reply.status}.`}), () => ({ok: false, error: 'The AI did not answer.'}));
  let timer;
  const late = new Promise(done => { timer = setTimeout(() => done({ok: false, error: 'The AI is slow right now.'}), wait); });
  try { return await Promise.race([ask, late]); } finally { clearTimeout(timer); await Promise.allSettled(books); }
}

// The Test's alert step, at the press (owner, 5 Nov 2026: "The test should include also a notification test... telegram or email, whatever the user built"):
// a run on our servers alerts by e-mail only (shared/hosted-notify.js), so one short mail to the account's address, through the mail module's limits.
const MAIL_WHY = {no_channel: 'E-mail alerts are off. Turn them on in Settings → Notifications.', off: 'E-mail is not available right now.', rate: 'Our e-mail is busy right now. Try again in an hour.', unconfirmed_stopped: 'Confirm your address first: use "Send the confirm link again" in Settings → Notifications.',
  suppressed: 'Your address bounced or marked us as spam, so e-mail alerts are off. Check the address in Settings → Notifications.', unsubscribed: 'You stopped our e-mails. Turn alerts back on in Settings → Notifications.'};
async function checkMail(env, account, id, now) {
  if (!await claim(env, id, 'mail')) return;
  const row = await env.STATS.prepare('SELECT a.email, a.email_confirmed_at, s.email_channel FROM hosted_schedules s JOIN pro_accounts a ON a.id = s.account WHERE s.account = ?').bind(account).first();
  // Once a day (api/mail-held.js testAlert), outside the per-address cap (owner, 5 Nov 2026: "test emmail are aside of this cap").
  const sent = row?.email && row.email_channel ? await testAlert(env, row, now) : {ok: false, reason: 'no_channel'};
  await env.STATS.prepare('UPDATE hosted_runs SET mail_at = ?, mail_error = ? WHERE id = ?').bind(sent.ok ? sent.at : null, sent.ok ? null : MAIL_WHY[sent.reason] || 'The e-mail could not be sent.', id).run()
    .catch(error => console.error(`hosted mail_at not stamped for ${id}: ${error.message}`));
}

// Both checks a press makes, side by side (each once per run): the Test's AI and e-mail steps.
// Best effort (Gitar on #417): a schema or D1 error (site.yml's migration step may fail without stopping the deploy) costs the Test its steps, never the press.
/** Claims the `step` ('ai' | 'mail') check of run `id` for this press; true for exactly one press per run.
 * Why (Gitar on #417, 5 Nov 2026): two quick presses both read "not checked" before either stamped, and both sent a mail.
 * The claim is '' in `<step>_error`: report() reads it as running, and the check's own stamp replaces it. */
const claim = async (env, id, step) => (await env.STATS.prepare(`UPDATE hosted_runs SET ${step}_error = '' WHERE id = ? AND ${step}_at IS NULL AND ${step}_error IS NULL`).bind(id).run()).meta?.changes === 1;
const safely = (step, id) => step.catch(error => console.error(`hosted test check not stamped for ${id}: ${error.message}`));
const checks = (env, account, id, now) => Promise.all([safely(checkAi(env, id, now), id), safely(checkMail(env, account, id, now), id)]);

// The Test's AI step for run `id`, once: a press that joins an open run (the schedule's own, or a test already running) checks it too (review of hr21:
// a joined run returned before the check and its AI step failed at 60 s while everything worked). A failed stamp costs the Test its step, not the press.
async function checkAi(env, id, now) {
  if (!await claim(env, id, 'ai')) return;
  const ai = await aiAnswers(env, await runToken(env, id), now);
  await env.STATS.prepare('UPDATE hosted_runs SET ai_at = ?, ai_error = ? WHERE id = ?').bind(ai.ok ? new Date().toISOString() : null, ai.ok ? null : ai.error, id).run()
    .catch(error => console.error(`hosted ai_at not stamped for ${id}: ${error.message}`));
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
  if (open) { await checks(env, account.id, open.id, now); return Response.json({ok: true, run: open.id, joined: true}); }   // one run at a time: pressing again watches the one that is running
  // The gap is read from a window that reaches back past UTC midnight; only the daily count starts at midnight (Gitar on #372).
  const tests = await env.STATS.prepare("SELECT SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS n, MAX(started_at) AS last FROM hosted_runs WHERE account = ? AND slot LIKE 'test-%' AND started_at >= ?")
    .bind(`${stamp.slice(0, 10)}T00:00:00`, account.id, new Date(Math.min(now.getTime() - COOLDOWN_MS, Date.parse(`${stamp.slice(0, 10)}T00:00:00Z`))).toISOString()).first();
  if (tests.last && now.getTime() - Date.parse(tests.last) < COOLDOWN_MS) return say(429, 'A test ran a moment ago. Try again in a few minutes.', {reason: 'cooldown'});
  const full = (tests.n || 0) >= TESTS_PER_DAY;
  await installHit(env, 'hosted-tests-day', account.id, (tests.n || 0) + 1, TESTS_PER_DAY, {now, reached: full});   // 🟠 at 80%, 🔴 when refused: the hourly card (shared/install-caps.js; owner 13 Nov 2026, "Grouped hourly (Recommended)")
  if (full) return say(429, 'You have tested a few times today. Try again tomorrow.', {reason: 'daily'});
  if (await monthSpent(env, account.id, stamp) >= MONTH_COMPUTE_MICRO) return say(409, PAUSED.guard, {reason: 'guard'});
  const trial = !(account.plan === 'pro' && account.status === 'active');
  if (trial && await trialSpent(env, schedule.install)) return say(402, PAUSED['trial-over'], {reason: 'trial-over'});
  const today = await runsToday(env, stamp.slice(0, 10)), caps = dayCaps(env);
  if (!env.HOSTED_QUEUE || today.all >= caps.all || (trial && (today.trial >= caps.trial || await freeStopped(env, stamp)))) return say(503, 'Always on is busy right now. Try again later.', {reason: 'busy'});
  const run = await startRun(env, {account: account.id}, now, `test-${stamp.slice(0, 16)}`, true);
  if (!run) { const again = await openRun(env, account.id, stamp); if (again) await checks(env, account.id, again.id, now); return again ? Response.json({ok: true, run: again.id, joined: true}) : say(429, 'A test ran a moment ago. Try again in a few minutes.', {reason: 'cooldown'}); }
  try {
    await env.HOSTED_QUEUE.send({run: run.id, token: run.token, site: env.HOSTED_SITE || SITE, account: await digestOf(account.id), test: true});
  } catch (error) {   // a row nothing will ever post to would block the next press for 30 minutes
    await env.STATS.prepare("UPDATE hosted_runs SET status = 'failed', finished_at = ? WHERE id = ?").bind(stamp, run.id).run();
    return say(503, 'Always on is busy right now. Try again later.', {reason: 'busy'});
  }
  await checks(env, account.id, run.id, now);
  return Response.json({ok: true, run: run.id});
}

const verdict = steps => (steps.some(s => s.state === 'running') ? 'running' : steps.some(s => s.state === 'failed') ? 'failed' : 'ok');

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
    {key: 'mail', label: 'A test e-mail was sent to you', state: run.mail_at ? 'ok' : run.mail_error ? 'failed' : age > READ_WAIT_MS ? 'failed' : 'running',
      ...(run.mail_error ? {note: run.mail_error, settings: true} : run.mail_at ? {note: run.mail_at < run.started_at ? 'A test e-mail went to you today. Check your inbox (and spam).' : 'Check your inbox (and spam).', settings: true} : {})},
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
