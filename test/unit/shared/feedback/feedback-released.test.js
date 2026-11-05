// The `released` state (shared/feedback-actions.js, shared/feedback-release.js; spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, the PR after 5/7). Owner, 3 Nov 2026: a fix waits "for release", a release or "Mark as released" moves it to Released and the reporter is told once.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {act} from '../../../../shared/feedback-actions.js';
import {markSeen, repliesFor} from '../../../../shared/feedback-reply.js';
import {tellRelease} from '../../../../shared/feedback-release.js';

const sql = name => readFileSync(new URL(`../../../../db/migrations/${name}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql', '0134_feedback_receipt.sql']) db.exec(sql(name));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args), runNow: () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => list.map(item => ({meta: {changes: item.runNow().changes}}))};   // D1 runs a batch as one transaction: nothing of another call runs between its statements, so `changes()` is the update's
}
const setup = (extra = {}) => { const mails = [], e = {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', STATS_KEY: 'owner-key', STATS_API_KEY: 'owner-key', EMAIL: {send: async message => { mails.push(message); return {messageId: `m${mails.length}`}; }}, ...extra}; return {e, mails}; };
const now = new Date('2026-11-05T10:00:00Z');
let counter = 0;
function add(e, extra = {}) {
  const ref = (++counter).toString(16).padStart(16, '0'), row = {install: 'install-aaaa-bbbb', contact: 'ana@example.com', text: 'Setup stops at Connect LinkedIn and the button does nothing (invented).', ...extra};
  e.STATS.db.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref) VALUES ('2026-10-28T09:00:00Z', '2026-10-28', ?, '0.9.11', 'darwin', ?, ?, ?)").run(row.install, row.text, row.contact, ref);
  return ref;
}
const rowOf = (e, ref) => ({...e.STATS.db.prepare('SELECT state, impact, fixed_in, pr_url, linear_url, tell_mode, tell_message, tell_mail, told, seen_at FROM feedback WHERE ref = ?').get(ref)});
const run = (e, input) => act(e, input, 'owner (session)', now);

const PR = n => `https://github.com/jobadabra/jobadabra/pull/${n}`;
const release = (more = {}) => ({version: '0.9.12', channel: 'beta', prs: [3012, 3020], cutAt: '2026-11-05T09:00:00Z', ...more});
const fixedAt = (e, ref, at) => e.STATS.db.prepare('UPDATE feedback SET state_at = ? WHERE ref = ?').run(at, ref);
const waiting = async (e, input) => { const ref = add(e); await run(e, {ref, action: 'fixed', ...input}); return ref; };

const logOf = (e, ref) => e.STATS.db.prepare('SELECT who, action, detail FROM feedback_log WHERE ref = ? ORDER BY rowid').all(ref).map(line => ({...line}));
const stateOf = (e, ref) => rowOf(e, ref).state;

test('a release moves the waiting card it matched to Released, names the build, tells the reporter once and logs both steps', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  assert.equal(stateOf(e, ref), 'fixed', 'before the release it is Fixed and waiting');
  await tellRelease(e, release(), now);
  assert.deepEqual([stateOf(e, ref), rowOf(e, ref).fixed_in, rowOf(e, ref).told], ['released', '0.9.12 (beta)', 'app+mail']);
  assert.deepEqual(logOf(e, ref).map(line => [line.who, line.action]), [['owner (session)', 'fixed'], ['release 0.9.12 (beta)', 'released'], ['release 0.9.12 (beta)', 'tell']]);
  assert.equal(logOf(e, ref)[1].detail, 'fixed -> released: 0.9.12 (beta)');
  assert.equal(mails.length, 1);
  assert.deepEqual((await repliesFor(e.STATS, 'install-aaaa-bbbb')).map(r => [r.kind, r.fixedIn]), [['fixed', '0.9.12 (beta)']], 'the app still shows a fix, not a new kind');
  assert.equal((await tellRelease(e, release({version: '0.9.14', channel: 'stable'}), now)).told, 0, 'the later stable build finds nothing waiting');
  assert.equal(mails.length, 1);
});

test('a fix the owner already told (a typed version, "tell now") is not touched by a release: it stays Fixed until he marks it released', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), fixed_in: '0.9.12', mail: true});
  assert.equal(rowOf(e, ref).told, 'app+mail');
  await tellRelease(e, release(), now);
  assert.deepEqual([stateOf(e, ref), mails.length], ['fixed', 1]);
});

test('Mark as released on a waiting card tells the reporter once (like a release would) and a later release does not tell again', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  const done = await run(e, {ref, action: 'released', version: 'v0.9.12'});
  assert.deepEqual([done.ok, done.state, done.told], [true, 'released', 'app+mail']);
  assert.deepEqual([rowOf(e, ref).fixed_in, rowOf(e, ref).told, mails.length], ['v0.9.12', 'app+mail', 1]);
  assert.deepEqual(logOf(e, ref).map(line => line.action), ['fixed', 'released', 'tell']);
  assert.equal((await tellRelease(e, release(), now)).told, 0);
  assert.equal((await run(e, {ref, action: 'released', version: '1.0'})).status, 409, 'a second press is refused');
  assert.equal(mails.length, 1);
});

