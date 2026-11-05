// The e-mail sender (shared/mail.js, api/mail-unsub.js): refusals, the per-address limit, the two lists, one-click unsubscribe, bounce/complaint events, and that no mail body or plain address is logged.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {DAILY_MAX, addrOf, mailAllowed, send, sendTestMail, stopLink} from '../../../../shared/mail.js';
import {handleEvent, unsubscribe} from '../../../../api/mail-unsub.js';
import {TEMPLATES} from '../../../../shared/mail-templates.js';
import {createAccount} from '../../../../shared/pro.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const setup = (extra = {}) => { const sent = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}, ...extra}; return {e, sent}; };
const now = new Date('2026-10-16T10:00:00Z');
const digest = {total: 2, matches: [{title: 'Data Engineer', company: 'Acme', fit: 82, url: 'https://x/1'}, {title: 'SRE', url: 'https://x/2'}]};
const rows = (e, text) => e.STATS.db.prepare(text).all();

test('a digest goes out from the service address with the footer, the one-click link and the headers; the log keeps no body and no address', async () => {
  const {e, sent} = setup(), got = await send(e, 'digest', 'Me@Example.com', digest, {now});
  assert.deepEqual(got, {ok: true, id: 'm1'});
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].from, /no-reply@jobadabra\.top/);
  const link = await stopLink(e, 'me@example.com', 'service');
  assert.ok(sent[0].text.includes(link) && sent[0].html.includes(link.replaceAll('&', '&amp;')));
  assert.equal(sent[0].headers['List-Unsubscribe'], `<${link}>`);
  assert.equal(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const log = JSON.stringify(rows(e, 'SELECT * FROM mail_log'));
  assert.ok(!log.includes('example.com') && !log.includes('Data Engineer'));
  assert.deepEqual(rows(e, 'SELECT status, template, list FROM mail_log').map(r => ({...r})), [{status: 'sent', template: 'digest', list: 'service'}]);
});

test('nothing is sent when MAIL is off, the binding is missing, the address is bad or the template is unknown', async () => {
  const {e, sent} = setup({MAIL: 'off'});
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'off');
  assert.equal((await send(setup().e, 'digest', 'not an address', digest, {now})).reason, 'bad_address');
  assert.equal((await send(setup().e, 'nope', 'a@b.co', {}, {now})).reason, 'bad_template');
  assert.equal(sent.length, 0);
});

test('a test mail is outside the per-address cap: sent when the address is full, never takes its room; the alert test goes once a day', async () => {
  // Why (owner, 5 Nov 2026: "Still, test emmail are aside of this cap"): the owner's own Test failed with "Too many e-mails today".
  const {e, sent} = setup();
  for (let i = 0; i < 3; i++) assert.equal((await send(e, 'digest', 'a@b.co', digest, {now, test: true})).ok, true);
  for (let i = 0; i < DAILY_MAX; i++) assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true, `real mail ${i + 1} after 3 tests`);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'rate');
  assert.equal((await sendTestMail(e, 'a@b.co', now)).ok, true, 'the alert test goes on a full address');
  assert.deepEqual(await sendTestMail(e, 'a@b.co', new Date(now.getTime() + 3600e3)), {ok: true, at: now.toISOString(), earlier: true}, 'and once a day');
  assert.equal(sent.length, 3 + DAILY_MAX + 1);
  assert.deepEqual(e.STATS.db.prepare("SELECT template FROM mail_log WHERE template LIKE 'test:%' GROUP BY template").all().map(r => r.template), ['test:always-on-test', 'test:digest']);
  const capped = setup({MAIL_DAY_MAX: '2'});
  for (let i = 0; i < 2; i++) await send(capped.e, 'digest', `p${i}@b.co`, digest, {now, test: true});
  assert.equal((await send(capped.e, 'digest', 'q@b.co', digest, {now, test: true})).reason, 'rate', 'the product-wide cap still counts tests');
});

