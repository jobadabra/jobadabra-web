// Fixed and Acknowledge + defer, and telling the reporter (shared/feedback-reply.js, api/feedback-replies.js): the owner's words, the in-app reply the app reads, the one e-mail through the sender
// we already have, and every refusal written on the card. The mail binding and the KV are fakes; nothing reaches a real address.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {actRoute} from '../../admin/feedback.js';
import {replies} from '../../api/feedback-replies.js';
import {act} from '../../shared/feedback-actions.js';
import {tokenFor} from '../../shared/guard.js';
import {DEFAULT_DEFER, defaultFixed, excerptOf, markSeen, repliesFor, replyText} from '../../shared/feedback-reply.js';

const sql = name => readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8');
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

test('Fixed with a version tells now: the in-app reply and exactly one mail with the owner\'s words, the reporter\'s first 80 characters and the date', async () => {
  const {e, mails} = setup(), ref = add(e);
  const done = await run(e, {ref, action: 'fixed', fixed_in: '0.9.12', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3012', message: 'Thank you for the details: fixed in 0.9.12.', mail: true});
  assert.deepEqual([done.ok, done.state, done.told], [true, 'fixed', 'app+mail']);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'ana@example.com'); assert.equal(mails[0].subject, 'About your feedback');
  assert.match(mails[0].text, /You wrote on 2026-10-28: "Setup stops at Connect LinkedIn and the button does nothing \(invented\)\."/);
  assert.match(mails[0].text, /Thank you for the details: fixed in 0\.9\.12\./);
  assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb'), [{ref, on: '2026-10-28', excerpt: 'Setup stops at Connect LinkedIn and the button does nothing (invented).', kind: 'fixed', fixedIn: '0.9.12', message: 'Thank you for the details: fixed in 0.9.12.'}]);
  assert.deepEqual(await repliesFor(e.STATS, 'install-other-zzzz'), [], 'only that install');
  assert.equal(e.STATS.db.prepare("SELECT detail FROM feedback_log WHERE action = 'tell'").get().detail, 'app+mail');
});

test('Fixed with no version waits for a release: not told yet, no reply, no mail; Reopen ends the wait', async () => {
  const {e, mails} = setup(), ref = add(e);
  const done = await run(e, {ref, action: 'fixed', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3012', mail: true});
  assert.equal(done.told, undefined);
  assert.deepEqual([rowOf(e, ref).tell_mode, rowOf(e, ref).told, rowOf(e, ref).tell_mail], ['release', 'pending', 1]);
  assert.equal(mails.length, 0); assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb'), []);
  await run(e, {ref, action: 'reopen'});
  assert.deepEqual([rowOf(e, ref).state, rowOf(e, ref).told], ['new', '']);
});

test('the reply is the default sentence when the owner wrote none, and "arrives in the next update" when there is no version', () => {
  assert.equal(replyText({state: 'fixed', fixed_in: '0.9.12', tell_message: ''}), defaultFixed('0.9.12'));
  assert.match(defaultFixed(''), /next update/);
  assert.equal(replyText({state: 'deferred', tell_message: '  '}), DEFAULT_DEFER);
  assert.equal(replyText({state: 'deferred', tell_message: 'We will look in January.'}), 'We will look in January.');
  assert.equal(excerptOf('x'.repeat(200)).length, 80); assert.equal(excerptOf('  a\n  b '), 'a b');
});

test('a refused mail, a contact that is not an address and an unticked mail are written on the card; the in-app reply shows in every case', async () => {
  const off = setup({MAIL: 'off'}), refMailOff = add(off.e);
  assert.equal((await run(off.e, {ref: refMailOff, action: 'fixed', fixed_in: '1.0', mail: true})).told, 'app, mail refused: off');
  const handle = setup(), refHandle = add(handle.e, {contact: '@ana_dev'});
  assert.equal((await run(handle.e, {ref: refHandle, action: 'fixed', fixed_in: '1.0', mail: true})).told, 'app, mail refused: not an address');
  const quiet = setup(), refQuiet = add(quiet.e);
  assert.equal((await run(quiet.e, {ref: refQuiet, action: 'fixed', fixed_in: '1.0', mail: false})).told, 'app');
  assert.equal(quiet.mails.length, 0);
  const unsub = setup(), refUnsub = add(unsub.e);
  const {addrOf} = await import('../../shared/mail.js');
  unsub.e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'service', 'unsubscribe', '2026-10-01')").run(await addrOf('ana@example.com'));
  assert.match((await run(unsub.e, {ref: refUnsub, action: 'fixed', fixed_in: '1.0', mail: true})).told, /^app, mail refused: unsubscribed/);
  for (const e of [off.e, handle.e, quiet.e, unsub.e]) assert.equal((await repliesFor(e.STATS, 'install-aaaa-bbbb')).length, 1);
});

test('"Don\'t tell" leaves no reply; Fixed from a deferred or AI-PR card works; a dismissed card cannot be marked fixed', async () => {
  const {e} = setup(), ref = add(e);
  assert.equal((await run(e, {ref, action: 'fixed', fixed_in: '1.0', when: 'never'})).told, undefined);
  assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb'), []);
  const parked = add(e); await run(e, {ref: parked, action: 'defer', tell: false});
  assert.equal((await run(e, {ref: parked, action: 'fixed', fixed_in: '1.0'})).state, 'fixed');
  const aiPr = add(e); e.STATS.db.prepare("UPDATE feedback SET state = 'ai_pr' WHERE ref = ?").run(aiPr);
  assert.equal((await run(e, {ref: aiPr, action: 'fixed', fixed_in: '1.0'})).state, 'fixed');
  const gone = add(e); await run(e, {ref: gone, action: 'dismiss'});
  assert.equal((await run(e, {ref: gone, action: 'fixed', fixed_in: '1.0'})).status, 409);
});

test('bad links and versions are refused before anything changes', async () => {
  const {e, mails} = setup(), ref = add(e);
  for (const bad of [{pr_url: 'http://github.com/a/b/pull/1'}, {pr_url: 'https://evil.example/a/b/pull/1'}, {pr_url: 'https://github.com/a/b/issues/1'}, {fixed_in: '1.0<script>'}]) {
    const done = await run(e, {ref, action: 'fixed', ...bad});
    assert.equal(done.status, 400, JSON.stringify(bad));
  }
  assert.equal((await run(e, {ref, action: 'defer', linear_url: 'https://evil.example/JOB-1'})).status, 400);
  assert.deepEqual([rowOf(e, ref).state, rowOf(e, ref).told], ['new', '']);
  assert.equal(mails.length, 0); assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM feedback_log').get().n, 0);
});

test('Acknowledge + defer: the Linear link is kept as typed, an unrated card takes the impact from the form, a rated one keeps its own, and the reply says deferred', async () => {
  const {e, mails} = setup(), ref = add(e);
  const done = await run(e, {ref, action: 'defer', linear_url: 'https://linear.app/jobadabra/issue/JOB-142', impact: 'low', mail: true});
  assert.deepEqual([done.state, done.impact, done.told], ['deferred', 'low', 'app+mail']);
  assert.deepEqual([rowOf(e, ref).linear_url, rowOf(e, ref).impact], ['https://linear.app/jobadabra/issue/JOB-142', 'low']);
  assert.match(mails[0].text, new RegExp(DEFAULT_DEFER.slice(0, 30)));
  assert.equal((await repliesFor(e.STATS, 'install-aaaa-bbbb'))[0].kind, 'deferred');
  const rated = add(e); e.STATS.db.prepare("UPDATE feedback SET impact = 'high' WHERE ref = ?").run(rated);
  assert.equal((await run(e, {ref: rated, action: 'defer', impact: 'low'})).impact, 'high', 'the owner\'s rating wins');
});

test('the app\'s endpoint: its own key only, unseen replies only, closing one hides it, another install cannot close it, a stuck app is refused', async () => {
  const kv = new Map(), {e} = setup({WAITLIST: {get: async key => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, value); }}}), ref = add(e);
  await run(e, {ref, action: 'defer', mail: false});
  const key = async install => `JPF1.${install}.${await tokenFor(install, e, 'ai')}`;
  const get = async (install, header) => replies(new Request('https://x/api/feedback/replies', {headers: {'x-api-key': header ?? await key(install)}}), e, now);
  const post = async (install, body) => replies(new Request('https://x/api/feedback/replies/seen', {method: 'POST', headers: {'x-api-key': await key(install)}, body: JSON.stringify(body)}), e, now);
  assert.equal((await (await get('install-aaaa-bbbb')).json()).replies.length, 1);
  assert.equal((await (await post('install-zzzz-yyyy', {ref})).json()).ok, false);
  assert.equal((await (await post('install-aaaa-bbbb', {ref})).json()).ok, true);
  assert.deepEqual((await (await get('install-aaaa-bbbb')).json()).replies, []);
  assert.equal(rowOf(e, ref).seen_at, now.toISOString());
  assert.equal((await replies(new Request('https://x/api/feedback/replies', {method: 'DELETE'}), e, now)).status, 405);
  for (let i = 0; i < 60; i++) await get('install-aaaa-bbbb');
  assert.equal((await get('install-aaaa-bbbb')).status, 429);
});