test('Mark as released on a card already told keeps what the reporter was told: no second reply, no second mail, the typed version is stored', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {when: 'now', mail: true});
  assert.deepEqual([rowOf(e, ref).told, rowOf(e, ref).fixed_in], ['app+mail', '']);
  const done = await run(e, {ref, action: 'released', version: '0.9.13'});
  assert.deepEqual([done.ok, done.state, done.told], [true, 'released', undefined]);
  assert.deepEqual([rowOf(e, ref).told, rowOf(e, ref).fixed_in, mails.length], ['app+mail', '0.9.13', 1]);
  assert.deepEqual(logOf(e, ref).map(line => line.action), ['fixed', 'tell', 'released']);
});

test('Mark as released needs a version of letters, digits, dots and dashes; a refusal changes nothing and tells nobody', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  for (const version of [undefined, '', '   ', 'a/b', 'x'.repeat(41), 7, {}]) {
    const done = await run(e, {ref, action: 'released', version});
    assert.equal(done.status, 400, `version ${JSON.stringify(version)}`);
  }
  assert.deepEqual([stateOf(e, ref), rowOf(e, ref).told, mails.length, logOf(e, ref).length], ['fixed', 'pending', 0, 1]);
});

test('only a Fixed card can be marked released; Reopen and Delete work from Released', async () => {
  const {e} = setup(), ref = await waiting(e, {when: 'never'});
  for (const state of ['new', 'dismissed', 'false_positive', 'deferred', 'ai_pr', 'released']) {
    e.STATS.db.prepare('UPDATE feedback SET state = ? WHERE ref = ?').run(state, ref);
    assert.equal((await run(e, {ref, action: 'released', version: '1.0'})).status, 409, state);
  }
  e.STATS.db.prepare("UPDATE feedback SET state = 'fixed' WHERE ref = ?").run(ref);
  await run(e, {ref, action: 'released', version: '1.0'});
  assert.equal((await run(e, {ref, action: 'reopen'})).state, 'new');
  await run(e, {ref, action: 'fixed', when: 'never'}); await run(e, {ref, action: 'released', version: '1.0'});
  assert.equal((await run(e, {ref, action: 'delete'})).ok, true);
});

test('Reopen of a Released card keeps what was told; the reply of a Released card shows in the app and closes like any other', async () => {
  const {e} = setup(), ref = await waiting(e, {pr_url: PR(3012)});
  await tellRelease(e, release(), now);
  assert.equal((await repliesFor(e.STATS, 'install-aaaa-bbbb')).length, 1);
  assert.equal(await markSeen(e.STATS, 'install-aaaa-bbbb', ref, now), true);
  assert.equal((await repliesFor(e.STATS, 'install-aaaa-bbbb')).length, 0);
  await run(e, {ref, action: 'reopen'});
  assert.deepEqual([stateOf(e, ref), rowOf(e, ref).told], ['new', 'app']);
});

test('a card the owner marks released at the same moment a release finds it is told once, by whoever claims it first', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  const [byOwner, byRelease] = await Promise.all([run(e, {ref, action: 'released', version: '0.9.12'}), tellRelease(e, release(), now)]);
  assert.equal(mails.length, 1, `owner: ${JSON.stringify(byOwner)}, release: ${JSON.stringify(byRelease)}`);
  assert.equal(stateOf(e, ref), 'released');
  assert.equal(logOf(e, ref).filter(line => line.action === 'released').length, 1);
});

test('a store error while telling a manual release is written on the card and never mails twice', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  const real = e.STATS.batch; let calls = 0;
  e.STATS.batch = async list => { if (++calls === 2) throw new Error('d1 down'); return real(list); };   // the 1st batch is the state change, the 2nd the tell's write, after the mail went out
  const done = await run(e, {ref, action: 'released', version: '0.9.12'});
  assert.deepEqual([done.ok, done.state], [true, 'released'], 'the change is saved; the tell failing never undoes it');
  assert.match(done.told, /^app, error/);
  assert.match(rowOf(e, ref).told, /^app, error/);
  assert.equal((await tellRelease(e, release(), now)).told, 0);
  assert.equal(mails.length, 1);
});


test('Mark as released does not tell a card whose "tell" choice changed between the read and the write', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true}), real = e.STATS.prepare.bind(e.STATS);
  e.STATS.prepare = text => { if (/^UPDATE feedback SET state = \?, state_at/.test(text)) e.STATS.db.prepare("UPDATE feedback SET told = '', tell_mode = 'never' WHERE ref = ?").run(ref); return real(text); };   // the owner Reopened and re-fixed it with "do not tell" meanwhile
  assert.equal((await run(e, {ref, action: 'released', version: '0.9.12'})).status, 409);
  assert.deepEqual([stateOf(e, ref), rowOf(e, ref).told, mails.length], ['fixed', '', 0]);
});