test('the alert test mail goes once a day even when 20 calls arrive at once, and a failed one can be tried again', async () => {
  // Why (review of hr-23, 5 Nov 2026): a read then a send let 20 parallel calls send 20 mails through a route a repo key can reach.
  const {e, sent} = setup();
  const all = await Promise.all(Array.from({length: 20}, () => sendTestMail(e, 'a@b.co', now)));
  assert.equal(sent.length, 1);
  assert.ok(all.every(r => r.ok));
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'claimed'").get().n, 0, 'no claim left behind');
  const flaky = setup();
  flaky.e.EMAIL = {send: async () => { throw new Error('provider down'); }};
  assert.deepEqual(await sendTestMail(flaky.e, 'a@b.co', now), {ok: false, reason: 'failed'});
  flaky.e.EMAIL = {send: async () => ({messageId: 'm1'})};
  assert.equal((await sendTestMail(flaky.e, 'a@b.co', now)).earlier, undefined, 'a refused mail does not use up the day');
});

test('a claim left by a Worker that died counts for two minutes only: the next Test sends, it does not claim a mail that never went', async () => {
  // Why (Gitar on #430, 5 Nov 2026): a leftover claim read as "a test e-mail went to you today" for 24 h with nothing sent.
  const {e, sent} = setup();
  const leftover = async ago => e.STATS.db.prepare("INSERT INTO mail_log (at, addr, list, template, status) VALUES (?, ?, 'service', 'test:always-on-test', 'claimed')").run(new Date(now.getTime() - ago).toISOString(), await addrOf('a@b.co'));
  await leftover(60e3);
  assert.equal((await sendTestMail(e, 'a@b.co', now)).earlier, true, 'a fresh claim is another call at work');
  assert.equal(sent.length, 0);
  e.STATS.db.prepare('DELETE FROM mail_log').run();
  await leftover(3 * 60e3);
  assert.equal((await sendTestMail(e, 'a@b.co', now)).earlier, undefined);
  assert.equal(sent.length, 1);
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'claimed'").get().n, 0);
});

test('the alert test mail says the truth: an address that stopped mail since the last test is refused, mail off is off, a D1 error never throws', async () => {
  const {e} = setup();
  await sendTestMail(e, 'a@b.co', now);
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'service', 'bounce', ?)").run(await addrOf('a@b.co'), now.toISOString());
  assert.equal((await sendTestMail(e, 'a@b.co', new Date(now.getTime() + 3600e3))).ok, false);
  assert.equal((await sendTestMail({...setup().e, MAIL: 'off'}, 'a@b.co', now)).reason, 'off');
  const broken = setup().e;
  broken.STATS = {...broken.STATS, prepare: () => { throw new Error('no such table'); }};
  assert.equal((await sendTestMail(broken, 'a@b.co', now)).ok, false);
});

test('the 11th mail to one address in a day is refused; another address and the next day are fine', async () => {
  assert.equal(DAILY_MAX, 10, 'owner, 5 Nov 2026: "10 a day"');
  const {e, sent} = setup();
  for (let i = 0; i < DAILY_MAX; i++) assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'rate');
  assert.equal((await send(e, 'digest', 'c@d.co', digest, {now})).ok, true);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now: new Date(now.getTime() + 25 * 3600e3)})).ok, true);
  assert.equal(sent.length, DAILY_MAX + 2);
});

test('one-click unsubscribe: GET only asks, POST turns the service list off (log, account column, later sends refused); a wrong token does nothing', async () => {
  const {e, sent} = setup(), id = await createAccount(e, 'me@example.com', now, {plan: 'trial'});
  const link = await stopLink(e, 'me@example.com', 'service');
  assert.equal((await unsubscribe(new Request(link), e, now)).status, 200);
  assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).ok, true, 'a GET (a mail scanner) changes nothing');
  assert.equal((await unsubscribe(new Request(link.replace(/t=\w+/, 't=00'), {method: 'POST'}), e, now)).status, 400);
  assert.equal((await unsubscribe(new Request(link, {method: 'POST'}), e, now)).status, 200);
  assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).reason, 'unsubscribed');
  assert.ok(rows(e, 'SELECT service_mail_off_at FROM pro_accounts WHERE id = ?'.replace('?', `'${id}'`))[0].service_mail_off_at);
  assert.equal(sent.length, 1);
});

