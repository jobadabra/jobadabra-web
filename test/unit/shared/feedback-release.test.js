// A release that includes a fix tells its waiting reporters (shared/feedback-release.js, admin/feedback-release.js; spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 5/7).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {released} from '../../../admin/feedback-release.js';
import {act} from '../../../shared/feedback-actions.js';
import {repliesFor} from '../../../shared/feedback-reply.js';
import {fixedColumns} from '../../../shared/feedback-reply.js';
import {tellRelease} from '../../../shared/feedback-release.js';

const sql = name => readFileSync(new URL(`../../../db/migrations/${name}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql']) db.exec(sql(name));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { const out = []; for (const item of list) out.push({meta: {changes: (await item.run()).changes}}); return out; }};
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

// Spec "Automatic: a release that includes a fix tells its reporters" (owner, 3 Nov 2026: "when we release a new beta/stable version which includes a feedback fix, we should automatically inform all the reporters").
test('a release whose PR list holds the fix\'s PR tells that reporter once: the in-app reply naming the channel and the ticked mail', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  const done = await tellRelease(e, release(), now);
  assert.deepEqual([done.told, done.matched], [1, [{ref, told: 'app+mail'}]]);
  assert.deepEqual([rowOf(e, ref).fixed_in, rowOf(e, ref).told], ['0.9.12 (beta)', 'app+mail']);
  const replies = await repliesFor(e.STATS, 'install-aaaa-bbbb');
  assert.deepEqual(replies.map(r => [r.kind, r.fixedIn]), [['fixed', '0.9.12 (beta)']]);
  assert.equal(mails.length, 1);
  assert.equal(e.STATS.db.prepare("SELECT who FROM feedback_log WHERE ref = ? AND action = 'tell'").get(ref).who, 'release 0.9.12 (beta)');
});

test('the same call again, and the later stable build of the same fix, tell nobody twice', async () => {
  const {e, mails} = setup(), ref = await waiting(e, {pr_url: PR(3012), mail: true});
  await tellRelease(e, release(), now);
  assert.equal((await tellRelease(e, release(), now)).told, 0);
  assert.equal((await tellRelease(e, release({version: '0.9.14', channel: 'stable'}), now)).told, 0);
  assert.equal(mails.length, 1);
  assert.equal(rowOf(e, ref).fixed_in, '0.9.12 (beta)');
});

test('a release without the PR, a "don\'t tell" fix, one already told now and a card that is not fixed tell nobody', async () => {
  const {e, mails} = setup();
  const other = await waiting(e, {pr_url: PR(4000), mail: true});
  const never = await waiting(e, {pr_url: PR(3012), when: 'never'});
  const now_ = await waiting(e, {pr_url: PR(3012), fixed_in: '0.9.11', when: 'now', mail: false});
  const open = add(e); e.STATS.db.prepare("UPDATE feedback SET pr_url = ? WHERE ref = ?").run(PR(3012), open);
  const before = mails.length;
  const done = await tellRelease(e, release(), now);
  assert.deepEqual([done.told, done.waiting, mails.length - before], [0, 1, 0]);
  assert.deepEqual([rowOf(e, other).told, rowOf(e, never).told, rowOf(e, now_).fixed_in, rowOf(e, open).state], ['pending', '', '0.9.11', 'new']);
});

test('no PR link and no version typed: told at the next release if it was marked fixed before the cut, not if after', async () => {
  const {e} = setup(), early = await waiting(e, {}), late = await waiting(e, {});
  fixedAt(e, early, '2026-11-05T08:00:00Z'); fixedAt(e, late, '2026-11-05T09:30:00Z');
  assert.deepEqual((await tellRelease(e, release(), now)).matched.map(m => m.ref), [early]);
  assert.equal(rowOf(e, late).told, 'pending');
  assert.deepEqual((await tellRelease(e, release({version: '0.9.13', cutAt: '2026-11-06T00:00:00Z'}), now)).matched.map(m => m.ref), [late]);
});

test('a PR link that is not in the release is not matched by the loose rule; a typed version equal to the release is', async () => {
  const {e} = setup(), linked = await waiting(e, {pr_url: PR(4000)}), typed = await waiting(e, {fixed_in: '0.9.12', when: 'release'}), other = await waiting(e, {fixed_in: '0.9.99', when: 'release'});
  fixedAt(e, linked, '2026-11-05T08:00:00Z');
  const done = await tellRelease(e, release(), now);
  assert.deepEqual(done.matched.map(m => m.ref), [typed]);
  assert.deepEqual([rowOf(e, linked).told, rowOf(e, other).told], ['pending', 'pending']);
});

test('a mail that is refused is written on the card and the in-app reply still goes; a store error is written on the card and is never mailed twice', async () => {
  const {e, mails} = setup({EMAIL: undefined}); await waiting(e, {pr_url: PR(3012), mail: true});
  assert.match((await tellRelease(e, release(), now)).matched[0].told, /^app, mail refused/);
  assert.equal(mails.length, 0);
  const {e: e2, mails: sent} = setup(), again = await waiting(e2, {pr_url: PR(3012), mail: true});
  const real = e2.STATS.batch; let failed = false;
  let calls = 0; e2.STATS.batch = async list => { if (++calls === 2) { failed = true; throw new Error('d1 down'); } return real(list); };   // the 1st batch is the claim; the mail went out, then the 2nd (the tell's write) failed
  const done = await tellRelease(e2, release(), now);
  assert.deepEqual([done.told, done.failed], [0, [again]]);
  assert.match(rowOf(e2, again).told, /^app, error/, 'visible on the card, not "pending" (that would mail again) and not blank');
  assert.equal((await tellRelease(e2, release(), now)).told, 0);
  assert.equal(sent.length, 1, 'one mail, not two');
  assert.equal((await repliesFor(e2.STATS, 'install-aaaa-bbbb')).length, 1, 'the in-app reply shows');
});

test('the route: only the publish key may call it, POST only, a bad body is refused, and nothing is told on a refusal', async () => {
  const {e} = setup({SELFHEAL_PUBLISH_KEY: 'publish-key'}), ref = await waiting(e, {pr_url: PR(3012)});
  const call = (headers, body, method = 'POST') => released(new Request('https://x/api/feedback/released', {method, headers: {'Content-Type': 'application/json', ...headers}, body: method === 'POST' || method === 'PUT' ? JSON.stringify(body) : undefined}), e, now);
  const key = {Authorization: 'Bearer publish-key'};
  assert.equal((await call({}, release())).status, 401);
  assert.equal((await call({Authorization: 'Bearer wrong'}, release())).status, 401);
  assert.equal((await call(key, release(), 'PUT')).status, 405);
  for (const bad of [{...release(), version: ''}, {...release(), channel: 'nightly'}, {...release(), prs: 'x'}, {...release(), cutAt: 'soon'}, {...release(), version: '1.0<x>'}]) assert.equal((await call(key, bad)).status, 400, JSON.stringify(bad));
  assert.equal(rowOf(e, ref).told, 'pending');
  const ok = await (await call(key, release())).json();
  assert.deepEqual([ok.ok, ok.told], [true, 1]);
  const {e: bare} = setup(); assert.equal((await released(new Request('https://x/api/feedback/released', {method: 'POST', headers: key, body: '{}'}), bare, now)).status, 401, 'no key configured: closed');
});

test('the card has its own words for every told value a release can write (never "told in the app" for an error)', () => {
  const page = readFileSync(new URL('../../../admin/feedback-page.js', import.meta.url), 'utf8');
  for (const needle of ["row.told === 'telling'", '/^app, error/', '/^app, mail refused/', "row.told === 'pending'"]) assert.ok(page.includes(needle), needle);
});

// Code review of 5/7 (3 Nov 2026): the ways a card is matched wrongly, or never.
test('only a pull request of the public repo can be matched by number: another repo\'s PR with a number in the list and a commit link are not told; the form says so', async () => {
  const {e} = setup(), site = await waiting(e, {pr_url: 'https://github.com/jobadabra/jobadabra-web/pull/3012', fixed_in: '1.0', when: 'release'}), commit = await waiting(e, {pr_url: 'https://github.com/jobadabra/jobadabra/commit/abc1234', fixed_in: '1.0', when: 'release'});
  fixedAt(e, site, '2026-11-05T08:00:00Z'); fixedAt(e, commit, '2026-11-05T08:00:00Z');
  assert.equal((await tellRelease(e, release({version: '0.9.12'}), now)).told, 0, 'same number, other repo; a commit: no');
  assert.deepEqual([rowOf(e, site).told, rowOf(e, commit).told], ['pending', 'pending']);
  assert.match(fixedColumns({pr_url: 'https://github.com/jobadabra/jobadabra-web/pull/12', when: 'release'}).error, /release can't find/);
  assert.match(fixedColumns({pr_url: 'https://github.com/jobadabra/jobadabra/commit/abc1234'}).error, /release can't find/);
  assert.equal(fixedColumns({pr_url: 'https://github.com/jobadabra/jobadabra-web/pull/12', fixed_in: '0.9.12'}).error, undefined, 'a typed version is a way to be found');
  assert.equal(fixedColumns({pr_url: 'https://github.com/jobadabra/jobadabra-web/pull/12', when: 'never'}).error, undefined);
});

test('more waiting cards that cannot match than one page do not starve a matching one behind them', async () => {
  const {e} = setup(), ref = await waiting(e, {pr_url: PR(3012)});
  for (let i = 0; i < 230; i++) e.STATS.db.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, state, state_at, pr_url, told, tell_mode) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'x-install-1', '0.9.0', 'darwin', 't', '', ?, 'fixed', '2026-10-01T00:00:00Z', ?, 'pending', 'release')").run(`0${(1000 + i).toString(16).padStart(15, '0')}`, PR(5000 + i));
  e.STATS.db.prepare('UPDATE feedback SET ref = ? WHERE ref = ?').run('ffffffffffffffff', ref);   // the match sorts last
  const done = await tellRelease(e, release(), now);
  assert.deepEqual([done.told, done.waiting], [1, 230]);
});

test('two calls at once tell a reporter once, with one mail', async () => {
  const {e, mails} = setup(); await waiting(e, {pr_url: PR(3012), mail: true});
  const [a, b] = await Promise.all([tellRelease(e, release(), now), tellRelease(e, release({version: '0.9.12', channel: 'stable'}), now)]);
  assert.equal(a.told + b.told, 1);
  assert.equal(mails.length, 1);
});

test('a card changed between the read and the claim (Reopen, then Fixed with another PR) is not told for the old match', async () => {
  const {e} = setup(), ref = await waiting(e, {pr_url: PR(3012)}), real = e.STATS.prepare.bind(e.STATS);
  e.STATS.prepare = text => { if (/^UPDATE feedback SET state = 'released'/.test(text)) e.STATS.db.prepare('UPDATE feedback SET pr_url = ? WHERE ref = ?').run(PR(9999), ref); return real(text); };
  assert.equal((await tellRelease(e, release(), now)).told, 0);
  assert.equal(rowOf(e, ref).told, 'pending');
});

test('Reopen clears a claim that was mid-way, so the reopened card does not say it is telling', async () => {
  const {e} = setup(), ref = await waiting(e, {pr_url: PR(3012)});
  e.STATS.db.prepare("UPDATE feedback SET told = 'telling' WHERE ref = ?").run(ref);
  await run(e, {ref, action: 'reopen'});
  assert.deepEqual([rowOf(e, ref).state, rowOf(e, ref).told], ['new', '']);
});

test('the cut is compared as a time whatever its shape, and a typed "v0.9.12" is the release 0.9.12', async () => {
  const {e} = setup(), after = await waiting(e, {}), typed = await waiting(e, {fixed_in: 'v0.9.12', when: 'release'});
  fixedAt(e, after, '2026-11-05T09:00:00.500Z');   // half a second after the cut: not before it
  const done = await tellRelease(e, release({cutAt: '2026-11-05T09:00:00Z'}), now);
  assert.deepEqual(done.matched.map(m => m.ref), [typed]);
  assert.equal(rowOf(e, after).told, 'pending');
});

test('the route refuses what is not a release: a list over 2000, bad numbers, a cut that is not an ISO time or lies in the future, no store', async () => {
  const {e} = setup({SELFHEAL_PUBLISH_KEY: 'publish-key'}), key = {Authorization: 'Bearer publish-key'};
  const call = (body, env = e) => released(new Request('https://x/api/feedback/released', {method: 'POST', headers: {'Content-Type': 'application/json', ...key}, body: JSON.stringify(body)}), env, now);
  for (const bad of [{...release(), prs: Array.from({length: 2001}, (_, i) => i + 1)}, {...release(), prs: [1.5]}, {...release(), prs: [-1]}, {...release(), prs: [null]}, {...release(), cutAt: '9999'}, {...release(), cutAt: 1760000000000}, {...release(), cutAt: '2027-01-01T00:00:00Z'}]) assert.equal((await call(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal((await call(release(), {...e, STATS: undefined})).status, 503);
  assert.equal((await call({...release(), prs: Array.from({length: 2000}, (_, i) => i + 1)})).status, 200);
});

// Why (owner, 3 Nov 2026, "Were they fixed? Were they released?"; card c1ea31a0): PR #3031 was in 0.9.3 beta and 0.9.4 stable (cut 03:30 UTC), the card was marked fixed at 04:15 UTC, and every later
// release's PR list is "since the previous stable", so the card stayed "fixed / told pending" through 0.9.6. The site cannot see git: it says which PRs its waiting cards name, CI says which of them the tag contains.
test('GET lists the PR numbers the waiting cards name, so the release workflow can check each against the tag (a fix that shipped before its card was marked fixed)', async () => {
  const {e} = setup({SELFHEAL_PUBLISH_KEY: 'publish-key'}), key = {Authorization: 'Bearer publish-key'};
  const early = await waiting(e, {pr_url: PR(3031)});
  await waiting(e, {pr_url: PR(3040)}); await waiting(e, {});   // a second PR and a card with no link
  await waiting(e, {pr_url: PR(3050), when: 'never'});          // told never: not waiting
  const call = (headers = key) => released(new Request('https://x/api/feedback/released', {method: 'GET', headers}), e, now);
  assert.equal((await call({})).status, 401);
  const body = await (await call()).json();
  assert.deepEqual(body, {ok: true, prs: [3031, 3040]});
  // The caller found #3031 inside the tag and sends it with the tag's own list: the old card is told, the others keep waiting.
  const done = await (await released(new Request('https://x/api/feedback/released', {method: 'POST', headers: {'Content-Type': 'application/json', ...key}, body: JSON.stringify(release({version: '0.9.6', channel: 'stable', prs: [3099, 3031]}))}), e, now)).json();
  assert.deepEqual(done.matched.map(m => m.ref), [early]);
  assert.equal(rowOf(e, early).state, 'released');
});
