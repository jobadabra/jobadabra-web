// /admin/growth/email: counts what mail_log, mail_off, mail_held and pro_accounts hold, shows the four switches, lists the page in the menu, and never prints an address (hash only). Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {PAGES} from '../../../admin/admin.js';
import {collect, hashOf, SWITCHES, windowOf} from '../../../admin/email-data.js';
import {page} from '../../../admin/email.js';
import {previews, SAMPLES} from '../../../admin/email-preview.js';
import {TEMPLATES} from '../../../shared/mail-templates.js';
import {addrOf} from '../../../shared/mail.js';
import {TEST_INBOX} from '../../../admin/email-test-send.js';
import {view} from '../../../admin/email.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0078_test_mail.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-10-26T12:00:00Z');
const log = (db, at, addr, template, status) => db.prepare('INSERT INTO mail_log (at, addr, list, template, status) VALUES (?, ?, ?, ?, ?)').run(at, addr, 'service', template, status);

async function fill() {
  const STATS = d1(), env = {STATS_SALT: 'salt', STATS, MAIL: 'on', MARKETING_MAIL: 'off'};
  const secret = await addrOf('real.person@example.com');
  log(STATS.db, '2026-10-26T10:00:00Z', secret, 'welcome', 'sent');
  log(STATS.db, '2026-10-26T11:00:00Z', secret, 'digest', 'sent');
  log(STATS.db, '2026-10-25T11:00:00Z', secret, 'digest', 'rate');
  log(STATS.db, '2026-10-24T11:00:00Z', secret, 'digest', 'failed');
  log(STATS.db, '2026-08-01T11:00:00Z', secret, 'digest', 'sent');   // outside the window
  STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'all', 'bounce', ?)").run(secret, '2026-10-20T00:00:00Z');
  STATS.db.prepare("INSERT INTO mail_held (account, at, subject, html, text) VALUES ('acc_1', '2026-10-26T09:00:00Z', 's', 'h', 't')").run();
  return {env, secret};
}

test('counts sent, refused, failed, stopped and held inside the window', async () => {
  const {env} = await fill();
  const data = await collect(env, {days: 7, now});
  assert.equal(data.sent, 2);
  assert.equal(data.notSent, 2);
  assert.equal(data.failed, 1);
  assert.equal(data.stopped, 1);
  assert.deepEqual(data.held, {items: 1, accounts: 1, oldest: '2026-10-26T09:00:00Z'});
  assert.equal(data.today, 2);
  assert.deepEqual(data.byTemplate.map(r => [r.template, r.sent, r.refused]), [['welcome', 1, 0], ['digest', 1, 2]]);
});

test('the four switches show on only when exactly "on"', async () => {
  const {env} = await fill();
  const data = await collect({...env, TRIAL_REMINDERS: 'ON'}, {now});
  assert.deepEqual(data.switches.map(s => [s.name, s.on]), [['MAIL', true], ['MARKETING_MAIL', false], ['TRIAL_REMINDERS', false], ['MAIL_LAUNCH', false]]);
  assert.equal(SWITCHES.length, 4);
});

test('the page never contains a full address hash, only the first 8 characters', async () => {
  const {env, secret} = await fill();
  const html = page(await collect(env, {days: 30, now}));
  assert.ok(!html.includes(secret));
  assert.ok(html.includes(`<code>${hashOf(secret)}</code>`));
  assert.ok(!html.includes('real.person'));
});

test('the window is 7, 30 or 90 days; anything else is 7; the page is in the Growth menu', () => {
  assert.deepEqual([7, 30, 90, 5, 'x', undefined].map(windowOf), [7, 30, 90, 7, 7, 7]);
  assert.ok(PAGES.some(p => p.path === '/admin/growth/email' && p.group === 'Growth'));   // Signups merged into it: test/unit/admin/admin-urls.test.js
});

test('every template has sample data and renders inside the frame, essential ones without an unsubscribe link', () => {
  for (const name of Object.keys(TEMPLATES)) assert.ok(SAMPLES[name], `${name} has a sample in admin/email-preview.js`);
  const all = previews();
  assert.equal(all.length, Object.keys(TEMPLATES).length);
  for (const mail of all) { assert.ok(!mail.error, `${mail.name}: ${mail.error}`); assert.ok(mail.subject && mail.html.includes('Jobadabra')); }
  assert.ok(!all.find(m => m.name === 'account-code').html.includes('unsubscribe'));
  assert.ok(all.find(m => m.name === 'digest').html.includes('unsubscribe'));
});

test('the page shows each template in a sandboxed frame', async () => {
  const {env} = await fill();
  const html = page(await collect(env, {now}));
  assert.equal((html.match(/<iframe sandbox/g) || []).length, Object.keys(TEMPLATES).length);
});

// ---- send to test inbox ----
const post = (fields, {origin = 'https://www.jobadabra.top', key = 'script-key'} = {}) => new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers: {Origin: origin, ...(key && {Authorization: `Bearer ${key}`})}, body: new URLSearchParams(fields)});
const live = async () => { const sent = [], {env} = await fill(); return {sent, env: {...env, STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', EMAIL: {send: async m => { sent.push(m); return {messageId: 'm1'}; }}}}; };

test('a test send mails only the test inbox, through the real sender, and says so on the page', async () => {
  const {env, sent} = await live();
  const response = await view(post({template: 'welcome'}), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/admin/growth/email?test=welcome:sent');
  assert.deepEqual(sent.map(m => m.to), [TEST_INBOX]);
  assert.match(sent[0].subject, /Confirm your email/);
  assert.match(page(await collect(env, {now}), null, '<p>x</p>'), /test-account-admin@jobpilotto\.top/);
});

test('a test send refuses any other address, an unknown template, a stranger and a foreign origin', async () => {
  const {env, sent} = await live();
  assert.equal((await view(post({template: 'welcome', to: 'real.person@example.com'}), env)).status, 400);
  assert.equal((await view(post({template: 'welcome', to: 'test-account-x@jobadabra.top.evil.com'}), env)).status, 400);
  assert.equal((await view(post({template: 'nope'}), env)).status, 400);
  assert.equal((await view(post({template: 'welcome'}, {key: 'wrong'}), env)).status, 404);
  assert.equal((await view(post({template: 'welcome'}, {key: ''}), env)).status, 404);
  assert.equal((await view(post({template: 'welcome'}, {origin: 'https://evil.example'}), env)).status, 404);
  assert.equal(sent.length, 0);
});

test('with the MAIL switch off, or for a list the address stopped, the result says why and nothing is sent', async () => {
  const {env, sent} = await live();
  assert.equal((await view(post({template: 'welcome'}), {...env, MAIL: 'off'})).headers.get('Location'), '/admin/growth/email?test=welcome:off');
  assert.equal((await view(post({template: 'pro-launch'}), {...env, MARKETING_MAIL: 'off'})).headers.get('Location'), '/admin/growth/email?test=pro-launch:marketing_off');
  env.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'marketing', 'unsubscribe', 'x')").run(await addrOf('test-account-admin@jobpilotto.top'));   // product news are opt-out (28 Oct 2026): stopped is what refuses
  assert.equal((await view(post({template: 'pro-launch'}), {...env, MARKETING_MAIL: 'on'})).headers.get('Location'), '/admin/growth/email?test=pro-launch:unsubscribed');
  assert.equal(sent.length, 0);
});

test('every template card has its own button, and only a known notice word is printed', async () => {
  const {env} = await fill();
  const html = page(await collect(env, {now}));
  assert.equal((html.match(/<button type="submit">Send to test inbox/g) || []).length, Object.keys(TEMPLATES).length);
});
