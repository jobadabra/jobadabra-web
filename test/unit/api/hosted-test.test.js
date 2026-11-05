// Hosted Always on, "Test it" (api/hosted-test.js; hr 4/6, 5 Nov 2026; owner: "the test button should be both for easiest (our servers) and for Advanced", "One real run"):
// POST starts one real run now and counts like any run; GET answers each step in words from what the site recorded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {digestOf, tokenFor} from '../../../shared/guard.js';
import {result, schedule, startRun} from '../../../shared/hosted.js';
import {addrOf} from '../../../shared/mail.js';
import {aiAnswers, test as hostedTest, COOLDOWN_MS} from '../../../api/hosted-test.js';
import {config} from '../../../api/hosted-state.js';
import {tick} from '../../../api/hosted-tick.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0083_mail.sql', '0130_hosted_test_checks.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const queue = () => { const sent = []; return {sent, send: async m => { sent.push(m); }}; };
const bucket = () => { const m = new Map(); return {m, head: async k => (m.has(k) ? {} : null)}; };
const aiOk = {run: async () => ({choices: [{message: {content: 'ok'}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 1}})};
const mailbox = () => { const sent = []; return {sent, send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}; };
const env = (extra = {}) => ({STATS: d1(), WAITLIST: kv(), HOSTED_QUEUE: queue(), HOSTED_STATE: bucket(), AI: aiOk, MAIL: 'on', EMAIL: mailbox(), STATS_SALT: 'salt', HOSTED_ALWAYS_ON: 'on', FREE_AI_TRIAL_USD: '2', ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const t0 = new Date('2026-11-05T10:00:00Z');
const later = (minutes, from = t0) => new Date(from.getTime() + minutes * 60000);
const rows = (e, text, ...a) => e.STATS.db.prepare(text).all(...a).map(r => ({...r}));
const turnOn = async (e, install = 'install-aaaa1', email = 'a@example.com') => schedule(new Request('https://x/s', {method: 'PUT', headers: {'x-api-key': await keyOf(install)}, body: JSON.stringify({on: true, email})}), e, t0);
const call = async (e, method, at, install = 'install-aaaa1', query = '') => hostedTest(new Request(`https://x/api/hosted/test${query}`, {method, headers: {'x-api-key': await keyOf(install)}}), e, at);
const finish = (e, body, at) => result(new Request('https://x/r', {method: 'POST', headers: {authorization: `Bearer ${e.HOSTED_QUEUE.sent.at(-1).token}`}, body: JSON.stringify(body)}), e, at);

test('off answers 404, a wrong key 401, no schedule 409 with the reason', async () => {
  assert.equal((await call(env({HOSTED_ALWAYS_ON: 'off'}), 'POST', t0)).status, 404);
  const e = env();
  assert.equal((await hostedTest(new Request('https://x/t', {method: 'POST', headers: {'x-api-key': 'JPF1.install-aaaa1.nope'}}), e, t0)).status, 401);
  const none = await call(e, 'POST', t0);
  assert.equal(none.status, 409);
  assert.equal((await none.json()).reason, 'off');
});

test('a press queues one run now with a run token, marked as a test; the schedule\'s own time does not move', async () => {
  const e = env(); await turnOn(e);
  const before = rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at;
  const answer = await (await call(e, 'POST', later(5))).json();
  assert.equal(answer.ok, true);
  assert.equal(e.HOSTED_QUEUE.sent.length, 1);
  assert.match(e.HOSTED_QUEUE.sent[0].token, /^HR1\./);
  assert.equal(e.HOSTED_QUEUE.sent[0].test, true);
  assert.match(rows(e, 'SELECT slot FROM hosted_runs')[0].slot, /^test-/);
  assert.equal(rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at, before);
});

test('pressing again while it runs watches the same run: no second message', async () => {
  const e = env(); await turnOn(e);
  const first = await (await call(e, 'POST', later(5))).json();
  const second = await (await call(e, 'POST', later(6))).json();
  assert.deepEqual([second.run, second.joined], [first.run, true]);
  assert.equal(e.HOSTED_QUEUE.sent.length, 1);
});

test('the Test answers in seconds: on, profile held, our server read it, the AI answered; the search is reported apart', async () => {
  // Why (owner, 5 Nov 2026: "a test shuold not take more than 10 seconds"): the verdict no longer waits for the search (10-18 min).
  const e = env({HOSTED_KEK: 'kek'}); await turnOn(e);
  const account = rows(e, 'SELECT account FROM hosted_schedules')[0].account;
  e.HOSTED_STATE.m.set(`hosted/${account}/config.json`, 1);
  e.HOSTED_STATE.get = async () => null;
  await call(e, 'POST', later(5));
  const waiting = (await (await call(e, 'GET', new Date(later(5).getTime() + 3000))).json()).run;
  assert.equal(waiting.status, 'running');
  assert.deepEqual(waiting.steps.map(s => [s.key, s.state]), [['on', 'ok'], ['profile', 'ok'], ['started', 'running'], ['ai', 'ok'], ['mail', 'ok']]);
  const token = e.HOSTED_QUEUE.sent.at(-1).token;
  await config(new Request('https://x/api/hosted/config', {headers: {authorization: `Bearer ${token}`}}), e, new Date(later(5).getTime() + 9000));   // the container's first read
  const ready = (await (await call(e, 'GET', new Date(later(5).getTime() + 10000))).json()).run;
  assert.equal(ready.status, 'ok', 'the verdict at ~10 s, while the search goes on');
  assert.deepEqual(ready.search.steps.map(s => [s.key, s.state]), [['finished', 'running']]);
  await finish(e, {status: 'ok', matches: [{job: 'j1', title: 'Engineer', company: 'Acme', fit: 80}]}, later(8));
  const done = (await (await call(e, 'GET', later(9))).json()).run;
  const by = Object.fromEntries(done.search.steps.map(s => [s.key, s]));
  assert.deepEqual([done.status, done.search.status], ['ok', 'ok']);
  assert.deepEqual([by.found.state, by.found.note], ['ok', '1']);
  assert.equal(by.mail.state, 'ok', 'the run sent its digest');
  assert.deepEqual(e.EMAIL.sent.map(m => m.subject), ['Always on test: your alerts reach you', '1 new job match'], 'the Test\'s own mail at the press, the digest after the search');
});

test('the Test sends one short e-mail to the alert address and says why when it cannot', async () => {
  // Why (owner, 5 Nov 2026: "The test should include also a notification test... telegram or email, whatever the user built"): our servers alert by e-mail.
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  assert.equal(e.EMAIL.sent.length, 1);
  assert.equal(e.EMAIL.sent[0].subject, 'Always on test: your alerts reach you');
  const mail = (await (await call(e, 'GET', later(6))).json()).run.steps.find(s => s.key === 'mail');
  assert.deepEqual([mail.state, mail.settings], ['ok', true]);
  await finish(e, {status: 'ok', matches: []}, later(7));
  await call(e, 'POST', later(30));   // a second press the same day: no second mail, the step still says it reached you
  assert.equal(e.EMAIL.sent.length, 1);
  const again = (await (await call(e, 'GET', later(31))).json()).run.steps.find(s => s.key === 'mail');
  assert.equal(again.state, 'ok'); assert.match(again.note, /went to you today/);
  const off = env(); await turnOn(off);
  off.STATS.db.prepare('UPDATE hosted_schedules SET email_channel = 0').run();
  await call(off, 'POST', later(5));
  const none = (await (await call(off, 'GET', new Date(later(5).getTime() + 61000))).json()).run;
  assert.equal(off.EMAIL.sent.length, 0);
  assert.equal(none.status, 'failed');
  assert.match(none.steps.find(s => s.key === 'mail').note, /E-mail alerts are off.*Settings → Notifications/);
});

test('a failed step does not end the Test while another still runs: the server\'s read still shows (the owner\'s press, run_1e97a4cc)', async () => {
  // Why (owner's press, 5 Nov 2026): the mail failed at the press, the verdict said "Failed" at once, the app stopped reading,
  // and "Our server started and read it" stayed on Checking though the server read the profile 7 s later.
  const e = env({HOSTED_KEK: 'kek'}); await turnOn(e);
  e.HOSTED_STATE.m.set(`hosted/${rows(e, 'SELECT account FROM hosted_schedules')[0].account}/config.json`, 1);
  e.HOSTED_STATE.get = async () => null;
  e.STATS.db.prepare('UPDATE hosted_schedules SET email_channel = 0').run();
  await call(e, 'POST', later(5));
  const early = (await (await call(e, 'GET', new Date(later(5).getTime() + 3000))).json()).run;
  assert.deepEqual([early.status, early.steps.find(s => s.key === 'mail').state, early.steps.find(s => s.key === 'started').state], ['running', 'failed', 'running']);
  await config(new Request('https://x/api/hosted/config', {headers: {authorization: `Bearer ${e.HOSTED_QUEUE.sent.at(-1).token}`}}), e, new Date(later(5).getTime() + 7000));
  const settled = (await (await call(e, 'GET', new Date(later(5).getTime() + 8000))).json()).run;
  assert.deepEqual([settled.status, settled.steps.find(s => s.key === 'started').state], ['failed', 'ok']);
});

test('a full address still gets the Test e-mail: test mails are outside the per-address cap', async () => {
  // Why (owner, 5 Nov 2026: "Still, test emmail are aside of this cap"): the owner's Test failed with "Too many e-mails today".
  const e = env(); await turnOn(e);
  const addr = await addrOf('a@example.com');
  for (let i = 0; i < 12; i++) e.STATS.db.prepare("INSERT INTO mail_log (at, addr, list, template, status) VALUES (?, ?, 'service', 'digest', 'sent')").run(later(-60).toISOString(), addr);
  await call(e, 'POST', later(5));
  assert.equal(e.EMAIL.sent.length, 1);
  assert.equal((await (await call(e, 'GET', later(6))).json()).run.steps.find(s => s.key === 'mail').state, 'ok');
});

test('a double press checks once: one test e-mail and one AI call, not one per press', async () => {
  // Why (Gitar on #417, 5 Nov 2026): the second press read "not checked" while the first was still sending, and sent again.
  let release, entered;
  const inSend = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const box = mailbox(), send = box.send;
  box.send = async m => { entered(); await held; return send(m); };
  let asked = 0;
  const e = env({EMAIL: box, AI: {run: async () => { asked++; return aiOk.run(); }}}); await turnOn(e);
  const first = call(e, 'POST', later(5));
  await inSend;
  const second = call(e, 'POST', later(5));
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  assert.deepEqual([(await first).status, (await second).status], [200, 200]);
  assert.equal(box.sent.length, 1, 'one test e-mail');
  assert.equal(asked, 1, 'one AI call');
  assert.equal((await (await call(e, 'GET', later(6))).json()).run.steps.find(s => s.key === 'mail').state, 'ok');
});

test('a site whose migration 0130 did not apply still starts the Test: the press never fails on the checks', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(); await turnOn(e);
  for (const column of ['ai_at', 'ai_error', 'mail_at', 'mail_error', 'read_at']) e.STATS.db.exec(`ALTER TABLE hosted_runs DROP COLUMN ${column}`);
  const press = await call(e, 'POST', later(5));
  assert.equal(press.status, 200);
  assert.equal(e.HOSTED_QUEUE.sent.length, 1);
});

test('a server that never reads the profile fails the Test after a minute, said plainly', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  const run = (await (await call(e, 'GET', new Date(later(5).getTime() + 61000))).json()).run;
  assert.equal(run.status, 'failed');
  assert.match(run.steps.find(s => s.key === 'started').note, /did not start/);
});

test('an AI that fails or hangs fails its step with what it said, within the wait', async () => {
  const e = env({AI: {run: async () => { throw new Error('upstream down'); }}}); await turnOn(e);
  await call(e, 'POST', later(5));
  const run = (await (await call(e, 'GET', new Date(later(5).getTime() + 5000))).json()).run;
  assert.equal(run.steps.find(s => s.key === 'ai').state, 'failed');
  assert.match(run.steps.find(s => s.key === 'ai').note, /Free AI could not answer/);
  assert.equal((await (await call(e, 'GET', new Date(later(5).getTime() + 61000))).json()).run.status, 'failed', 'the verdict once every step settled');
  e.AI = {run: () => new Promise(() => {})};   // hangs, as two production calls did for ~170 s
  const began = Date.now();
  assert.deepEqual(await aiAnswers(e, e.HOSTED_QUEUE.sent.at(-1).token, later(5), 50), {ok: false, error: 'The AI is slow right now.'});
  assert.ok(Date.now() - began < 2000);
});

test('a profile that was never pushed and a failed run are said plainly', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  await finish(e, {status: 'failed'}, later(7));
  const run = (await (await call(e, 'GET', later(8))).json()).run;
  assert.equal(run.steps.find(s => s.key === 'profile').state, 'failed');
  assert.equal(run.search.steps.find(s => s.key === 'finished').state, 'failed');
  assert.ok(!run.search.steps.some(s => s.key === 'found'), 'no found-jobs claim for a failed run');
});

