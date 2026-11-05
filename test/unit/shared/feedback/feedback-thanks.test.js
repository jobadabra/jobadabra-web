// The thank-you of a validated report (PR 2/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra): the Fixed form's tick adds 5 free applications once, in the write that tells the reporter,
// the install's trial answer carries it as `bonus`, and the reply says so. Fakes only: no bot, no mail, no real address.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act} from '../../../../shared/feedback-actions.js';
import {THANKS_APPS, THANKS_LINE, repliesFor, tellOnce} from '../../../../shared/feedback-reply.js';
import {tokenFor} from '../../../../shared/guard.js';
import {stand, status} from '../../../../shared/trial.js';
import {add, env, row} from './feedback-kit.js';

const NOW = new Date('2026-11-05T12:00:00.000Z'), LATER = new Date('2026-11-06T12:00:00.000Z'), INSTALL = 'install-aaaa-bbbb';
const kv = () => { const m = new Map(); return {get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const withTrial = e => { e.STATS.db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)'); return {...e, WAITLIST: kv(), STATS_SALT: 'salt'}; };
const ask = async (e, install = INSTALL) => (await status(new Request('https://x/api/trial/status?applied=3', {headers: {'x-api-key': `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`}}), e, NOW)).json();
const grants = e => e.STATS.db.prepare('SELECT ref, install, apps, at FROM trial_bonus ORDER BY at, ref').all().map(item => ({...item}));
const fix = (e, ref, extra = {}, when = NOW) => act(e, {ref, action: 'fixed', fixed_in: '0.9.13', when: 'now', ...extra}, 'owner', when);

test('Fixed with the tick: the reporter is told, the grant is written in that batch, the reply says it and the trial answer carries 5', async () => {
  const e = withTrial(env()), ref = add(e);
  assert.equal((await fix(e, ref, {thanks: true})).ok, true);
  assert.equal(row(e, ref).thanks_apps, THANKS_APPS);
  assert.deepEqual(grants(e), [{ref, install: INSTALL, apps: 5, at: NOW.toISOString()}]);
  const [card] = await repliesFor(e.STATS, INSTALL, NOW);
  assert.match(card.message, new RegExp(`${THANKS_LINE.replace(/[.]/g, '\\.')}$`));
  const answer = await ask(e);
  assert.deepEqual([answer.bonus, answer.limit, answer.used], [5, 25, 3]);
});

test('without the tick nothing is added and the reply is the owner\'s words alone', async () => {
  const e = withTrial(env()), ref = add(e);
  await fix(e, ref, {thanks: false});
  assert.deepEqual([row(e, ref).thanks_apps, grants(e)], [0, []]);
  assert.doesNotMatch((await repliesFor(e.STATS, INSTALL, NOW))[0].message, /free applications/);
  assert.equal((await ask(e)).bonus, 0);
});

test('a fix that waits for a release grants nothing until the reporter is told', async () => {
  const e = withTrial(env()), ref = add(e);
  await fix(e, ref, {thanks: true, when: 'release', fixed_in: ''});
  assert.deepEqual([row(e, ref).told, grants(e)], ['pending', []]);
  assert.equal((await ask(e)).bonus, 0, 'not told yet: no bonus');
  e.STATS.db.prepare("UPDATE feedback SET told = 'telling' WHERE ref = ?").run(ref);   // a release call claims it
  await tellOnce(e, ref, LATER, 'release');
  assert.deepEqual(grants(e).map(item => item.at), [LATER.toISOString()]);
  assert.equal((await ask(e)).bonus, 5);
});

// Why (owner, 5 Nov 2026: "unlimited" for validated reports, but each report once): Reopen then Fixed again, or telling again, must not pay twice.
test('once per report: Reopen then Fixed again, and a second telling, add nothing', async () => {
  const e = withTrial(env()), ref = add(e);
  await fix(e, ref, {thanks: true});
  await act(e, {ref, action: 'reopen', note: 'check'}, 'owner', NOW);
  await fix(e, ref, {thanks: true}, LATER);
  await tellOnce(e, ref, LATER, 'owner (told)');
  assert.deepEqual(grants(e).map(item => item.at), [NOW.toISOString()], 'the first grant stays the only one');
  assert.equal((await ask(e)).bonus, 5);
});

// Why (own review before the code review, 5 Nov 2026): the Fixed form overwrote thanks_apps on every save, so saving it again without the tick after the grant would take the 5 back.
test('a grant already made stays: Fixed saved again without the tick keeps it', async () => {
  const e = withTrial(env()), ref = add(e);
  await fix(e, ref, {thanks: true});
  await act(e, {ref, action: 'reopen', note: 'check'}, 'owner', NOW);
  await fix(e, ref, {thanks: false}, LATER);
  assert.equal(row(e, ref).thanks_apps, THANKS_APPS);
  assert.equal((await ask(e)).bonus, 5);
});

test('every validated report counts, each for its own install; a deferred or dismissed one never does', async () => {
  const e = withTrial(env()), one = add(e), two = add(e), other = add(e, {install: 'install-zzzz-9999'}), parked = add(e), dismissed = add(e);
  for (const ref of [one, two, other]) await fix(e, ref, {thanks: true});
  e.STATS.db.prepare("UPDATE feedback SET thanks_apps = 5 WHERE ref IN (?, ?)").run(parked, dismissed);   // even a stray value on a card that is not Fixed
  await act(e, {ref: parked, action: 'defer'}, 'owner', NOW);
  await act(e, {ref: dismissed, action: 'dismiss', note: 'spam'}, 'owner', NOW);
  assert.equal((await ask(e)).bonus, 10, 'two reports of this install');
  assert.equal((await ask(e, 'install-zzzz-9999')).bonus, 5);
  assert.equal((await ask(e, 'install-nobody')).bonus, 0);
});

test('the wall moves with the bonus: 20 applications and 60 days end a plain trial, 25 end one with a bonus of 5', () => {
  const old = {first: '2026-08-01T00:00:00Z', now: NOW};
  assert.equal(stand({applied: 20, ...old}).ended, true);
  assert.equal(stand({applied: 20, ...old, bonus: 5}).ended, false);
  const over = stand({applied: 25, ...old, bonus: 5});
  assert.deepEqual([over.ended, over.limit, over.bonus], [true, 25, 5]);
});

// Why (migration safety): CI only warns on a failed migration; a Worker running before 0136 has no trial_bonus table and must still answer the trial (with no bonus), never fail every install's status.
test('before the migration the trial still answers, with no bonus', async () => {
  const e = withTrial(env());
  e.STATS.db.exec('DROP TABLE trial_bonus');
  const answer = await ask(e);
  assert.deepEqual([answer.ok, answer.bonus, answer.limit], [true, 0, 20]);
});

// Why (code review of 2/7, 5 Nov 2026): the first version kept the grant on the feedback row, so deleting a Fixed card took the 5 applications back from a reporter who may already have used them.
test('deleting the card does not take a granted bonus back', async () => {
  const e = withTrial(env()), ref = add(e);
  await fix(e, ref, {thanks: true});
  assert.equal((await act(e, {ref, action: 'delete'}, 'owner', NOW)).ok, true);
  assert.equal(row(e, ref), undefined, 'the card is gone');
  assert.equal((await ask(e)).bonus, 5);
});

// Why (code review of 2/7): if the write that tells fails after the mail left, the reply still shows ("app, error: not confirmed") and says the thank-you; the grant must not be the one thing missing.
test('a failed telling write still grants what the reply says', async () => {
  const e = withTrial(env()), ref = add(e);
  const batch = e.STATS.batch;
  let calls = 0;
  e.STATS.batch = async list => { if (++calls === 2) throw new Error('store down'); return batch(list); };   // the first batch is the Fixed action's own write, the second is the telling
  const result = await fix(e, ref, {thanks: true});
  e.STATS.batch = batch;
  assert.equal(result.told, 'app, error: not confirmed');
  assert.match((await repliesFor(e.STATS, INSTALL, NOW))[0].message, /free applications/);
  assert.equal((await ask(e)).bonus, 5);
});

test('a tick on a fix that is then reopened is not carried to its next fix, unless the grant was already made', async () => {
  const e = withTrial(env()), waiting = add(e), granted = add(e);
  await fix(e, waiting, {thanks: true, when: 'release', fixed_in: ''});
  await act(e, {ref: waiting, action: 'reopen', note: 'not yet'}, 'owner', NOW);
  assert.equal(row(e, waiting).thanks_apps, 0, 'the wish is dropped with the reopened fix');
  await fix(e, granted, {thanks: true});
  await act(e, {ref: granted, action: 'reopen', note: 'check'}, 'owner', NOW);
  assert.equal(row(e, granted).thanks_apps, THANKS_APPS, 'a made grant stays');
});
