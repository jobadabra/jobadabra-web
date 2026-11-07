// The address and the Telegram-style mail (api/account-email.js, api/mail-html.js): making a trial account from an install, refusing a taken or Pro address, the safe HTML subset,
// one mail a day to an unconfirmed address (the rest waits for the digest), confirming it with a signed link, and the marketing opt-in. Fake sender only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, confirm, notify, resend, language} from '../../../api/account-email.js';
import {sendDigests} from '../../../api/mail-held.js';
import {fromTelegram} from '../../../api/mail-html.js';
import {addrOf, confirmLink, compose, send} from '../../../shared/mail.js';
import {TEMPLATES} from '../../../shared/mail-templates.js';
import {switchOff} from '../../../api/mail-unsub.js';
import {tokenFor} from '../../../shared/guard.js';
import {createAccount} from '../../../shared/pro.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0141_notification_language.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = () => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}}; return {e, sent}; };
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const call = async (fn, e, install, method, body) => { const r = await fn(new Request('https://x/api', {method, headers: {'x-api-key': await keyOf(install)}, ...(body && {body: JSON.stringify(body)})}), e, new Date('2026-10-16T10:00:00Z')); return {status: r.status, ...(await r.json())}; };
const card = '<b>3 new matches</b>\nTop: <a href="https://x.example/1">Data Engineer</a> &amp; more';

test('language cache is authenticated and refreshed before the first welcome without changing consent', async t => {
  const {e, sent} = setup();
  t.mock.method(TEMPLATES.welcome, 'subject', data => `welcome:${data.locale}`);
  assert.equal((await call(address, e, 'install-lang', 'PUT', {email: 'lang@example.com', language: 'ru'})).ok, true);
  assert.equal(sent[0].subject, 'welcome:ru');
  for (const value of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    assert.deepEqual(await call(language, e, 'install-lang', 'PUT', {language: value}), {status: 200, ok: true, language: value});
    assert.equal(e.STATS.db.prepare('SELECT notification_language AS value FROM pro_accounts').get().value, value);
  }
  assert.equal((await call(language, e, 'install-lang', 'PUT', {language: 'system'})).status, 400);
  assert.equal((await call(language, e, 'install-other', 'PUT', {language: 'de'})).status, 409);
  assert.equal((await language(new Request('https://x/api', {method: 'PUT', body: '{"language":"de"}'}), e)).status, 401);
  assert.equal(e.STATS.db.prepare('SELECT notification_language AS value FROM pro_accounts').get().value, 'ru');
  const account = e.STATS.db.prepare('SELECT email, email_confirmed_at, service_mail_off_at FROM pro_accounts').get();
  assert.deepEqual({...account}, {email: 'lang@example.com', email_confirmed_at: null, service_mail_off_at: null});
  assert.equal(sent.length, 1, 'language updates send no mail');
});

test('compose defaults English and owner tests force English while end-user test mail follows recipient cache', async t => {
  const {e, sent} = setup();
  await call(address, e, 'install-lang', 'PUT', {email: 'lang@example.com', language: 'ru'});
  t.mock.method(TEMPLATES['always-on-test'], 'subject', data => `test:${data.locale}`);
  assert.equal(compose('always-on-test', {locale: 'ru'}).subject, 'test:en', 'payload locale cannot override the default audience');
  assert.equal(compose('always-on-test', {}, null, 'de').subject, 'test:de');
  assert.equal((await send(e, 'always-on-test', 'lang@example.com', {}, {test: true})).ok, true);
  assert.equal(sent.at(-1).subject, 'test:ru', 'user Test button is still end-user copy');
  assert.equal((await send(e, 'always-on-test', 'lang@example.com', {locale: 'ru'}, {test: true, ownerTest: true, locale: 'de'})).ok, true);
  assert.equal(sent.at(-1).subject, 'test:en', 'owner test cannot inherit a user locale');
  assert.ok(sent.every(mail => mail.to === 'lang@example.com'));
});

