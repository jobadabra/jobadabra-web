// Each person's choice per app mail (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md, PR 3): POST /api/notify/email names the mail (`mail`), the person's
// "off" and the owner's stop on that row hold it, both when it goes at once and when it waits for the digest; an older app names none and keeps today's path. The app reads and
// writes the choices on /api/mail/choices with the same key. Fake D1 and sender.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, notify} from '../../../api/account-email.js';
import {choices} from '../../../api/mail-choices.js';
import {choiceRefusal} from '../../../shared/mail-choices.js';
import {APP_ROWS, resetRuleCache, setRule} from '../../../shared/mail-registry.js';
import {tokenFor} from '../../../shared/guard.js';
import {mintTrialKey} from '../../../shared/trial-key.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1(files = ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0138_mail_rule.sql']) {
  resetRuleCache();
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const one of list) await one.run(); }};
}
const now = new Date('2026-11-06T10:00:00Z');
const INSTALL = 'install-aaaa';
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const call = async (fn, e, method, body, install = INSTALL) => {
  const response = await fn(new Request('https://x/api', {method, headers: {'x-api-key': await keyOf(install)}, ...(body && {body: JSON.stringify(body)})}), e, now);
  return {status: response.status, ...await response.json()};
};
async function setup(files) {
  const store = new Map(), sent = [], e = {MAIL: 'on', STATS: d1(files), STATS_SALT: 'salt', WAITLIST: {get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }}, EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}};
  assert.equal((await call(address, e, 'PUT', {email: 'me@example.com'})).ok, true);
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = '2026-11-01T00:00:00Z'").run();
  sent.length = 0;   // the confirm mail of the setup
  return {e, sent};
}
const card = '<b>3 new matches</b>';
const logged = (e, status) => e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE template = 'message' AND status = ?").get(status).n;
const heldCount = e => e.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_held').get().n;