test('knowing an install id is not enough: no key, a wrong token, a key for another install and the old ?install= call are all refused, and give nothing', async () => {
  const {e} = setup(), ref = add(e);
  await run(e, {ref, action: 'defer', mail: false});
  const ask = headers => replies(new Request('https://x/api/feedback/replies?install=install-aaaa-bbbb', {headers}), e, now);
  const mine = await tokenFor('install-aaaa-bbbb', e, 'ai'), other = await tokenFor('install-zzzz-yyyy', e, 'ai');
  for (const headers of [{}, {'x-api-key': 'JPF1.install-aaaa-bbbb.wrong'}, {'x-api-key': `JPF1.install-aaaa-bbbb.${other}`}, {'x-api-key': `JP1.install-aaaa-bbbb.${mine}`}]) {
    const answer = await ask(headers);
    assert.equal(answer.status, 401, JSON.stringify(headers));
    assert.equal(JSON.stringify(await answer.json()).includes('excerpt'), false);
  }
  assert.equal((await ask({'x-api-key': `JPF1.install-aaaa-bbbb.${mine}`})).status, 200);
});

test('through the owner\'s route the Fixed answer carries told; a guest cannot send it', async () => {
  const {e} = setup(), ref = add(e);
  const post = headers => actRoute(new Request('https://x/admin/growth/feedback/act', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify({ref, action: 'fixed', fixed_in: '1.0', mail: true})}), e, now);
  assert.equal((await post({})).status, 404);
  const ok = await (await post({Authorization: 'Bearer owner-key'})).json();
  assert.deepEqual([ok.ok, ok.state, ok.told], [true, 'fixed', 'app+mail']);
});