test('unconfirmed user test mail renders with recipient language and explicit message context does not overwrite the cache', async t => {
  const {e, sent} = setup();
  await call(address, e, 'install-lang', 'PUT', {email: 'lang@example.com', language: 'ru'});
  t.mock.method(TEMPLATES['always-on-test'], 'subject', data => `test:${data?.locale || 'en'}`);
  assert.equal((await call(notify, e, 'install-lang', 'POST', {kind: 'test'})).ok, true);
  assert.equal(sent.at(-1).subject, 'test:ru');
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-15');
  t.mock.method(TEMPLATES.message, 'subject', data => `${data.locale}:${data.subject}`);
  assert.equal((await call(notify, e, 'install-lang', 'POST', {subject: 'Fictional payload', html: card, language: 'de'})).ok, true);
  assert.equal(sent.at(-1).subject, 'de:Fictional payload');
  assert.equal(e.STATS.db.prepare('SELECT notification_language AS value FROM pro_accounts').get().value, 'ru');
});

test('a missing language migration never interrupts address registration, first welcome or cadence', async t => {
  const {e, sent} = setup();
  e.STATS.db.exec('ALTER TABLE pro_accounts DROP COLUMN notification_language');
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.mock.method(TEMPLATES.welcome, 'subject', data => `welcome:${data.locale}`);
  assert.equal((await call(address, e, 'install-rollout', 'PUT', {email: 'rollout@example.com', language: 'de', cadence: 'weekly'})).ok, true);
  assert.equal(sent[0].subject, 'welcome:de', 'current message context does not require a successful cache write');
  const saved = await call(address, e, 'install-rollout', 'GET');
  assert.equal(saved.email, 'rollout@example.com');
  assert.equal(saved.cadence, 'weekly');
  assert.deepEqual(warnings, [['notification language cache not refreshed']]);
  assert.deepEqual(await call(language, e, 'install-rollout', 'PUT', {language: 'de'}), {status: 503, ok: false, error: 'language_not_saved'});
  assert.equal(sent.length, 1, 'a failed dedicated refresh sends nothing');
});

test('fromTelegram keeps bold, italics and https links; shows every other tag as text; closes what is left open', () => {
  const {html, text} = fromTelegram('<b>Hi <script>alert(1)</script></b> <a href="javascript:x">bad</a> <a href="https://a.co/?x=1&amp;y=2">ok</a> <i>open');
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script') && !html.includes('javascript:'));
  assert.ok(html.includes('<a href="https://a.co/?x=1&amp;y=2">ok</a>') && html.endsWith('</i>'));
  assert.ok(text.includes('ok (https://a.co/?x=1&y=2)'));
});

test('an install gives its address once: a trial account with the install linked; a second install on a taken address is refused; Pro is refused', async () => {
  const {e} = setup();
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'not an address'})).status, 400);
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'Me@Example.com', marketing: true})).ok, true);
  const got = await call(address, e, 'install-aaaa', 'GET');
  assert.deepEqual([got.email, got.confirmed, got.marketing, got.plan], ['me@example.com', false, true, 'trial']);
  assert.equal((await call(address, e, 'install-bbbb', 'PUT', {email: 'me@example.com'})).error, 'taken');
  const pro = await createAccount(e, 'pro@example.com');
  e.STATS.db.prepare("UPDATE pro_accounts SET plan = 'pro' WHERE id = ?").run(pro);
  e.STATS.db.prepare('INSERT INTO pro_devices (install, account, added_at, last_seen) VALUES (?, ?, ?, ?)').run('install-pppp', pro, 'x', 'x');
  assert.equal((await call(address, e, 'install-pppp', 'PUT', {email: 'other@example.com'})).error, 'pro');
  assert.equal((await call(address, e, 'install-zzzz', 'GET')).email, null);
  assert.equal((await address(new Request('https://x/api', {method: 'GET'}), e)).status, 401);
});

test('changing the address makes a new unconfirmed one on the same devices; the opt-in can be switched off', async () => {
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'a@example.com', marketing: true});
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-15');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'b@example.com', marketing: false});
  const got = await call(address, e, 'install-aaaa', 'GET');
  assert.deepEqual([got.email, got.confirmed, got.marketing], ['b@example.com', false, false]);
});

