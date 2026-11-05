// The three mail types (shared/mail-lists.js, owner 5 Nov 2026): who each reaches, the stored answer apart from the default, and the migration that carries the old single box over.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {MAIL_TYPES, NEWS, newsAnswer, newsFacts, newsRefusal, signupKind} from '../../../../shared/mail-lists.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
const facts = ({stops = [], yes = [], confirmed = false, signup = '', answered = false} = {}) => ({stops: new Set(stops), yes: new Set(yes), confirmed, signup, answered});

test('the types are service, job digest, releases, tips, in the owner\'s order, and Admin prints the same table', () => {
  assert.deepEqual(MAIL_TYPES.map(type => type.id), ['service', 'jobdigest', ...NEWS]);
  assert.deepEqual(MAIL_TYPES.map(type => type.starts), ['On', 'Off', 'On', 'Off']);
});

test('who each type reaches: every case of the agreed rules in one table', () => {
  const cases = [
    // [what we know about the address, releases refusal, tips refusal, Pro launch refusal, job digest refusal]
    ['unconfirmed account, no answer', facts(), 'not_confirmed', 'no_tick', 'no_tick', 'no_tick'],
    ['confirmed account that has not answered the card (the default shown ticked)', facts({confirmed: true}), 'not_asked', 'no_tick', 'no_tick', 'no_tick'],
    ['confirmed account that saved the card with releases ticked', facts({confirmed: true, yes: ['releases'], answered: true}), '', 'no_tick', 'no_tick', 'no_tick'],
    ['confirmed account that ticked tips: that is an answer about news', facts({confirmed: true, yes: ['tips'], answered: true}), '', '', '', 'no_tick'],
    ['confirmed account that ticked the job digest only: not an answer about news', facts({confirmed: true, yes: ['jobdigest']}), 'not_asked', 'no_tick', 'no_tick', ''],
    ['unconfirmed account that ticked tips and the digest: may be a stranger\'s', facts({yes: ['tips', 'jobdigest'], answered: true}), 'not_confirmed', 'not_confirmed', 'not_confirmed', 'not_confirmed'],
    ['website waitlist signup under the new wording: an answer by itself', facts({signup: 'news'}), '', 'no_tick', '', 'no_tick'],
    ['app waitlist signup: its dialog says "Nothing else"', facts({signup: 'pro'}), 'pro_only', 'no_tick', '', 'no_tick'],
    ['confirmed account that stopped releases', facts({confirmed: true, stops: ['releases'], yes: ['tips'], answered: true}), 'unsubscribed', '', '', 'no_tick'],
    ['stopped tips beats the tick and the waitlist', facts({confirmed: true, stops: ['tips'], yes: ['tips'], signup: 'news', answered: true}), '', 'unsubscribed', 'unsubscribed', 'no_tick'],
    ['stopped job digest', facts({confirmed: true, stops: ['jobdigest'], yes: ['tips'], answered: true}), '', '', '', 'unsubscribed'],
    ['a bounce stops everything', facts({confirmed: true, stops: ['all'], yes: ['tips', 'jobdigest'], signup: 'news', answered: true}), 'suppressed', 'suppressed', 'suppressed', 'suppressed'],
  ];
  for (const [name, f, releases, tips, launch, digest] of cases) {
    assert.deepEqual([newsRefusal('releases', f), newsRefusal('tips', f), newsRefusal('tips', f, {waitlistToo: true}), newsRefusal('jobdigest', f)], [releases, tips, launch, digest], name);
  }
});

test('a box shows the stored answer or the type\'s default, and nothing else', () => {
  assert.deepEqual(['releases', 'tips'].map(list => newsAnswer(list, facts())), [false, false], 'unconfirmed: the sender sends nothing');
  assert.deepEqual(['releases', 'tips'].map(list => newsAnswer(list, facts({confirmed: true}))), [true, false], 'the defaults');
  assert.deepEqual(['releases', 'tips'].map(list => newsAnswer(list, facts({confirmed: true, stops: ['releases'], yes: ['tips']}))), [false, true], 'the stored answers');
  assert.equal(newsAnswer('tips', facts({confirmed: true, signup: 'news'})), false, 'the waitlist is not a tips tick');
});

test('signupKind: the website form and the app once its dialog names release mails count for releases; any other source, or an unknown one, for the Pro mail only', () => {
  assert.deepEqual(['web', 'app-news', 'app', 'unknown', ''].map(signupKind), ['news', 'news', 'pro', 'pro', '']);
});

test('migration 0135: the old box becomes a yes or a stop for both news types; the old marketing stop covers both; service stays', () => {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql']) db.exec(sql(file));
  const account = db.prepare('INSERT INTO pro_accounts (id, email_hash, email, created_at, plan, marketing_opt_in, marketing_opt_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  account.run('a', 'hash-ticked', 'a@example.com', '2026-10-01', 'trial', 1, '2026-10-05');
  account.run('b', 'hash-none', 'b@example.com', '2026-10-01', 'trial', 0, null);
  db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('hash-stopped', 'marketing', 'unsubscribe', 'x'), ('hash-stopped', 'service', 'unsubscribe', 'x'), ('hash-bounced', 'all', 'bounce', 'x')").run();
  db.exec(sql('0135_mail_on.sql'));
  db.exec(sql('0135_mail_on.sql'));   // twice: a re-run changes nothing
  const rows = text => db.prepare(text).all().map(row => ({...row}));
  assert.deepEqual(rows('SELECT addr, list, via, at FROM mail_on ORDER BY list'), ['releases', 'tips'].map(list => ({addr: 'hash-ticked', list, via: 'tick', at: '2026-10-05'})));
  assert.deepEqual(rows('SELECT addr, list FROM mail_off ORDER BY addr, list'), [{addr: 'hash-bounced', list: 'all'}, {addr: 'hash-stopped', list: 'releases'}, {addr: 'hash-stopped', list: 'service'}, {addr: 'hash-stopped', list: 'tips'}]);
});

test('a stop made under the old single list still holds for both news types when migration 0135 has not run (CI only warns on a failed migration)', async () => {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql']) db.exec(sql(file));   // no mail_on table
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  const env = {STATS: {prepare: text => statement(text)}, MARKETING_MAIL: 'on'};
  db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('stopped', 'marketing', 'unsubscribe', 'x')").run();
  const {mailAllowed} = await import('../../../../shared/mail.js');
  assert.equal((await newsFacts(env, 'stopped', null)).stops.size, 2);
  assert.equal((await newsFacts(env, 'nobody', null)).yes.size, 0, 'a missing mail_on only sends less');
  assert.equal((await mailAllowed({...env, STATS_SALT: 's'}, 'a@example.com', 'releases')).ok, false, 'confirm the sender reads the same way: no account, so not confirmed');
});