test('a run that never reports back is failed once its token has expired', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  const run = (await (await call(e, 'GET', later(60))).json()).run;
  assert.equal(run.search.status, 'failed');
  assert.match(run.search.steps.find(s => s.key === 'finished').note, /did not report back/);
});

test('a second test within ten minutes of the last is refused; after that it starts', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  await finish(e, {status: 'ok', matches: []}, later(7));
  const soon = await call(e, 'POST', later(8));
  assert.equal(soon.status, 429);
  assert.equal(e.HOSTED_QUEUE.sent.length, 1);
  const after = await call(e, 'POST', new Date(later(5).getTime() + COOLDOWN_MS + 60000));
  assert.equal(after.status, 200);
  assert.equal(e.HOSTED_QUEUE.sent.length, 2);
});

test('the same guards as the tick: a spent trial, a pause, the Free AI stop and the day cap refuse the press', async () => {
  const spent = env(); await turnOn(spent);
  spent.WAITLIST.m.set(`freeai:life:${await digestOf('install-aaaa1')}`, String(2_000_000));
  const a = await call(spent, 'POST', later(5));
  assert.deepEqual([a.status, (await a.json()).reason], [402, 'trial-over']);
  const paused = env(); await turnOn(paused);
  paused.STATS.db.prepare("UPDATE hosted_schedules SET state = 'paused', pause_reason = 'inactive'").run();
  assert.equal((await call(paused, 'POST', later(5))).status, 409);
  const stopped = env(); await turnOn(stopped);
  stopped.WAITLIST.m.set('freeai:usd:2026-11-05', String(10_000_000));
  assert.equal((await call(stopped, 'POST', later(5))).status, 503);
  const full = env({HOSTED_MAX_RUNS_DAY: '1'}); await turnOn(full);
  assert.equal((await call(full, 'POST', later(5))).status, 200);
  await finish(full, {status: 'ok', matches: []}, later(6));
  assert.equal((await call(full, 'POST', later(30))).status, 503);
  assert.equal(full.HOSTED_QUEUE.sent.length, 1);
});