// Owner, 26 Oct 2026 ("Do we really need a confirmation?" → "Soften it"): an unconfirmed address is never cut off; it gets at most one mail a day and the rest waits for the digest.
test('a message is mailed in the Telegram layout with a confirm link; an unconfirmed address gets one mail a day, the rest waits for the next digest; confirming lifts it', async () => {
  const {e, sent} = setup();
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 'x', html: card})).reason, 'no_address');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  sent.length = 0;   // the welcome mail (its own test below)
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: '3 new matches', html: card, buttons: [{text: 'Open', url: 'https://x.example/app'}, {text: 'bad', url: 'javascript:1'}]})).ok, true);
  assert.equal(sent[0].subject, '3 new matches');
  assert.ok(sent[0].html.includes('Data Engineer') && sent[0].html.includes('/confirm?a=') && sent[0].text.includes('Open: https://x.example/app') && !sent[0].text.includes('javascript'));
  const second = await call(notify, e, 'install-aaaa', 'POST', {subject: 'later the same day', html: card});
  assert.deepEqual([second.ok, second.held, sent.length], [true, true, 1], 'a second mail the same day waits for the digest, never dropped');
  assert.equal((await sendDigests(e, new Date('2026-10-17T07:00:00Z'))).sent, 1, 'the next day the held mail goes in the digest');
  assert.equal(sent.at(-1).subject, 'later the same day');
  assert.ok(sent.at(-1).html.includes('/confirm?a='), 'still with the confirm link');
  const link = await confirmLink(e, 'me@example.com');
  assert.equal((await confirm(new Request(link), e)).status, 200);
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).confirmed, false, 'a GET (a mail scanner) confirms nothing');
  assert.equal((await confirm(new Request(link.replace(/t=\w+/, 't=00'), {method: 'POST'}), e)).status, 400);
  assert.equal((await confirm(new Request(link, {method: 'POST'}), e)).status, 200);
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).confirmed, true);
  const last = sent.length;
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).ok, true);
  assert.ok(!sent[last].html.includes('/confirm?a='));
});

test('kind "test" (the GitHub way\'s Test): a confirmed address gets the alert test mail once a day, on a full address too, whatever the body or the number of calls', async () => {
  // Why (owner, 5 Nov 2026: "Still, test emmail are aside of this cap"); once a day so a stolen repo key cannot flood the inbox.
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-16T09:00:00Z');
  for (let i = 0; i < 12; i++) e.STATS.db.prepare("INSERT INTO mail_log (at, addr, list, template, status) VALUES (?, ?, 'service', 'digest', 'sent')").run('2026-10-16T09:30:00Z', await addrOf('me@example.com'));
  sent.length = 0;
  const all = await Promise.all(Array.from({length: 20}, () => call(notify, e, 'install-aaaa', 'POST', {kind: 'test', subject: 'x', html: card})));
  assert.ok(all.every(r => r.ok));
  assert.deepEqual(sent.map(m => m.subject), ['Always on test: your alerts reach you']);
  assert.deepEqual(await call(notify, e, 'install-aaaa', 'POST', {kind: 'test'}), {status: 200, ok: true, earlier: true});
});

test('kind "test" to an unconfirmed address follows the unconfirmed rules: the confirm link, one mail a day; it may be a stranger\'s', async () => {
  // Why (review of hr-23, 5 Nov 2026): sent bare, a stranger's address would get a mail a day for ever, with no confirm link and no 14-day stop.
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  sent.length = 0;
  await Promise.all(Array.from({length: 5}, () => call(notify, e, 'install-aaaa', 'POST', {kind: 'test'})));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Always on test: your alerts reach you');
  assert.match(sent[0].html, /confirm/i);
});

test('an empty message and a person who switched the service list off send nothing', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  sent.length = 0;   // the welcome mail (its own test below)
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: ''})).status, 400);
  e.STATS.db.prepare('UPDATE pro_accounts SET service_mail_off_at = ?').run('2026-10-16');
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).reason, 'unsubscribed');
  assert.equal(sent.length, 0);
});