test('a sign-in code is not stopped by the service unsubscribe, and carries no unsubscribe footer', async () => {
  const {e, sent} = setup();
  await unsubscribe(new Request(await stopLink(e, 'me@example.com', 'service'), {method: 'POST'}), e, now);
  assert.equal((await send(e, 'account-code', 'me@example.com', {code: '123456'}, {now})).ok, true);
  assert.ok(!sent[0].text.includes('unsubscribe') && !sent[0].headers);
});

test('marketing mail goes to anyone who has not stopped it (owner, 28 Oct 2026: opt-out), and its unsubscribe stops it; the service list is untouched', async () => {
  TEMPLATES.news = {list: 'marketing', subject: () => 'News', title: () => 'News', text: () => 'Pro is here', html: () => '<p>Pro is here</p>'};
  try {
    const {e, sent} = setup({MARKETING_MAIL: 'on'});
    await createAccount(e, 'me@example.com', now, {plan: 'trial'});
    assert.equal((await send({...e, MARKETING_MAIL: 'off'}, 'news', 'me@example.com', {}, {now})).reason, 'marketing_off', 'the owner\'s flag is off: nothing promotional goes out');
    assert.equal((await send(e, 'news', 'nobody@example.com', {}, {now})).ok, true, 'an address with no account (the waitlist) gets it too');
    assert.equal((await send(e, 'news', 'me@example.com', {}, {now})).ok, true);
    assert.match(sent[0].from, /^Igor from Jobadabra <no-reply@jobadabra\.top>$/);
    await unsubscribe(new Request(await stopLink(e, 'me@example.com', 'marketing'), {method: 'POST'}), e, now);
    assert.equal((await send(e, 'news', 'me@example.com', {}, {now})).reason, 'unsubscribed');
    assert.equal((await send(e, 'digest', 'me@example.com', digest, {now})).ok, true);
  } finally { delete TEMPLATES.news; }
});

test('a hard bounce or a complaint turns every list off, even a sign-in code; a soft bounce does not', async () => {
  const {e} = setup(), event = (type, extra = {}) => ({type, payload: {recipient: 'Bad@Example.com', ...extra}});
  assert.equal(await handleEvent(e, event('cf.email.sending.message.bounced', {bounce: {type: 'soft'}}), now), false);
  assert.equal((await mailAllowed(e, 'bad@example.com')).ok, true);
  assert.equal(await handleEvent(e, event('cf.email.sending.message.bounced', {bounce: {type: 'hard'}}), now), true);
  assert.equal((await send(e, 'digest', 'bad@example.com', digest, {now})).reason, 'suppressed');
  assert.equal((await send(e, 'account-code', 'bad@example.com', {code: '1'}, {now})).reason, 'suppressed');
  const other = setup().e;
  await handleEvent(other, event('cf.email.sending.message.complained'), now);
  assert.equal((await mailAllowed(other, 'bad@example.com')).reason, 'suppressed');
  assert.equal(await addrOf('bad@example.com'), await addrOf(' BAD@example.com '));
});

test('a failing sender is logged as failed and reported, not thrown', async () => {
  const {e} = setup({EMAIL: {send: async () => { throw new Error('boom'); }}});
  assert.deepEqual(await send(e, 'digest', 'a@b.co', digest, {now}), {ok: false, reason: 'failed'});
  assert.equal(rows(e, 'SELECT status FROM mail_log')[0].status, 'failed');
});

// The per-person cap under parallel calls (jobadabra-web#431; measured in the review of #430: 20 of 20 parallel sends went out). A send claims its room in one statement BEFORE the provider answers.
const room = e => e.STATS.db.prepare("SELECT status, COUNT(*) AS n FROM mail_log GROUP BY status").all().reduce((all, row) => ({...all, [row.status]: row.n}), {});

test('20 mails to one person at once: only DAILY_MAX go out, the rest are refused as "rate", and no claim is left behind', async () => {
  const {e, sent} = setup();
  const all = await Promise.all(Array.from({length: 20}, () => send(e, 'digest', 'a@b.co', digest, {now})));
  assert.equal(sent.length, DAILY_MAX);
  assert.equal(all.filter(r => r.ok).length, DAILY_MAX);
  assert.deepEqual(all.filter(r => !r.ok).map(r => r.reason), Array(20 - DAILY_MAX).fill('rate'));
  assert.deepEqual(room(e), {sent: DAILY_MAX, rate: 20 - DAILY_MAX}, 'one row per mail and per refusal, no claim kept');
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'sent' AND message_id LIKE 'm%'").get().n, DAILY_MAX, 'a sent row carries the provider\'s id, never the claim marker');
});

