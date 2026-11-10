// Trial and lifecycle mail (admin/mail-lifecycle.js) and the signups page (admin/signups.js): the reminders go out once, only to the right accounts, service mail carries no promotion, the Pro-launch mail
// goes only to opted-in addresses and only behind its flag, and the page shows counts, never an address. Fake sender and fake D1/KV.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {launch, run} from '../../../admin/mail-lifecycle.js';
import {collect, launchRoute, page} from '../../../admin/signups.js';
import {digestOf} from '../../../shared/guard.js';
import {createAccount, link} from '../../../shared/pro.js';
import {PAGES} from '../../../admin/admin.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0083_hosted.sql', '0135_mail_on.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); },
  list: async ({prefix}) => ({keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({name, metadata: undefined})), list_complete: true})}; };
const now = new Date('2026-10-16T10:00:00Z');
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', TRIAL_REMINDERS: 'on', STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
// A trial account with one install, that applied `applied` times and started its first run `days` days ago.
async function trial(e, email, {applied = 0, days = 5, install = `inst-${email}`, ownAi = false} = {}) {
  const id = await createAccount(e, email, now, {plan: 'trial'});
  await link(e, id, install, now);
  const who = await digestOf(install);
  await e.WAITLIST.put(`trial:applied:${who}`, String(applied));
  await e.WAITLIST.put(`trial:first:${who}`, new Date(now.getTime() - days * 86400000).toISOString());
  if (ownAi) await e.WAITLIST.put(`trial:ownai:${who}`, '1');   // the app's flag (shared/trial.js)
  return id;
}

test('"N applications left" goes once to an account with 5 or fewer left; nobody else gets it', async () => {
  const {e, sent} = setup();
  await trial(e, 'low@example.com', {applied: 16});
  await trial(e, 'plenty@example.com', {applied: 3});
  await trial(e, 'done@example.com', {applied: 20});
  assert.deepEqual(await run(e, now), {left: 1, ending: 0, paused: 0});
  assert.deepEqual(sent.map(m => [m.to, m.subject]), [['low@example.com', '4 free applications left']]);
  assert.deepEqual(await run(e, new Date(now.getTime() + 86400000)), {left: 0, ending: 0, paused: 0}, 'once only');
});

