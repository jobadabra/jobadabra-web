// Ready to send, the morning mail (api/ready-mail.js; owner, 8 Nov 2026): a night that ends with forms to check mails its person ONCE, counts only; their switch (`app-ready`) holds it; nothing ready = no mail.
// Fictional address and a fake sender: nothing here can reach a real inbox. Rules covered: who gets it, when, switch off = no mail, once a night, and the real end of a night (the cron tick).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address} from '../../../../api/account-email.js';
import {mailNight} from '../../../../api/ready-mail.js';
import {tick} from '../../../../api/ready-tick.js';
import {setChoice} from '../../../../shared/mail-choices.js';
import {resetRuleCache} from '../../../../shared/mail-registry.js';
import {tokenFor} from '../../../../shared/guard.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
const FILES = ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0083_hosted.sql', '0085_mail_held.sql', '0089_ready.sql', '0090_ready_fill_at.sql',
  '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql', '0135_mail_on.sql', '0138_mail_rule.sql', '0139_mail_held_row.sql', '0142_ready_mailed.sql', '0143_ready_task.sql'];
function d1() {
  resetRuleCache();
  const db = new DatabaseSync(':memory:');
  for (const file of FILES) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text), batch: async list => { for (const one of list) await one.run(); }};
}
const now = new Date('2026-11-08T06:00:00Z');
const INSTALL = 'install-ready-1';
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
async function setup({address: given = 'me@example.com', confirmed = true} = {}) {
  const sent = [], store = new Map();
  const e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', READY_TO_SEND: 'on', READY_OWNER: INSTALL, HOSTED_STATE: {delete: async () => {}}, WAITLIST: {get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }},
    EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}};
  if (given) {
    const put = await address(new Request('https://x/api', {method: 'PUT', headers: {'x-api-key': await keyOf(INSTALL)}, body: JSON.stringify({email: given})}), e, now);
    assert.equal((await put.json()).ok, true);
    if (confirmed) e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = '2026-11-01T00:00:00Z'").run();
    sent.length = 0;   // the confirm mail of the setup
  }
  return {e, sent};
}
// A finished night with jobs in the given states (counts are all the site keeps of them).
function night(e, states, {state = 'finished', id = 'night-1', date = '2026-11-08'} = {}) {
  e.STATS.db.prepare("INSERT INTO ready_batches (id, install, night, created_at, state, expires_at) VALUES (?, ?, ?, '2026-11-07T20:00:00Z', ?, '2026-11-08T03:00:00Z')").run(id, INSTALL, date, state);
  states.forEach((each, index) => e.STATS.db.prepare("INSERT INTO ready_jobs (batch, job, host, state) VALUES (?, ?, 'jobs.example.com', ?)").run(id, `j${index}`, each));
  return {id, install: INSTALL};
}
const mailed = (e, id = 'night-1') => e.STATS.db.prepare('SELECT mailed_at FROM ready_batches WHERE id = ?').get(id).mailed_at;

test('a night with forms to check mails its person once: how many are ready and how many need an answer, no job names', async () => {
  const {e, sent} = await setup();
  const batch = night(e, ['prepared', 'prepared', 'partial', 'wall']);
  assert.deepEqual(await mailNight(e, batch, now), {sent: true});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.equal(sent[0].subject, '3 applications are ready to check');
  assert.match(sent[0].text, /Of these, 1 needs an answer from you\./);
  assert.match(sent[0].text, /Nothing was sent/);
  assert.doesNotMatch(sent[0].html + sent[0].text, /jobs\.example\.com/, 'the host of a posting is never in the mail');
  assert.deepEqual(await mailNight(e, batch, now), {skipped: 'already'}, 'a night reported twice mails once');
  assert.equal(sent.length, 1);
});

test('every form complete: one application reads in the singular and says nothing of an answer', async () => {
  const {e, sent} = await setup();
  assert.deepEqual(await mailNight(e, night(e, ['prepared']), now), {sent: true});
  assert.equal(sent[0].subject, '1 application is ready to check');
  assert.doesNotMatch(sent[0].text, /needs an answer/);
});

test('the person turned the row off: no mail, and the night is not mailed later either', async () => {
  const {e, sent} = await setup();
  const addr = e.STATS.db.prepare('SELECT email_hash AS h FROM pro_accounts').get().h;
  assert.equal(await setChoice(e, addr, 'app-ready', false, 'app', now), true);
  assert.deepEqual(await mailNight(e, night(e, ['prepared']), now), {skipped: 'person_off'});
  assert.equal(sent.length, 0);
  assert.notEqual(mailed(e), null, 'the person\'s no keeps the night claimed: no mail later either');
});