test('a test run counts in the tick\'s day total, and the tick still starts a due schedule once', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  await finish(e, {status: 'ok', matches: []}, later(6));
  const out = await tick(e, new Date(t0.getTime() + 25 * 3600000));
  assert.equal(out.enqueued, 1);
});

// ---- review of hr 4/6 (fresh subagent, 5 Nov 2026): each finding is a test ----
const DAY_MS = 86400000;

test('the month\'s compute guard stops a test as it stops the tick', async () => {
  const e = env(); await turnOn(e);
  const account = rows(e, 'SELECT account FROM hosted_schedules')[0].account;
  e.STATS.db.prepare("INSERT INTO hosted_runs (id, account, slot, started_at, expires_at, finished_at, status, compute_micro) VALUES ('old', ?, '2026-11-01T01', '2026-11-01T01:00:00.000Z', '2026-11-01T01:30:00.000Z', '2026-11-01T01:10:00.000Z', 'ok', 1500000)").run(account);
  const answer = await call(e, 'POST', later(5));
  assert.deepEqual([answer.status, (await answer.json()).reason], [409, 'guard']);
  assert.equal(e.HOSTED_QUEUE.sent.length, 0);
});

test('five tests a day at most, then "tomorrow"; the next day it starts again', async () => {
  const e = env({HOSTED_MAX_RUNS_DAY: '100'}); await turnOn(e);
  for (let n = 0; n < 5; n++) {
    const at = later(5 + n * 11);
    assert.equal((await call(e, 'POST', at)).status, 200, `test ${n + 1}`);
    await finish(e, {status: 'ok', matches: []}, later(6 + n * 11));
  }
  const sixth = await call(e, 'POST', later(5 + 5 * 11));
  assert.deepEqual([sixth.status, (await sixth.json()).reason], [429, 'daily']);
  assert.equal((await call(e, 'POST', new Date(t0.getTime() + DAY_MS + 3600000))).status, 200);
});