test('nothing chosen: a named app mail goes as today, and an older app that names none still goes', async () => {
  const {e, sent} = await setup();
  assert.equal((await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'})).ok, true);
  assert.equal((await call(notify, e, 'POST', {subject: 'Matches', html: card})).ok, true);
  assert.equal(sent.length, 2);
});

test('the person turns one mail off in the app: that one is held and logged, the others still go (the owner\'s scenario)', async () => {
  const {e, sent} = await setup();
  assert.deepEqual(await call(choices, e, 'POST', {mail: 'app-matches', on: false}), {status: 200, ok: true});
  assert.deepEqual(await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'}), {status: 200, ok: false, reason: 'person_off'});
  assert.equal(sent.length, 0);
  assert.equal(logged(e, 'person_off'), 1, '"Why mail was not sent" counts it');
  assert.equal((await call(notify, e, 'POST', {subject: 'Waiting', html: card, mail: 'app-needs-you'})).ok, true);
  assert.equal((await call(notify, e, 'POST', {subject: 'Old app', html: card})).ok, true, 'an older app names no mail: today\'s path');
  assert.equal(sent.length, 2);
  await call(choices, e, 'POST', {mail: 'app-matches', on: true});
  assert.equal((await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'})).ok, true, 'turned back on, it goes again');
});

test('a mail that waits for the digest obeys the same choice: an off row is never held', async () => {
  const {e} = await setup();
  await call(choices, e, 'POST', {mail: 'app-weekly', on: false});
  assert.deepEqual(await call(notify, e, 'POST', {subject: 'Week', html: card, kind: 'activity', mail: 'app-weekly'}), {status: 200, ok: false, reason: 'person_off'});
  assert.equal(heldCount(e), 0);
  assert.equal(logged(e, 'person_off'), 1);
  assert.equal((await call(notify, e, 'POST', {subject: 'Applied', html: card, kind: 'activity', mail: 'app-applied'})).held, true);
  assert.equal(heldCount(e), 1);
});

test('only the person decides an app mail: the owner cannot stop it, a stored stop is ignored; a mail id this site does not know keeps today\'s path', async () => {
  // Why (owner, 6 Nov 2026: "If enable or disable from here, and they do the same from their desktop app, what happens? Who has higher precedence?", then "Only the person").
  const {e, sent} = await setup();
  await call(choices, e, 'POST', {mail: 'app-matches', on: true});
  assert.equal(await setRule(e, 'app-matches', false, now), false, 'Admin cannot store a stop for a Yours mail');
  e.STATS.db.prepare("INSERT INTO mail_rule (id, enabled, at) VALUES ('app-matches', 0, 'x'), ('message', 0, 'x')").run();   // a stop stored before this rule
  resetRuleCache();
  assert.equal((await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'})).ok, true, 'the person chose it: it goes');
  assert.equal((await call(notify, e, 'POST', {subject: 'New', html: card, mail: 'app-from-the-future'})).ok, true);
  assert.equal(sent.length, 2);
});

test('the app reads every row with its suggested defaults and the person\'s choice; only a known row and a yes/no are stored', async () => {
  const {e} = await setup();
  await call(choices, e, 'POST', {mail: 'app-stopped', on: false});
  const read = await call(choices, e, 'GET');
  assert.deepEqual(read.rows.map(row => row.id), APP_ROWS);
  assert.deepEqual(read.rows.find(row => row.id === 'app-stopped'), {id: 'app-stopped', name: 'Always on stopped working', when: 'a run on GitHub fails', suggested: {mac: 'hidden', always: 'mail'}, choice: 'off'});
  assert.equal(read.rows.find(row => row.id === 'app-matches').choice, '', 'never chosen');
  for (const body of [{mail: 'message', on: false}, {mail: 'release', on: false}, {mail: 'app-matches', on: 'no'}, {}]) assert.equal((await call(choices, e, 'POST', body)).status, 400, JSON.stringify(body));
  const wrongKey = await choices(new Request('https://x/api', {headers: {'x-api-key': 'JPF1.install-aaaa.nope'}}), e, now);
  assert.equal(wrongKey.status, 401);
});

test('a failed read of the choices sends less, never more; a missing table means nobody chose yet', async () => {
  const broken = {STATS: {prepare: () => ({bind() { return this; }, all: async () => { throw new Error('D1 is down'); }})}};
  assert.equal(await choiceRefusal(broken, 'abc', 'app-matches'), 'choice_held');
  assert.equal(await choiceRefusal(broken, 'abc', 'release'), '', 'not an app row: no choice to read');
  const {e, sent} = await setup(['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0138_mail_rule.sql']);   // no mail_on
  assert.equal((await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'})).ok, true);
  assert.equal(sent.length, 1);
  assert.equal((await call(choices, e, 'GET')).rows.every(row => row.choice === ''), true, 'a missing table holds no choice');
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) SELECT email_hash, 'app-matches', 'app', 'x' FROM pro_accounts").run();
  assert.deepEqual(await call(notify, e, 'POST', {subject: 'Matches', html: card, mail: 'app-matches'}), {status: 200, ok: false, reason: 'person_off'}, 'a stop still holds when mail_on is missing (review of hr-31)');
  const down = {STATS: {prepare: () => ({bind() { return this; }, all: async () => { throw new Error('D1 is down'); }})}};
  assert.equal(await choiceRefusal(down, 'abc', 'app-matches'), 'choice_held');
});

test('an Always on repo\'s key may read the choices, never write them: a leaked copy cannot turn a person\'s "off" back on (review of hr-31)', async () => {
  const {e} = await setup();
  await call(choices, e, 'POST', {mail: 'app-matches', on: false});
  const minted = await (await mintTrialKey(new Request('https://x/api', {headers: {'x-api-key': await keyOf(INSTALL)}}), e, INSTALL)).json();
  const withRepoKey = (method, body) => choices(new Request('https://x/api', {method, headers: {'x-api-key': minted.key}, ...(body && {body: JSON.stringify(body)})}), e, now);
  assert.equal((await withRepoKey('GET')).status, 200);
  assert.equal((await withRepoKey('POST', {mail: 'app-matches', on: true})).status, 403);
  assert.equal((await call(choices, e, 'GET')).rows.find(row => row.id === 'app-matches').choice, 'off');
});
