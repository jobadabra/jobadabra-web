// The "News from Jobadabra" card (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md): two switches on /api/mail/choices, both off until a yes,
// at most one of these mails per person per week, and migration 0140 keeping the yes of people who already answered. Fake D1 and sender.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address} from '../../../api/account-email.js';
import {choices} from '../../../api/mail-choices.js';
import {tokenFor} from '../../../shared/guard.js';
import {newsFacts, recordNews} from '../../../shared/mail-lists.js';
import {send} from '../../../shared/mail.js';
import {resetRuleCache} from '../../../shared/mail-registry.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  resetRuleCache();
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0138_mail_rule.sql', '0139_mail_held_row.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const one of list) await one.run(); }};
}
const now = new Date('2026-11-06T10:00:00Z'), later = days => new Date(now.getTime() + days * 86400000);
const INSTALL = 'install-news', TO = 'me@example.com';
const call = async (fn, e, method, body) => {
  const key = `JPF1.${INSTALL}.${await tokenFor(INSTALL, {STATS_SALT: 'salt'}, 'ai')}`;
  const response = await fn(new Request('https://x/api', {method, headers: {'x-api-key': key}, ...(body && {body: JSON.stringify(body)})}), e, now);
  return {status: response.status, ...await response.json()};
};
async function setup() {
  const store = new Map(), sent = [];
  const e = {MAIL: 'on', MARKETING_MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', WAITLIST: {get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }},
    EMAIL: {send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}};
  assert.equal((await call(address, e, 'PUT', {email: TO})).ok, true);
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = '2026-11-01T00:00:00Z'").run();
  sent.length = 0;
  return {e, sent};
}
const on = async e => Object.fromEntries((await call(choices, e, 'GET')).news.map(row => [row.id, row.on]));
const release = {version: '1.2.3', intro: 'New', headline: 'New', sections: [{title: 'One', text: 'Two'}]};
const pro = {pro: 10, proAi: 20, pricingUrl: 'https://x/p'};

test('the card has two switches, What\'s new on until stopped, and each press is the answer the sender obeys', async () => {
  // 12 Nov 2026, owner, asked via AskUserQuestion: "On for all, new too (Recommended)": What's new is on for every confirmed address until it is turned off.
  const {e, sent} = await setup();
  assert.deepEqual((await call(choices, e, 'GET')).news.map(row => row.name), ["What's new", 'News and tips']);
  assert.deepEqual(await on(e), {releases: true, tips: false});
  assert.equal((await send(e, 'release', TO, release, {now})).ok, true, 'a confirmed address with no answer gets the release mail');
  assert.equal(sent.length, 1);
  assert.equal((await call(choices, e, 'POST', {mail: 'releases', on: false})).ok, true);
  assert.deepEqual(await on(e), {releases: false, tips: false});
  assert.equal((await send(e, 'release', TO, release, {now: later(8)})).reason, 'unsubscribed', 'turned off is a stop the sender obeys');
  assert.equal((await call(choices, e, 'POST', {mail: 'releases', on: true})).ok, true);
  assert.deepEqual(await on(e), {releases: true, tips: false});
});

test('someone with no address yet sees both switches off, and a press waits for the address', async () => {
  const {e} = await setup();
  e.STATS.db.prepare('DELETE FROM pro_accounts').run();
  assert.deepEqual(await on(e), {releases: false, tips: false});
  assert.equal((await call(choices, e, 'POST', {mail: 'tips', on: true})).reason, 'no_address');
});

test('an unknown news row is refused', async () => {
  const {e} = await setup();
  assert.equal((await call(choices, e, 'POST', {mail: 'comeback', on: true})).reason, 'bad_request');
});