test('an "activity" message waits for the digest; one mail a day with everything, weekly on Mondays for a weekly account; matches and the rest go at once', async () => {
  const {e, sent} = setup(), mon = new Date('2026-10-19T06:00:00Z'), tue = new Date('2026-10-20T06:00:00Z');
  await call(address, e, 'install-held', 'PUT', {email: 'me@example.com'});
  sent.length = 0;   // the welcome mail (its own test below)
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-01');
  const first = await call(notify, e, 'install-held', 'POST', {subject: 'Matches', html: card}); assert.equal(first.ok, true);   // new matches: at once
  assert.equal(sent.length, 1);
  assert.equal((await call(notify, e, 'install-held', 'POST', {subject: 'Rejection from Acme', html: '<b>Acme said no</b>', kind: 'activity'})).held, true);
  assert.equal((await call(notify, e, 'install-held', 'POST', {subject: 'Insight', html: '<b>Insight ready</b>', kind: 'activity'})).held, true);
  assert.equal(sent.length, 1, 'held, not sent');
  assert.deepEqual(await sendDigests(e, tue), {sent: 1, kept: 0});
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /2 items/);
  assert.ok(sent[1].text.includes('Acme said no') && sent[1].text.includes('Insight ready'));
  assert.deepEqual(await sendDigests(e, tue), {sent: 0, kept: 0}, 'nothing held, nothing sent');
  assert.equal((await call(address, e, 'install-held', 'PUT', {email: 'me@example.com', cadence: 'weekly'})).ok, true);
  assert.equal((await call(address, e, 'install-held', 'GET')).cadence, 'weekly');
  await call(notify, e, 'install-held', 'POST', {subject: 'Done', html: '<b>Job finished</b>', kind: 'activity'});
  assert.deepEqual(await sendDigests(e, tue), {sent: 0, kept: 1}, 'a weekly account waits for Monday');
  assert.deepEqual(await sendDigests(e, mon), {sent: 1, kept: 0});
  assert.equal(sent.length, 3);
  assert.equal((await call(address, e, 'install-held', 'PUT', {email: 'me@example.com', cadence: 'hourly'})).ok, true);
  assert.equal((await call(address, e, 'install-held', 'GET')).cadence, 'weekly', 'an unknown cadence changes nothing');
});

test('GET says whether mail is sending: the app must not promise an e-mail the kill switch holds back (MAIL off since 16 Oct 2026)', async () => {
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).sending, true);
  e.MAIL = 'off';
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).sending, false);
  e.MAIL = 'on'; delete e.EMAIL;
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).sending, false, 'no sender bound');
});

// Owner, 26 Oct 2026: "Can we send an welcome email?": saving an address sent nothing; the confirm link waited for the first real mail (a digest, maybe a day later).
test('a new or changed address gets one welcome mail with the confirm button, once per address ever; re-saving sends nothing', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].subject, /confirm/i);
  assert.ok(sent[0].html.includes('/confirm?a=') && sent[0].text.includes('Confirm your email: https://'), 'the confirm link is the button');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', cadence: 'weekly'});
  assert.equal(sent.length, 1, 'a re-save (cadence, opt-in) sends nothing');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'new@example.com'});
  assert.equal(sent.at(-1).to, 'new@example.com', 'a changed address is welcomed too');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.equal(sent.length, 2, 'back to an address already welcomed: no second welcome');
  assert.equal((await call(notify, e, 'install-aaaa', 'POST', {subject: 's', html: card})).ok, true, 'the welcome does not use up the day\'s one mail of an unconfirmed address');
  assert.equal(sent.at(-1).subject, 's');
});

test('the welcome waits for the kill switch: with mail off the address is saved and nothing is sent', async () => {
  const {e, sent} = setup();
  e.MAIL = 'off';
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'})).ok, true);
  assert.equal(sent.length, 0);
});