test('nothing to check (walls, failures, cleared forms): no mail and the night stays unclaimed', async () => {
  const {e, sent} = await setup();
  const batch = night(e, ['wall', 'failed', 'no-form']);
  e.STATS.db.prepare("INSERT INTO ready_jobs (batch, job, host, state, cleared_at) VALUES ('night-1', 'gone', 'x.example.com', 'prepared', '2026-11-08T05:00:00Z')").run();
  assert.deepEqual(await mailNight(e, batch, now), {skipped: 'nothing'});
  assert.equal(sent.length, 0);
  assert.equal(mailed(e), null);
});

test('no address on the account: nothing is sent and nothing throws', async () => {
  const {e, sent} = await setup({address: ''});
  assert.deepEqual(await mailNight(e, night(e, ['prepared']), now), {skipped: 'no_address'});
  assert.equal(sent.length, 0);
});

test('a database that fails never fails the night: the answer says so', async () => {
  const broken = {prepare: () => { throw new Error('no such column: mailed_at'); }};
  assert.deepEqual(await mailNight({STATS: broken}, {id: 'x', install: INSTALL}, now), {skipped: 'failed'});
});

test('the cron tick that ends an over-time night sends its morning mail once, even when it ticks again', async () => {
  const {e, sent} = await setup();
  night(e, ['prepared', 'partial'], {state: 'running'});
  const after = new Date('2026-11-08T03:30:00Z');
  assert.equal((await tick(e, after)).finished, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '2 applications are ready to check');
  assert.equal((await tick(e, new Date('2026-11-08T03:35:00Z'))).finished, 0);
  assert.equal(sent.length, 1);
});

test('a capped night is mailed when its time is up, with the forms that finished after the cap counted', async () => {
  const {e, sent} = await setup();
  night(e, ['queued', 'queued'], {state: 'capped'});
  // the AI call that crossed the cap: nothing was ready then, so nothing is mailed or claimed yet
  assert.deepEqual(await mailNight(e, {id: 'night-1', install: INSTALL}, now), {skipped: 'nothing'});
  e.STATS.db.prepare("UPDATE ready_jobs SET state = 'prepared' WHERE job = 'j0'").run();   // a form still filling reports after the cap
  e.STATS.db.prepare("UPDATE ready_jobs SET state = 'partial' WHERE job = 'j1'").run();
  assert.equal((await tick(e, new Date('2026-11-08T03:30:00Z'))).finished, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '2 applications are ready to check');
});

test('an address not confirmed yet that already got today\'s one mail: the morning mail waits for the digest, never dropped', async () => {
  const {e, sent} = await setup({confirmed: false});
  e.STATS.db.prepare("INSERT INTO mail_log (at, addr, list, template, status) VALUES ('2026-11-08T05:00:00.000Z', (SELECT email_hash FROM pro_accounts), 'service', 'message', 'sent')").run();
  assert.deepEqual(await mailNight(e, night(e, ['prepared']), now), {skipped: 'held'});
  assert.equal(sent.length, 0);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_held WHERE mail_row = ?').get('app-ready').n, 1);
});

test('a send that fails is held for the digest, not lost and not retried: the night stays claimed', async () => {
  const {e, sent} = await setup();
  e.EMAIL.send = async () => { throw new Error('provider down'); };
  const batch = night(e, ['prepared']);
  assert.deepEqual(await mailNight(e, batch, now), {skipped: 'held'});
  assert.notEqual(mailed(e), null);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_held WHERE mail_row = ?').get('app-ready').n, 1);
  assert.deepEqual(await mailNight(e, batch, now), {skipped: 'already'});
  assert.equal(sent.length, 0);
});

test('a send that throws after the claim is held for the digest, a throw before the claim holds nothing and claims nothing', async () => {
  const {e, sent} = await setup();
  const batch = night(e, ['prepared']);
  const real = e.EMAIL.send;
  e.EMAIL.send = async () => { throw new Error('provider down'); };
  const asked = e.STATS.prepare;
  e.STATS.prepare = text => { if (/FROM mail_log WHERE addr = \? AND template NOT LIKE/.test(text) || /INSERT INTO mail_log/.test(text)) throw new Error('D1 hiccup'); return asked(text); };   // deliver()'s own claim throws
  assert.deepEqual(await mailNight(e, batch, now), {skipped: 'failed'});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_held WHERE mail_row = ?').get('app-ready').n, 1, 'held although deliver threw');
  e.STATS.prepare = asked; e.EMAIL.send = real;
  const early = night(e, ['prepared'], {id: 'night-2', date: '2026-11-09'});
  e.STATS.prepare = text => { if (/FROM pro_accounts/.test(text)) throw new Error('D1 hiccup'); return asked(text); };
  assert.deepEqual(await mailNight(e, early, now), {skipped: 'failed'});
  e.STATS.prepare = asked;
  assert.equal(mailed(e, 'night-2'), null, 'a night whose mail was never built is not claimed');
  assert.equal(sent.length, 0);
});