test('at most one news mail a week: the second waits out the week, own mails and tests do not count', async () => {
  const {e, sent} = await setup();
  for (const mail of ['releases', 'tips']) await call(choices, e, 'POST', {mail, on: true});
  assert.equal((await send(e, 'release', TO, release, {now})).ok, true);
  assert.equal((await send(e, 'pro-launch', TO, pro, {now: later(6)})).reason, 'week_cap');
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'week_cap'").get().n, 1, 'it counts under "Why mail was not sent"');
  assert.equal((await send(e, 'pro-launch', TO, pro, {now: later(6), test: true})).ok, true, 'a test send is outside the cap');
  assert.equal((await send(e, 'digest', TO, {total: 1, matches: [{title: 'SRE', url: 'https://x/1'}]}, {now: later(6)})).ok, true, 'a person\'s own mail is outside the cap');
  assert.equal((await send(e, 'pro-launch', TO, pro, {now: later(8)})).ok, true);
  assert.equal(sent.length, 4);
});

test('the old box says "product news and the Pro launch offer": a yes is a yes to both, and never lifts a stop', async () => {
  const {e} = await setup();
  const account = e.STATS.db.prepare('SELECT id FROM pro_accounts').get().id;
  await recordNews(e, account, {marketing: true}, now);
  assert.deepEqual(await on(e), {releases: true, tips: true});
  await call(choices, e, 'POST', {mail: 'releases', on: false});
  await recordNews(e, account, {marketing: true}, now);
  assert.deepEqual(await on(e), {releases: false, tips: true});
});

test('the installed app echoes the old box on every save: an echo changes nothing, whichever way it points', async () => {
  // Why (review of hr-36): GET `marketing` is the tips answer, and the app sends it back. Read as an answer, it would stop What's new for everyone migration 0140 kept, or invent a yes nobody gave.
  const {e} = await setup();
  const account = e.STATS.db.prepare('SELECT id FROM pro_accounts').get().id;
  await call(choices, e, 'POST', {mail: 'releases', on: true});
  await recordNews(e, account, {marketing: false}, now);
  assert.deepEqual(await on(e), {releases: true, tips: false}, 'false with tips off is an echo: What\'s new stays');
  await call(choices, e, 'POST', {mail: 'releases', on: false});
  await call(choices, e, 'POST', {mail: 'tips', on: true});
  await recordNews(e, account, {marketing: true}, now);
  assert.deepEqual(await on(e), {releases: false, tips: true}, 'true with tips on is an echo: no What\'s new yes appears');
});

test('a stale tick on a stopped box is no answer: nothing is stored', async () => {
  const {e} = await setup();
  const account = e.STATS.db.prepare('SELECT id FROM pro_accounts').get().id;
  await call(choices, e, 'POST', {mail: 'tips', on: false});
  await recordNews(e, account, {marketing: true}, now);
  assert.deepEqual(await on(e), {releases: true, tips: false}, 'nothing stored: What\'s new keeps its default (on), tips its stop');
});

test('a failed read of the yes table is never "no yes": it throws, and only a missing table reads as empty', async () => {
  const {e, sent} = await setup();
  const real = e.STATS.prepare, broken = message => text => (/FROM mail_on/.test(text) ? {bind: () => ({all: async () => { throw new Error(message); }})} : real(text));
  await call(choices, e, 'POST', {mail: 'tips', on: true});
  e.STATS.prepare = broken('D1 overloaded');
  await assert.rejects(newsFacts(e, 'x', TO), /D1 overloaded/);
  assert.equal((await call(choices, e, 'GET')).reason, 'not_read');
  assert.equal((await send(e, 'pro-launch', TO, pro, {now})).ok, false);
  assert.equal(sent.length, 0);
  e.STATS.prepare = broken('no such table: mail_on');
  assert.equal((await newsFacts(e, 'x', TO)).yes.size, 0);
});

test('migration 0140: an answer given keeps What\'s new; no answer and a stop do not', async () => {
  const {e} = await setup();
  const db = e.STATS.db, at = '2026-10-01T00:00:00Z';
  db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES ('yes-tips', 'tips', 'card', ?), ('stopped', 'tips', 'card', ?), ('digest-only', 'jobdigest', 'card', ?)").run(at, at, at);
  db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('no-tips', 'tips', 'settings', ?), ('stopped', 'releases', 'settings', ?)").run(at, at);
  db.exec(sql('0140_news_kept_yes.sql'));
  assert.deepEqual(db.prepare("SELECT addr FROM mail_on WHERE list = 'releases' ORDER BY addr").all().map(row => row.addr), ['no-tips', 'yes-tips']);
});