// Owner, 26 Oct 2026 ("Stop after 14 days"): daily mail to a typed-in address nobody confirms must end; confirming later starts it again.
test('an address unconfirmed for 14 days after its first mail gets no more mail; the app is told; confirming starts it again', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});   // the welcome, 16 Oct
  const send = async iso => (await notify(new Request('https://x/api', {method: 'POST', headers: {'x-api-key': await keyOf('install-aaaa')}, body: JSON.stringify({subject: iso, html: card})}), e, new Date(iso))).json();
  assert.equal((await send('2026-10-29T10:00:00Z')).ok, true, 'day 13: still mailed');
  const late = await send('2026-10-31T10:00:00Z');
  assert.deepEqual([late.ok, late.reason], [false, 'unconfirmed_stopped'], 'day 15: stopped');
  assert.equal(sent.at(-1).subject, '2026-10-29T10:00:00Z');
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).unconfirmedStopped, true, 'the app can say why mail stopped');
  assert.equal((await send('2026-11-01T10:00:00Z')).ok, false, 'and it stays stopped');
  const link = await confirmLink(e, 'me@example.com');
  assert.equal((await confirm(new Request(link, {method: 'POST'}), e)).status, 200);
  assert.equal((await call(address, e, 'install-aaaa', 'GET')).unconfirmedStopped, false);
  assert.equal((await send('2026-11-02T10:00:00Z')).ok, true, 'confirmed: mail comes again');
});

const web = JSON.stringify({source: 'web'}), appSource = JSON.stringify({source: 'app'});
const withWaitlist = e => { e.WAITLIST = {get: async key => ({'signup:web@example.com': web, 'signup:app@example.com': appSource})[key] ?? null}; return e; };
const news = async (e, install = 'install-aaaa') => { const got = await call(address, e, install, 'GET'); return {releases: got.releases, tips: got.tips, answered: got.newsAnswered, old: got.marketing}; };
const rows = (e, sql) => e.STATS.db.prepare(sql).all().map(row => ({...row}));

test('the owner\'s case: a confirmed address with no stop shows both news switches off, never answered', async () => {
  // Why (5 Nov 2026): the owner's box showed "Also send me product news" ticked while the site held no tick (their row: marketing_opt_in 0, no stop on file). GET said "no stop", not "ticked".
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.deepEqual(await news(e), {releases: false, tips: false, answered: false, old: false}, 'unconfirmed: the sender sends no news');
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x'").run();
  assert.deepEqual(await news(e), {releases: false, tips: false, answered: false, old: false}, 'both need a yes (owner, 6 Nov 2026); the app\'s old box reads tips');
  assert.deepEqual(rows(e, 'SELECT * FROM mail_on'), [], 'a default stores nothing');
});

test('a PUT with releases and tips stores each answer apart; a missing field changes nothing; false stops that type only', async () => {
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x'").run();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', tips: true, newsVia: 'card'});
  assert.deepEqual(await news(e), {releases: false, tips: true, answered: true, old: true});
  assert.deepEqual(rows(e, 'SELECT list, via FROM mail_on'), [{list: 'tips', via: 'card'}], 'only what was pressed; the via says where');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', releases: false});
  assert.deepEqual(await news(e), {releases: false, tips: true, answered: true, old: true}, 'stopping releases leaves tips');
  assert.deepEqual(rows(e, "SELECT list FROM mail_off WHERE list IN ('releases', 'tips')"), [{list: 'releases'}]);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', releases: true});
  assert.deepEqual(await news(e), {releases: true, tips: true, answered: true, old: true}, 'a yes lifts the stop for a confirmed address');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  assert.deepEqual(await news(e), {releases: true, tips: true, answered: true, old: true}, 'a save with no news field changes nothing');
});

test('the old box from an app already out says "product news and the Pro launch offer": true is a yes to both; false stops only what was a yes', async () => {
  // Why (review of #hr-24, 5 Nov 2026): the app sends marketing on every save, so a never-answered box must not become a stop that later beats a waitlist signup.
  const {e} = setup();
  const stops = () => rows(e, "SELECT COUNT(*) n FROM mail_off WHERE list IN ('releases', 'tips')")[0].n;
  await call(address, e, 'install-aaaa', 'PUT', {email: 'new@example.com', marketing: false});
  await call(address, e, 'install-aaaa', 'PUT', {email: 'new@example.com', marketing: false});
  assert.equal(stops(), 0);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'new@example.com', marketing: true});
  assert.deepEqual(rows(e, 'SELECT list, via FROM mail_on ORDER BY list'), [{list: 'releases', via: 'old-box'}, {list: 'tips', via: 'old-box'}]);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'new@example.com', marketing: false});
  assert.equal(stops(), 2, 'each yes it gave is taken back');
  const listed = withWaitlist(setup().e);
  await call(address, listed, 'install-bbbb', 'PUT', {email: 'web@example.com', marketing: false});
  assert.equal((await news(listed, 'install-bbbb')).releases, true, 'the website waitlist signup still counts: the unticked box took nothing back');
  assert.equal(rows(listed, "SELECT COUNT(*) n FROM mail_off")[0].n, 0);
});