// Code review of 3/7 (3 Nov 2026): a reply's visibility had three owners (told, seen_at, state); these play the owner's own sequences through all of them.
test('a deferred reply the person closed does not hide the later Fixed reply: a new telling is a new reply', async () => {
  const {e} = setup(), ref = add(e);
  await run(e, {ref, action: 'defer', mail: false});
  assert.equal(await markSeen(e.STATS, 'install-aaaa-bbbb', ref, now), true);
  await run(e, {ref, action: 'fixed', fixed_in: '1.0', mail: false});
  const waiting = await repliesFor(e.STATS, 'install-aaaa-bbbb');
  assert.deepEqual(waiting.map(reply => [reply.kind, reply.fixedIn]), [['fixed', '1.0']]);
});

test('a reply that is withdrawn (Reopen, then Dismiss) is not served with the wrong kind, and cannot be closed as if it were', async () => {
  const {e} = setup(), ref = add(e);
  await run(e, {ref, action: 'fixed', fixed_in: '1.0', mail: false});
  await run(e, {ref, action: 'reopen'});
  await run(e, {ref, action: 'dismiss'});
  assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb'), []);
  assert.equal(await markSeen(e.STATS, 'install-aaaa-bbbb', ref, now), false);
});

test('a version or link longer than its limit is refused, never silently cut to fit', async () => {
  const {e} = setup(), ref = add(e);
  assert.equal((await run(e, {ref, action: 'fixed', fixed_in: '1'.repeat(60)})).status, 400);
  assert.equal((await run(e, {ref, action: 'fixed', pr_url: `https://github.com/a/b/pull/${'1'.repeat(200)}`})).status, 400);
  assert.equal(rowOf(e, ref).state, 'new');
});