test('a trial on its own AI has 30: "N applications left" counts down from 30 and its mail names 30, in the person\'s numbers', async () => {
  const {e, sent} = setup();
  await trial(e, 'own@example.com', {applied: 22, ownAi: true});   // 8 left of 30: no mail yet
  await trial(e, 'own-low@example.com', {applied: 27, ownAi: true});   // 3 left of 30
  assert.deepEqual(await run(e, now), {left: 1, ending: 0, paused: 0});
  assert.deepEqual(sent.map(m => [m.to, m.subject]), [['own-low@example.com', '3 free applications left']]);
  assert.match(sent[0].text, /\(30 applications or 60 days/);
});

test('"trial ends in 3 days" needs the 20 applications done and 1-3 days left of the 60; an ongoing trial gets nothing', async () => {
  const {e, sent} = setup();
  await trial(e, 'ending@example.com', {applied: 20, days: 58});
  await trial(e, 'early@example.com', {applied: 20, days: 30});
  await trial(e, 'few@example.com', {applied: 2, days: 58});
  const done = await run(e, now);
  assert.equal(done.ending, 1);
  const ending = sent.find(m => m.to === 'ending@example.com');
  assert.equal(ending.subject, 'Your free trial ends in 2 days');
  assert.ok(!/Get Pro|offer|\$\d/.test(ending.text), 'a service reminder carries no promotion');
});

test('a Pro account, an unsubscribed account and an account with the mail off get no trial mail', async () => {
  const {e, sent} = setup();
  const pro = await trial(e, 'pro@example.com', {applied: 18});
  e.STATS.db.prepare("UPDATE pro_accounts SET plan = 'pro' WHERE id = ?").run(pro);
  const off = await trial(e, 'off@example.com', {applied: 18});
  e.STATS.db.prepare('UPDATE pro_accounts SET service_mail_off_at = ? WHERE id = ?').run('2026-10-01', off);
  assert.deepEqual(await run(e, now), {left: 0, ending: 0, paused: 0});
  assert.equal(sent.length, 0);
});

test('"Always on paused" goes to a trial account whose hosted schedule paused, functional wording, the Pro line only with the marketing flag, once a month', async () => {
  const {e, sent} = setup({MARKETING_MAIL: 'on'});
  const over = await trial(e, 'over@example.com'), idle = await trial(e, 'idle@example.com'), running = await trial(e, 'running@example.com');
  const put = e.STATS.db.prepare("INSERT INTO hosted_schedules (account, install, state, pause_reason, next_run_at, last_seen_at, created_at) VALUES (?, 'i', ?, ?, 'x', 'x', 'x')");
  put.run(over, 'paused', 'trial-over'); put.run(idle, 'paused', 'inactive'); put.run(running, 'on', null);
  assert.equal((await run(e, now)).paused, 2);
  assert.match(sent.find(m => m.to === 'over@example.com').text, /Get Pro to keep it running: https:\/\/www\.jobadabra\.top\/pricing/);
  assert.ok(!/Pro/.test(sent.find(m => m.to === 'idle@example.com').text), 'an inactivity pause is not an upsell');
  assert.equal((await run(e, new Date(now.getTime() + 5 * 86400000))).paused, 0);
  assert.equal((await run(e, new Date(now.getTime() + 31 * 86400000))).paused, 2);
});

test('the Pro-launch mail: off without its flag; counts without send=1; goes to a confirmed Tips and tricks tick and to the waitlist, once', async () => {
  // Why (owner, 5 Nov 2026): the Pro launch is a Tips and tricks mail that every waitlist signup also asked for (shared/mail-lists.js).
  const {e, sent} = setup();
  const a = await trial(e, 'yes@example.com'); await trial(e, 'no@example.com'); await trial(e, 'unconfirmed@example.com');
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x' WHERE id = ?").run(a);
  e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES ((SELECT email_hash FROM pro_accounts WHERE id = ?), 'tips', 'card', 'x')").run(a);
  e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES ((SELECT email_hash FROM pro_accounts WHERE email = 'unconfirmed@example.com'), 'tips', 'card', 'x')").run();
  assert.deepEqual(await launch(e), {off: true});
  assert.deepEqual(await launch({...e, MAIL_LAUNCH: 'on'}), {off: true}, 'the marketing flag is the owner\'s second key');
  const on = {...e, MAIL_LAUNCH: 'on', MARKETING_MAIL: 'on'};
  assert.deepEqual(await launch(on, {now}), {would: 1});
  assert.equal(sent.length, 0);
  assert.deepEqual(await launch(on, {send: true, now}), {sent: 1, skipped: 0});
  assert.equal(sent[0].to, 'yes@example.com', 'an unconfirmed tick may be a stranger\'s: nothing goes to it');
  assert.match(sent[0].text, /Pro €9, or Pro \+ AI €19 with €10 of AI credit \(about \d+ applications\)/);
  assert.match(sent[0].text, /Actual usage varies\./);
  assert.match(sent[0].text, /Pro uses smarter in-house AI while you have credit/);
  assert.match(sent[0].text, /VAT included/);
  assert.match(sent[0].from, /no-reply@jobadabra\.top/);
  assert.deepEqual(await launch(on, {send: true, now}), {sent: 0, skipped: 0}, 'once only');
});

test('the launch route is owner-only (Bearer) and POST only', async () => {
  const {e} = setup({MAIL_LAUNCH: 'on'});
  assert.equal((await launchRoute(new Request('https://x/admin/mail/launch', {method: 'POST'}), e)).status, 404);
  assert.equal((await launchRoute(new Request('https://x/admin/mail/launch'), e)).status, 404);
});

test('the signups page counts trial accounts and mail, never shows an address, and is in the admin menu', async () => {
  const {e} = setup();
  const a = await trial(e, 'secret-person@example.com', {applied: 17});
  await trial(e, 'other@example.com');
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = '2026-10-15' WHERE id = ?").run(a);
  e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES ((SELECT email_hash FROM pro_accounts WHERE id = ?), 'tips', 'card', 'x')").run(a);
  await run(e, now);
  const data = await collect(e, now);
  assert.deepEqual([data.trial, data.confirmed, data.unconfirmed, data.optIn, data.converted], [2, 1, 1, 1, 0]);
  const html = page(data);
  assert.ok(html.includes('Trial accounts') && html.includes('trial-left'));
  assert.ok(!html.includes('example.com'));
  assert.ok(PAGES.some(item => item.path === '/admin/growth/email'));
});

test('with the owner\'s flags off (the default) the trial reminders do not go out and the pause notice has no sales line', async () => {
  const {e, sent} = setup({TRIAL_REMINDERS: 'off'});
  await trial(e, 'low@example.com', {applied: 16});
  await trial(e, 'ending@example.com', {applied: 20, days: 58});
  const over = await trial(e, 'over@example.com');
  e.STATS.db.prepare("INSERT INTO hosted_schedules (account, install, state, pause_reason, next_run_at, last_seen_at, created_at) VALUES (?, 'i', 'paused', 'trial-over', 'x', 'x', 'x')").run(over);
  assert.deepEqual(await run(e, now), {left: 0, ending: 0, paused: 1});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Always on paused: your free trial has ended');
  assert.ok(!/Pro|pricing|\$/.test(sent[0].text), 'no Pro push while the flag is off');
});