test('the app echoing its old box on every save never undoes a releases stop', async () => {
  // Why (review of #436): the app sends `marketing` (the Tips answer GET showed it) on every save.
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x'").run();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', tips: true});
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', releases: false});
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', marketing: true});   // the echo of the box GET showed
  assert.deepEqual(await news(e), {releases: false, tips: true, answered: true, old: true}, 'the releases stop stays');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', tips: false});   // a stop made through a mail link
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', marketing: true, cadence: 'weekly'});   // the app's cached box, echoed on a cadence change
  assert.deepEqual(await news(e), {releases: false, tips: false, answered: true, old: false}, 'a stale echo never lifts a stop (Gitar on #436)');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com', tips: true});
  assert.equal((await news(e)).tips, true, 'only the explicit field lifts it');
});

test('a Pro account saves its choices at its own address; only changing the address is refused', async () => {
  // Why (review of #hr-24, 5 Nov 2026): the 409 came first, so a Pro person could not tick product news.
  const {e} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'pro@example.com'});
  e.STATS.db.prepare("UPDATE pro_accounts SET plan = 'pro'").run();
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'pro@example.com', tips: true})).status, 200);
  assert.deepEqual(await news(e), {releases: false, tips: true, answered: true, old: true}, 'a Pro account counts as confirmed');
  assert.equal((await call(address, e, 'install-aaaa', 'PUT', {email: 'other@example.com'})).status, 409);
  for (const list of ['releases', 'tips']) e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ((SELECT email_hash FROM pro_accounts), ?, 'unsubscribe', 'x')").run(list);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'pro@example.com', releases: true, tips: true});
  assert.deepEqual(await news(e), {releases: true, tips: true, answered: true, old: true}, 'a Pro account with no confirm timestamp can lift its own stop (Gitar on #436)');
});

test('a yes from an unconfirmed address does not erase that address\'s stop: it may be someone else\'s', async () => {
  // Why (review of #hr-24, 5 Nov 2026): anyone can type an address, and a stop must beat a tick.
  const {e} = setup();
  for (const list of ['releases', 'tips']) e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, ?, 'unsubscribe', 'x')").run(await addrOf('stopped@example.com'), list);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'stopped@example.com', releases: true, tips: true});
  assert.equal(rows(e, "SELECT COUNT(*) n FROM mail_off WHERE list IN ('releases', 'tips')")[0].n, 2);
  assert.deepEqual(await news(e), {releases: false, tips: false, answered: true, old: false});
  e.STATS.db.prepare('UPDATE pro_accounts SET email_confirmed_at = ?').run('2026-10-16T09:00:00Z');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'stopped@example.com', releases: true, tips: true});
  assert.deepEqual(await news(e), {releases: true, tips: true, answered: true, old: true}, 'the confirmed owner of the address can turn them back on');
});

test('a website waitlist signup counts for releases and the app one for the Pro mail only: the app shows what the sender does', async () => {
  // Why (owner, 5 Nov 2026): the app\'s waitlist dialog still says "We\'ll e-mail you once when Pro opens. Nothing else." (shared/mail-lists.js signupKind).
  const e = withWaitlist(setup().e);
  await call(address, e, 'install-aaaa', 'PUT', {email: 'web@example.com'});
  assert.deepEqual(await news(e), {releases: true, tips: false, answered: false, old: false});
  await call(address, e, 'install-bbbb', 'PUT', {email: 'app@example.com'});
  assert.deepEqual(await news(e, 'install-bbbb'), {releases: false, tips: false, answered: false, old: false});
});

