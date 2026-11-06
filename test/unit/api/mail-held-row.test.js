// A mail waiting for the digest obeys the person's latest choice (api/mail-held.js; spec PR 5). Owner, 6 Nov 2026: "Only the person" decides, and "Keep promise, cut extras" replaced a digest kept on the Mac with this.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, notify} from '../../../api/account-email.js';
import {choices} from '../../../api/mail-choices.js';
import {sendDigests} from '../../../api/mail-held.js';
import {tokenFor} from '../../../shared/guard.js';
import {APP_ROWS, resetRuleCache} from '../../../shared/mail-registry.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
const BASE = ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0138_mail_rule.sql'];
function d1(files) {
  resetRuleCache();
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const one of list) await one.run(); }};
}
const now = new Date('2026-11-06T10:00:00Z'), morning = new Date('2026-11-07T08:00:00Z');
const key = async () => `JPF1.install-aaaa.${await tokenFor('install-aaaa', {STATS_SALT: 'salt'}, 'ai')}`;
const call = async (fn, e, method, body) => fn(new Request('https://x/api', {method, headers: {'x-api-key': await key()}, ...(body && {body: JSON.stringify(body)})}), e, now);
async function person(files = [...BASE, '0139_mail_held_row.sql']) {
  const store = new Map(), sent = [];
  const e = {MAIL: 'on', STATS: d1(files), STATS_SALT: 'salt', UNSUB_SECRET: 'u', WAITLIST: {get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }},
    EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}};
  await call(address, e, 'PUT', {email: 'me@example.com'});
  e.STATS.db.prepare("UPDATE pro_accounts SET email_confirmed_at = 'x', digest_cadence = 'daily'").run();
  sent.length = 0;
  return {e, sent};
}
const wait = (e, words, mail) => call(notify, e, 'POST', {subject: words, html: `<b>${words}</b>`, kind: 'activity', ...(mail && {mail})});
const held = e => e.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_held').get().n;

test('a mail turned off while it waits never goes out; the rest of the digest does, and the refusal is logged', async () => {
  const {e, sent} = await person();
  await wait(e, 'Weekly words', 'app-weekly');
  await wait(e, 'Older app words');
  assert.equal(held(e), 2);
  assert.equal((await (await call(choices, e, 'POST', {mail: 'app-weekly', on: false})).json()).ok, true);
  await sendDigests(e, morning);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('Older app words') && !sent[0].text.includes('Weekly words'));
  assert.equal(held(e), 0);
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'person_off'").get().n, 1);
});

test('the same mail waiting three times reaches the person once; a different one stays', async () => {
  // Owner's inbox, 6 Nov 2026: the Focus reminders of 11:00, 15:00 and 19:00 said the same, and the digest printed the block three times under "3 items".
  const {e, sent} = await person();
  for (let i = 0; i < 3; i++) await wait(e, 'Your focus: 2 waiting for you');
  await sendDigests(e, morning);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Your focus: 2 waiting for you');
  assert.equal(sent[0].text.split('2 waiting for you').length - 1, 2, 'once in the title, once in the body');
  assert.equal(held(e), 0, 'the copies do not wait for tomorrow');
  sent.length = 0;
  await wait(e, 'Your focus: 2 waiting for you');
  await wait(e, 'Your focus: 1 waiting for you');
  await sendDigests(e, morning);
  assert.equal(sent[0].subject, 'Your Jobadabra update: 2 items');
});

test('when every waiting mail was turned off nothing is sent and nothing stays on our server', async () => {
  const {e, sent} = await person();
  await wait(e, 'Weekly words', 'app-weekly');
  await call(choices, e, 'POST', {mail: 'app-weekly', on: false});
  assert.deepEqual(await sendDigests(e, morning), {sent: 0, kept: 0});
  assert.deepEqual([sent.length, held(e)], [0, 0]);
});

test('a mail turned on again before the digest goes out', async () => {
  const {e, sent} = await person();
  await wait(e, 'Weekly words', 'app-weekly');
  await call(choices, e, 'POST', {mail: 'app-weekly', on: false});
  await call(choices, e, 'POST', {mail: 'app-weekly', on: true});
  await sendDigests(e, morning);
  assert.ok(sent[0].text.includes('Weekly words'));
});

test('a choice that cannot be read holds the digest for the next run: it never sends more than the person chose', async () => {
  const {e, sent} = await person();
  await wait(e, 'Weekly words', 'app-weekly');
  const real = e.STATS.prepare;
  e.STATS.prepare = text => { if (/^SELECT list FROM mail_(off|on)/.test(text)) throw new Error('D1 is down'); return real(text); };
  assert.deepEqual(await sendDigests(e, morning), {sent: 0, kept: 1});
  e.STATS.prepare = real;
  assert.deepEqual([sent.length, held(e)], [0, 1]);
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'choice_held'").get().n, 0, 'waiting is not a refused send: "Why mail was not sent" stays true');
  await sendDigests(e, morning);
  assert.equal(sent.length, 1);
});

test('today\'s app loses nothing if the migration did not apply: it names no row, so the old table still takes and sends its mail', async () => {
  const {e, sent} = await person(BASE);
  await wait(e, 'Older app words');
  await sendDigests(e, morning);
  assert.ok(sent[0].text.includes('Older app words'));
});

test('a person with no address yet still reads the rows, so the app can show them; writing waits for the address', async () => {
  const e = {STATS: d1([...BASE, '0139_mail_held_row.sql']), STATS_SALT: 'salt', WAITLIST: {get: async () => null}};
  const read = await (await call(choices, e, 'GET')).json();
  assert.equal(read.ok, true);
  assert.deepEqual(read.rows.map(row => [row.id, row.choice]), APP_ROWS.map(id => [id, '']));
  assert.deepEqual(read.rows.find(row => row.id === 'app-stopped').suggested, {mac: 'hidden', always: 'mail'});
  assert.equal((await (await call(choices, e, 'POST', {mail: 'app-weekly', on: true})).json()).reason, 'no_address');
});

test('an account that cannot be read answers 503, never "nothing chosen": the app would write its defaults over the person\'s off', async () => {
  const {e} = await person();
  await call(choices, e, 'POST', {mail: 'app-matches', on: false});
  const real = e.STATS.prepare;
  e.STATS.prepare = text => { if (/FROM pro_devices/.test(text)) throw new Error('D1 is down'); return real(text); };
  for (const [method, body] of [['GET'], ['POST', {mail: 'app-matches', on: true}]]) {
    const response = await call(choices, e, method, body);
    assert.deepEqual([response.status, (await response.json()).reason], [503, 'not_read'], method);
  }
  e.STATS.prepare = real;
  assert.equal((await (await call(choices, e, 'GET')).json()).rows.find(row => row.id === 'app-matches').choice, 'off');
});
