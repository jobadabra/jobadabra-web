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
import {DAILY_MAX, addrOf} from '../../../shared/mail.js';
import {MAIL_TYPES} from '../../../shared/mail-lists.js';
import {TEST_INBOX} from '../../../admin/email-test-send.js';
import {view} from '../../../admin/email.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0078_test_mail.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql']) db.exec(sql(file));
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

test('a mail in flight (a claimed row) is neither sent nor refused on the page', async () => {
  const {env, secret} = await fill();
  log(env.STATS.db, '2026-10-26T12:00:00Z', secret, 'digest', 'claimed');   // a send between its claim and the provider's answer, or one a dead Worker left
  const data = await collect(env, {days: 7, now});
  assert.deepEqual([data.sent, data.notSent, data.today], [2, 2, 2]);
  assert.deepEqual(data.byTemplate.map(r => [r.template, r.sent, r.refused]), [['welcome', 1, 0], ['digest', 1, 2]]);
  assert.equal(JSON.stringify(data).includes('claimed'), false, 'no claimed reason or recent-refusal row anywhere in the numbers');
});

test('the four switches show on only when exactly "on"', async () => {
  const {env} = await fill();
  const data = await collect({...env, TRIAL_REMINDERS: 'ON'}, {now});
  assert.deepEqual(data.switches.map(s => [s.name, s.on]), [['MAIL', true], ['MARKETING_MAIL', false], ['TRIAL_REMINDERS', false], ['MAIL_LAUNCH', false]]);
  assert.equal(SWITCHES.length, 4);
});

test('the page never contains a full address hash, only the first 8 characters', async () => {
  const {env, secret} = await fill();
  const data = await collect(env, {days: 30, now}), html = ['overview', 'settings', 'people', 'releases', 'templates'].map(tab => page(data, null, null, null, [], undefined, tab)).join('\n');   // every tab
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
  const html = page(await collect(env, {now}), null, null, null, [], undefined, 'templates');
  assert.equal((html.match(/<iframe sandbox/g) || []).length, Object.keys(TEMPLATES).length);
});