// Owner, 2 Nov 2026 ("Keep it, make it painless"): the welcome goes once per address ever, so a lost mail needs a Resend, rate-limited.
test('Resend sends the confirm link again: 1 an hour, 3 a day; a confirmed address, no address and a bad key get nothing', async () => {
  const {e, sent} = setup();
  const at = iso => async install => (await resend(new Request('https://x/api/account/email/resend', {method: 'POST', headers: {'x-api-key': await keyOf(install)}}), e, new Date(iso)));
  assert.equal((await (await at('2026-10-16T10:00:00Z')('install-aaaa')).json()).error, 'no_address', 'no address yet');
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});   // the welcome, 10:00
  assert.equal(sent.length, 1);
  const first = await (await at('2026-10-16T10:05:00Z')('install-aaaa')).json();
  assert.equal(first.ok, true, 'positive control: the first Resend goes');
  assert.equal(sent.length, 2);
  assert.ok(sent[1].html.includes('/confirm?a=') && /again/.test(sent[1].text), 'with the confirm link');
  assert.deepEqual(await (await at('2026-10-16T10:30:00Z')('install-aaaa')).json(), {ok: false, error: 'wait'}, 'a second call within the hour is refused');
  assert.equal(sent.length, 2, 'and sends nothing');
  assert.equal((await (await at('2026-10-16T11:10:00Z')('install-aaaa')).json()).ok, true, 'an hour later: the 2nd');
  assert.equal((await (await at('2026-10-16T12:20:00Z')('install-aaaa')).json()).ok, true, 'the 3rd');
  assert.equal((await (await at('2026-10-16T13:30:00Z')('install-aaaa')).json()).error, 'wait', 'a 4th the same day: refused');
  assert.equal((await (await at('2026-10-17T11:00:00Z')('install-aaaa')).json()).ok, true, 'the next day: allowed again');
  const bad = await resend(new Request('https://x/api/account/email/resend', {method: 'POST', headers: {'x-api-key': 'JPF1.install-aaaa.nope'}}), e, new Date('2026-10-17T10:00:00Z'));
  assert.equal(bad.status, 401, 'a wrong key gets nothing');
  await confirm(new Request(await confirmLink(e, 'me@example.com'), {method: 'POST'}), e);
  assert.equal((await (await at('2026-10-19T10:00:00Z')('install-aaaa')).json()).error, 'confirmed', 'confirmed: nothing to resend');
});

test('Resend reaches an address whose mail the 14-day stop holds back, and says so when mail is switched off', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});   // the welcome, 16 Oct
  const late = await notify(new Request('https://x/api', {method: 'POST', headers: {'x-api-key': await keyOf('install-aaaa')}, body: JSON.stringify({subject: 's', html: card})}), e, new Date('2026-10-31T10:00:00Z'));
  assert.equal((await late.json()).reason, 'unconfirmed_stopped', 'day 15: stopped');
  const press = async iso => (await resend(new Request('https://x/api/account/email/resend', {method: 'POST', headers: {'x-api-key': await keyOf('install-aaaa')}}), e, new Date(iso))).json();
  assert.equal((await press('2026-10-31T10:05:00Z')).ok, true);
  assert.equal(sent.at(-1).subject, 'Confirm your email for Jobadabra');
  e.MAIL = 'off';
  assert.equal((await press('2026-11-01T10:00:00Z')).error, 'off', 'mail off: the app is told, not promised');
});

test('Resend never mails an address whose owner stopped our mail; only the 14-day stop is lifted (Gitar on #333)', async () => {
  const {e, sent} = setup();
  await call(address, e, 'install-aaaa', 'PUT', {email: 'me@example.com'});   // the welcome
  await switchOff(e, await addrOf('me@example.com'), 'service', 'unsubscribe', new Date('2026-10-16T10:01:00Z'));   // the owner pressed the stop link
  const before = sent.length;
  const press = async () => (await resend(new Request('https://x/api/account/email/resend', {method: 'POST', headers: {'x-api-key': await keyOf('install-aaaa')}}), e, new Date('2026-10-16T12:00:00Z'))).json();
  assert.deepEqual(await press(), {ok: false, error: 'stopped'});
  assert.equal(sent.length, before, 'nothing is mailed to a person who said stop');
});
