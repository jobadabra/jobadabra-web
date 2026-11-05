// The three mail types (shared/mail-lists.js, owner 5 Nov 2026): who each reaches, the stored answer apart from the default, and the migration that carries the old single box over.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {MAIL_TYPES, NEWS, newsAnswer, newsRefusal, signupKind} from '../../../../shared/mail-lists.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
const facts = ({stops = [], yes = [], confirmed = false, signup = ''} = {}) => ({stops: new Set(stops), yes: new Set(yes), confirmed, signup});

test('the types are service, releases, tips, in the owner\'s order, and Admin prints the same table', () => {
  assert.deepEqual(MAIL_TYPES.map(type => type.id), ['service', ...NEWS]);
  assert.deepEqual(MAIL_TYPES.map(type => type.starts), ['On', 'On', 'Off']);
});

test('who each news type reaches: every case of the agreed rules in one table', () => {
  const cases = [
    // [what we know about the address, releases refusal, tips refusal, Pro launch refusal]
    ['unconfirmed account, no answer', facts(), 'not_confirmed', 'no_tick', 'no_tick'],
    ['confirmed account, no answer (the default)', facts({confirmed: true}), '', 'no_tick', 'no_tick'],
    ['confirmed account that ticked tips', facts({confirmed: true, yes: ['tips']}), '', '', ''],
    ['unconfirmed account that ticked tips: may be a stranger\'s', facts({yes: ['tips']}), 'not_confirmed', 'not_confirmed', 'not_confirmed'],
    ['website waitlist signup', facts({signup: 'news'}), '', 'no_tick', ''],
    ['app waitlist signup: its dialog says "Nothing else"', facts({signup: 'pro'}), 'pro_only', 'no_tick', ''],
    ['confirmed account that stopped releases', facts({confirmed: true, stops: ['releases'], yes: ['tips']}), 'unsubscribed', '', ''],
    ['stopped tips beats the tick and the waitlist', facts({confirmed: true, stops: ['tips'], yes: ['tips'], signup: 'news'}), '', 'unsubscribed', 'unsubscribed'],
    ['a bounce stops everything', facts({confirmed: true, stops: ['all'], yes: ['tips'], signup: 'news'}), 'suppressed', 'suppressed', 'suppressed'],
  ];
  for (const [name, f, releases, tips, launch] of cases) {
    assert.deepEqual([newsRefusal('releases', f), newsRefusal('tips', f), newsRefusal('tips', f, {waitlistToo: true})], [releases, tips, launch], name);
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

test('migration 0134: the old box becomes a yes or a stop for both news types; the old marketing stop covers both; service stays', () => {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql']) db.exec(sql(file));
  const account = db.prepare('INSERT INTO pro_accounts (id, email_hash, email, created_at, plan, marketing_opt_in, marketing_opt_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  account.run('a', 'hash-ticked', 'a@example.com', '2026-10-01', 'trial', 1, '2026-10-05');
  account.run('b', 'hash-none', 'b@example.com', '2026-10-01', 'trial', 0, null);
  db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('hash-stopped', 'marketing', 'unsubscribe', 'x'), ('hash-stopped', 'service', 'unsubscribe', 'x'), ('hash-bounced', 'all', 'bounce', 'x')").run();
  db.exec(sql('0134_mail_on.sql'));
  db.exec(sql('0134_mail_on.sql'));   // twice: a re-run changes nothing
  const rows = text => db.prepare(text).all().map(row => ({...row}));
  assert.deepEqual(rows('SELECT addr, list, via, at FROM mail_on ORDER BY list'), ['releases', 'tips'].map(list => ({addr: 'hash-ticked', list, via: 'tick', at: '2026-10-05'})));
  assert.deepEqual(rows('SELECT addr, list FROM mail_off ORDER BY addr, list'), [{addr: 'hash-bounced', list: 'all'}, {addr: 'hash-stopped', list: 'releases'}, {addr: 'hash-stopped', list: 'service'}, {addr: 'hash-stopped', list: 'tips'}]);
});
