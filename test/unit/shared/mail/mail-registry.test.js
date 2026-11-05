// Who owns each e-mail and the owner's stop per mail (shared/mail-registry.js; spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md): every template has an owner,
// a stop holds that one mail in the real send path, locked mails always go, and a failed read never sends more than the owner chose. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {send} from '../../../../shared/mail.js';
import {MAILS, OWNERS, resetRuleCache, ruleRefusal, ruleRows, setRule, storedRules} from '../../../../shared/mail-registry.js';
import {TEMPLATES} from '../../../../shared/mail-templates.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1(files = ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0138_mail_rule.sql']) {
  resetRuleCache();   // one cache slot per isolate: every test starts with none
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-11-06T10:00:00Z');
const mailer = () => { const sent = []; return {sent, send: async message => { sent.push(message); return {messageId: `m${sent.length}`}; }}; };
const env = (STATS = d1()) => ({STATS, MAIL: 'on', EMAIL: mailer(), STATS_SALT: 'salt', UNSUB_SECRET: 'unsub'});
const broken = message => ({prepare: () => ({bind() { return this; }, all: async () => { throw new Error(message); }, run: async () => { throw new Error(message); }, first: async () => { throw new Error(message); }})});

test('every template has exactly one entry and a known owner; sign-in and confirm are locked', () => {
  assert.deepEqual(MAILS.map(mail => mail.id).sort(), Object.keys(TEMPLATES).sort());
  assert.ok(MAILS.every(mail => OWNERS.some(owner => owner.id === mail.owner) && mail.name && mail.when));
  assert.deepEqual(MAILS.filter(mail => mail.locked).map(mail => mail.id).sort(), ['account-code', 'confirm-resend', 'welcome']);
  for (const id of ['account-code', 'confirm-resend']) assert.equal(TEMPLATES[id].essential, true, `${id}: locked mail is the essential one`);
});

test('nothing pressed: every mail goes as its rules say', async () => {
  const e = env();
  assert.equal(await ruleRefusal(e, 'message'), '');
  assert.equal((await send(e, 'message', 'a@example.com', {text: 'hi', html: 'hi'}, {now})).ok, true);
});

test('a stop holds that one mail in send(), logs rule_off, and leaves the others alone', async () => {
  const e = env();
  assert.equal(await setRule(e, 'feedback-update', false, now), true);
  const held = await send(e, 'feedback-update', 'a@example.com', {}, {now});
  assert.deepEqual(held, {ok: false, reason: 'rule_off'});
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE template = 'feedback-update' AND status = 'rule_off'").get().n, 1);
  assert.equal((await send(e, 'message', 'a@example.com', {text: 'hi', html: 'hi'}, {now})).ok, true);
  assert.equal(await setRule(e, 'feedback-update', true, now), true);
  assert.equal(await ruleRefusal(e, 'feedback-update'), '');
});

test('a locked mail cannot be stopped, and a stored row for it is ignored', async () => {
  const e = env();
  assert.equal(await setRule(e, 'account-code', false, now), false);
  e.STATS.db.prepare("INSERT INTO mail_rule (id, enabled, at) VALUES ('account-code', 0, ?)").run(now.toISOString());
  resetRuleCache();
  assert.equal(await ruleRefusal(e, 'account-code'), '');
  assert.equal(await setRule(e, 'no-such-mail', false, now), false);
});

test('a missing table means nothing was pressed: mail goes', async () => {
  const e = env(d1(['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql']));
  assert.equal(await ruleRefusal(e, 'message'), '');
});

test('any other read error with no good answer holds every unlocked mail, never a locked one, and is not cached', async () => {
  resetRuleCache();
  const e = {STATS: broken('D1 is down')};
  assert.equal(await ruleRefusal(e, 'message'), 'rule_held');
  assert.equal(await ruleRefusal(e, 'welcome'), '');
  assert.equal((await storedRules(e)).held, true);
  const good = env();
  assert.equal(await ruleRefusal(good, 'message'), '', 'the failure was not cached: the next read answers');
});

test('a read error after a good answer keeps the last good answer, stop included', async () => {
  const e = env();
  await setRule(e, 'digest', false, now);
  await storedRules(e, {fresh: true});
  const down = {STATS: broken('D1 is down')};
  assert.equal((await storedRules(down, {fresh: true})).off.digest, true);
  assert.equal((await storedRules(down, {fresh: true})).held, false);
});

test('Admin rows: owner, state, when pressed; locked rows are always on', async () => {
  const e = env();
  await setRule(e, 'release', false, now);
  const rows = await ruleRows(e);
  assert.equal(rows.length, MAILS.length);
  const release = rows.find(row => row.id === 'release');
  assert.deepEqual([release.owner, release.on, release.at], ['jobadabra', false, now.toISOString()]);
  assert.equal(rows.find(row => row.id === 'account-code').on, true);
});