test('two starts in different minutes cannot both be open: the insert itself says no', async () => {
  const e = env(); await turnOn(e);
  const account = rows(e, 'SELECT account FROM hosted_schedules')[0].account;
  assert.ok(await startRun(e, {account}, t0, 'test-2026-11-05T10:59', true));
  assert.equal(await startRun(e, {account}, later(1), 'test-2026-11-05T11:00', true), null);
});

test('a tick beside an open test starts no second run and leaves the schedule where it was', async () => {
  const e = env(); await turnOn(e);
  await call(e, 'POST', later(5));
  e.STATS.db.prepare("UPDATE hosted_schedules SET next_run_at = ?").run(later(10).toISOString());   // due while the test (open 30 minutes) is still running
  const due = rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at;
  const out = await tick(e, later(15));
  assert.equal(out.enqueued, 0);
  assert.equal(e.HOSTED_QUEUE.sent.length, 1);
  assert.equal(rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at, due, 'not moved: the next tick asks again');
  await finish(e, {status: 'ok', matches: []}, later(20));
  assert.equal((await tick(e, later(25))).enqueued, 1, 'once the test is over the scheduled run starts');
});

test('a press during the scheduled run joins it and still checks the AI: the verdict is ok, not "the AI did not answer"', async () => {
  // Why (review of hr21, 5 Nov 2026): a joined run returned before the AI check, so its AI step failed at 60 s while everything worked.
  const e = env({HOSTED_KEK: 'kek'}); await turnOn(e);
  const account = rows(e, 'SELECT account FROM hosted_schedules')[0].account;
  e.HOSTED_STATE.m.set(`hosted/${account}/config.json`, 1);
  e.HOSTED_STATE.get = async () => null;
  e.STATS.db.prepare('UPDATE hosted_schedules SET next_run_at = ?').run(later(1).toISOString());
  assert.equal((await tick(e, later(2))).enqueued, 1);
  await config(new Request('https://x/api/hosted/config', {headers: {authorization: `Bearer ${e.HOSTED_QUEUE.sent.at(-1).token}`}}), e, later(2));
  const joined = await (await call(e, 'POST', later(4))).json();
  assert.equal(joined.joined, true);
  const run = (await (await call(e, 'GET', later(5), 'install-aaaa1', `?run=${joined.run}`)).json()).run;
  assert.equal(run.steps.find(s => s.key === 'ai').state, 'ok');
  assert.equal(run.status, 'ok');
});