// ---- send to test inbox ----
const post = (fields, {origin = 'https://www.jobadabra.top', key = 'script-key'} = {}) => new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers: {Origin: origin, ...(key && {Authorization: `Bearer ${key}`})}, body: new URLSearchParams(fields)});
const live = async () => { const sent = [], {env} = await fill(); return {sent, env: {...env, STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', WAITLIST: {list: async () => ({keys: [], list_complete: true})}, EMAIL: {send: async m => { sent.push(m); return {messageId: 'm1'}; }}}}; };

test('a test send mails only the test inbox, through the real sender, and says so on the page', async () => {
  const {env, sent} = await live();
  const response = await view(post({template: 'welcome'}), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/admin/growth/email?test=welcome:sent&destination=inbox#test-result-welcome');
  assert.deepEqual(sent.map(m => m.to), [TEST_INBOX]);
  assert.match(sent[0].subject, /Confirm your email/);
  assert.match(page(await collect(env, {now}), null, '<p>x</p>', null, [], undefined, 'templates'), /test-account-admin@jobpilotto\.top/);
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
  assert.equal((await view(post({template: 'welcome'}), {...env, MAIL: 'off'})).headers.get('Location'), '/admin/growth/email?test=welcome:off&destination=inbox#test-result-welcome');
  assert.equal((await view(post({template: 'pro-launch'}), {...env, MARKETING_MAIL: 'off'})).headers.get('Location'), '/admin/growth/email?test=pro-launch:marketing_off&destination=inbox#test-result-pro-launch');
  env.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'tips', 'unsubscribe', 'x')").run(await addrOf('test-account-admin@jobpilotto.top'));   // the Pro launch is a Tips and tricks mail: a stop on that type refuses it, a test send skips only the tick rules
  assert.equal((await view(post({template: 'pro-launch'}), {...env, MARKETING_MAIL: 'on'})).headers.get('Location'), '/admin/growth/email?test=pro-launch:unsubscribed&destination=inbox#test-result-pro-launch');
  assert.equal(sent.length, 0);
});

test('the page prints the agreed mail rules from the code: three types, who gets each, the per-address and daily limits', async () => {
  // Why (owner, 5 Nov 2026: "store in the Admin -> Email all these settings we agreed on"): the card reads MAIL_TYPES and DAILY_MAX, so it cannot drift from what send() does.
  const {env} = await fill();
  const html = page(await collect(env, {now}), null, null, null, [], undefined, 'settings');
  const card = html.slice(html.indexOf('id="mail-types"'), html.indexOf('</section>', html.indexOf('id="mail-types"')));
  for (const type of MAIL_TYPES) assert.ok(card.includes(type.name) && card.includes(type.who.slice(0, 20)), type.id);
  assert.match(card, /Tips and tricks<\/b><\/td><td>[^<]*<\/td><td><span class="pill off">Off/);
  assert.ok(card.includes(`${DAILY_MAX} mails a day`) && card.includes('stops that type only'));
});

test('every template card has its own button, and only a known notice word is printed', async () => {
  const {env} = await fill();
  const html = page(await collect(env, {now}), null, null, null, [], undefined, 'templates');
  assert.equal((html.match(/<button type="submit">Send to test inbox/g) || []).length, Object.keys(TEMPLATES).length);
});

test('template sends return to their card and distinguish the personal destination', async () => {
  const {env} = await live();
  const inbox = new URL((await view(post({template: 'welcome'}), env)).headers.get('Location'), 'https://www.jobadabra.top');
  assert.equal(inbox.hash, '#test-result-welcome');
  const personal = new URL((await view(post({template: 'welcome', mine: '1', to: 'reviewer@example.com', detail: '1'}), env)).headers.get('Location'), 'https://www.jobadabra.top');
  assert.equal(personal.searchParams.get('template'), 'welcome');
  assert.equal(personal.searchParams.get('destination'), 'personal');
  assert.equal(personal.hash, '#test-result-welcome');
  const html = await (await view(new Request(personal, {headers: {Authorization: 'Bearer script-key'}}), env)).text();
  assert.equal((html.match(/<iframe sandbox/g) || []).length, 1);
  assert.match(html, /Sent to the email address you entered/);
  assert.doesNotMatch(html, /sent to the test inbox/);
});

test('the template full-page view shows a visible failure and a back link', async () => {
  const {env} = await live();
  const html = await (await view(new Request('https://www.jobadabra.top/admin/growth/email?template=welcome&test=welcome:off', {headers: {Authorization: 'Bearer script-key'}}), env)).text();
  assert.equal((html.match(/<iframe sandbox/g) || []).length, 1);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /sent 0 in the window/);
  assert.match(html, /Email sending is switched off/);
  assert.match(html, /href="\/admin\/growth\/email\?tab=templates"/);
});

test('the email overview links to stable release drafts and template detail pages', async () => {
  const {env} = await live();
  env.STATS.db.prepare('INSERT INTO release_mail (version,data,created_at) VALUES (?,?,?)').run('0.9.9', '{}', 'x');
  env.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,?,?,?)').run('0.9.9', '2026-11-05', 'stable', 0, '[]', 'x');
  const open = async tab => (await view(new Request(`https://www.jobadabra.top/admin/growth/email?tab=${tab}`, {headers: {Authorization: 'Bearer script-key'}}), env)).text();
  assert.match(await open('releases'), /href="\/admin\/growth\/email\?release=0\.9\.9"/);
  assert.match(await open('templates'), /href="\/admin\/growth\/email\?template=welcome"/);
});

test('the four number tables are charts with the table behind "Show table"; the tooltip script is on each tab once', async () => {
  const {env} = await fill(), data = await collect(env, {now});
  const overview = page(data), people = page(data, null, null, null, [], undefined, 'people');
  assert.equal((overview.match(/<summary>Show table<\/summary>/g) || []).length, 2);   // By template, Why mail was not sent
  assert.equal((people.match(/<summary>Show table<\/summary>/g) || []).length, 2);   // Addresses, Stopped
  assert.match(overview, /By template<\/h2><div class="vz">[\s\S]*?<details class="vz-more"><summary>Show table[\s\S]*?<th>Template<\/th>/);
  for (const html of [overview, people]) assert.equal((html.match(/id="tip"/g) || []).length, 1);
  assert.match(overview, /Last 10 refusals and failures<\/h2><table>/);   // a log stays a table
});