test('a mail the provider fails gives its room back, in parallel too: twelve fail at once, then the person still gets DAILY_MAX', async () => {
  const {e, sent} = setup();
  e.EMAIL = {send: async () => { throw new Error('provider down'); }};
  const failed = await Promise.all(Array.from({length: 12}, () => send(e, 'digest', 'a@b.co', digest, {now})));
  assert.equal(failed.every(r => r.reason === 'failed' || r.reason === 'rate'), true);
  e.EMAIL = {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }};
  const after = [];
  for (let i = 0; i < DAILY_MAX + 1; i++) after.push(await send(e, 'digest', 'a@b.co', digest, {now}));
  assert.equal(after.filter(r => r.ok).length, DAILY_MAX, 'every claim of the failed ones was released: nothing is held');
  assert.equal(after.at(-1).reason, 'rate');
  assert.equal(room(e).claimed, undefined);
  assert.ok(room(e).failed >= 1, 'a failure is still logged');
});

test('a mail that went out is counted even when its claim row is gone or cannot be settled', async () => {
  const {e, sent} = setup();
  e.EMAIL = {send: async message => { e.STATS.db.prepare("DELETE FROM mail_log WHERE status = 'claimed'").run(); sent.push(message); return {messageId: 'm1'}; }};
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true);
  assert.deepEqual(room(e), {sent: 1}, 'the UPDATE matched nothing: the mail is logged as sent anyway');
});

test('a database that reports no changes count stops the send loudly, it is never read as a full cap', async () => {
  const {e, sent} = setup();
  const real = e.STATS.prepare;
  e.STATS = {...e.STATS, prepare: text => { const statement = real(text); return text.startsWith('INSERT INTO mail_log') && text.includes("'claimed'") ? {bind: (...v) => ({...statement.bind(...v), run: async () => { await statement.bind(...v).run(); return {}; }})} : statement; }};
  const refused = await send(e, 'digest', 'a@b.co', digest, {now});
  assert.equal(refused.reason, 'failed');
  assert.equal(sent.length, 0);
});

test('test sends stay outside the per-person cap, in parallel too: 20 at once, then the person still gets DAILY_MAX', async () => {
  const {e, sent} = setup();
  await Promise.all(Array.from({length: 20}, () => send(e, 'digest', 'a@b.co', digest, {now, test: true})));
  assert.equal(sent.length, 20);
  const real = await Promise.all(Array.from({length: 20}, () => send(e, 'digest', 'a@b.co', digest, {now})));
  assert.equal(real.filter(r => r.ok).length, DAILY_MAX);
});

test('the product-wide cap holds under parallel calls too (20 addresses at once, MAIL_DAY_MAX 5)', async () => {
  const {e, sent} = setup({MAIL_DAY_MAX: '5'});
  const all = await Promise.all(Array.from({length: 20}, (_, i) => send(e, 'digest', `p${i}@b.co`, digest, {now})));
  assert.equal(sent.length, 5);
  assert.equal(all.filter(r => r.reason === 'rate').length, 15);
});

test('a claim left by a Worker that died counts for two minutes only, then the person has the room back', async () => {
  const {e, sent} = setup();
  const addr = await addrOf('a@b.co');
  const leftover = ago => e.STATS.db.prepare("INSERT INTO mail_log (at, addr, list, template, status) VALUES (?, ?, 'service', 'digest', 'claimed')").run(new Date(now.getTime() - ago).toISOString(), addr);
  for (let i = 0; i < DAILY_MAX - 1; i++) leftover(60e3);
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true, 'nine fresh claims leave room for one');
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).reason, 'rate', 'ten are full');
  e.STATS.db.prepare("UPDATE mail_log SET at = ? WHERE status = 'claimed'").run(new Date(now.getTime() - 3 * 60e3).toISOString());
  assert.equal((await send(e, 'digest', 'a@b.co', digest, {now})).ok, true, 'a stale claim gives its room back');
  assert.equal(sent.length, 2);
});