test('a queue that refuses the message closes the run, so the next press is not stuck behind it', async () => {
  const e = env(); await turnOn(e);
  const send = e.HOSTED_QUEUE.send;
  e.HOSTED_QUEUE.send = async () => { throw new Error('queue down'); };
  assert.equal((await call(e, 'POST', later(5))).status, 503);
  assert.equal(rows(e, 'SELECT status FROM hosted_runs')[0].status, 'failed');
  e.HOSTED_QUEUE.send = send;
  assert.equal((await call(e, 'POST', new Date(later(5).getTime() + COOLDOWN_MS + 60000))).status, 200);
});

test('a finished test leaves the schedule\'s own next run where it was', async () => {
  const e = env(); await turnOn(e);
  const before = rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at;
  await call(e, 'POST', later(5));
  await finish(e, {status: 'ok', matches: []}, later(7));
  assert.equal(rows(e, 'SELECT next_run_at FROM hosted_schedules')[0].next_run_at, before);
});

test('the steps are honest at the edges: jobs counted from the inbox, the mail not claimed until it had time, never another run\'s digest', async () => {
  const e = env({MAIL: 'off'}); await turnOn(e);   // no digest goes out by itself here: the test writes the mail log
  const account = rows(e, 'SELECT account FROM hosted_schedules')[0].account;
  await call(e, 'POST', later(5));
  await finish(e, {status: 'ok', matches: [{job: 'j1', title: 'A', company: 'X', fit: 70}]}, later(7));
  const soon = (await (await call(e, 'GET', new Date(later(7).getTime() + 5000))).json()).run;
  assert.equal(soon.search.status, 'running', 'the digest is sent last: a read right after the post is not final');
  assert.equal(soon.search.steps.find(s => s.key === 'mail').state, 'running');
  e.STATS.db.prepare("INSERT INTO mail_log (addr, list, template, status, at) VALUES (?, 'service', 'digest', 'sent', ?)").run(await addrOf('a@example.com'), later(300).toISOString());   // a later day's digest
  const later1 = (await (await call(e, 'GET', later(60))).json()).run;
  assert.equal(later1.search.steps.find(s => s.key === 'mail').state, 'skipped', 'a later run\'s digest does not make this run look mailed');
  assert.equal(later1.found, 1);
  assert.ok(account);
});

test('the ten-minute gap holds across UTC midnight', async () => {
  const e = env(); await turnOn(e);
  const late = new Date('2026-11-05T23:58:00Z');
  assert.equal((await call(e, 'POST', late)).status, 200);
  await finish(e, {status: 'ok', matches: []}, new Date('2026-11-05T23:59:00Z'));
  assert.equal((await call(e, 'POST', new Date('2026-11-06T00:01:00Z'))).status, 429, 'three minutes after the last test, on the next UTC day');
  assert.equal((await call(e, 'POST', new Date('2026-11-06T00:10:00Z'))).status, 200);
});
