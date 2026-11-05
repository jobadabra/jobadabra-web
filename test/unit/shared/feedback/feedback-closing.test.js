// The closing reply for a report the owner sets aside (PR 1b of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra; owner, 5 Nov 2026: "Yes, short and kind"):
// Dismiss and False positive may carry one short reply, in the owner's words or the pre-filled sentence, sent only when the owner chose to, through the same tell path as Fixed and Defer. Fakes only: no bot, no mail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PAGE} from '../../../../admin/feedback-page.js';
import {act} from '../../../../shared/feedback-actions.js';
import {DEFAULT_CLOSE, markSeen, repliesFor, replyClock} from '../../../../shared/feedback-reply.js';
import {add, env, row} from './feedback-kit.js';

const NOW = new Date('2026-11-05T12:00:00.000Z'), INSTALL = 'install-aaaa-bbbb';
const close = (e, ref, input) => act(e, {ref, ...input}, 'owner', NOW);
const answers = async e => (await repliesFor(e.STATS, INSTALL, NOW)).filter(card => card.kind !== 'received');

test('Dismiss with the reply: the reporter is told in the app with the pre-filled sentence, and the 24 h clock clears', async () => {
  const e = env(), ref = add(e, {at: '2026-11-04T09:00:00.000Z'});
  assert.equal((await close(e, ref, {action: 'dismiss', reply: true})).told, 'app');
  const [card] = await answers(e);
  assert.deepEqual([card.ref, card.kind, card.message], [ref, 'deferred', DEFAULT_CLOSE]);
  assert.equal(replyClock({...row(e, ref)}, NOW).status, 'done');
  assert.match(DEFAULT_CLOSE, /^Thanks, we looked into this and it isn't something we'll change\.$/);
});

test('the owner\'s own words replace the sentence, cut at 300; closing the card in the app works like any answer', async () => {
  const e = env(), ref = add(e);
  await close(e, ref, {action: 'dismiss', reply: true, message: `  Thanks for telling us.   ${'x'.repeat(400)}`});
  const [card] = await answers(e);
  assert.equal(card.message.length, 300);
  assert.match(card.message, /^Thanks for telling us\. x/);
  assert.equal(await markSeen(e.STATS, INSTALL, ref, NOW), true);
  assert.deepEqual(await answers(e), []);
});

// Why (owner, 5 Nov 2026: "Nothing goes out to reporters automatically until the owner has seen the wording"): the one-click path stays silent; only reply: true sends.
test('Dismiss without the reply sends nothing and serves nothing, as before', async () => {
  const e = env(), ref = add(e);
  assert.equal((await close(e, ref, {action: 'dismiss'})).told, undefined);
  assert.deepEqual([row(e, ref).state, row(e, ref).told], ['dismissed', '']);
  assert.deepEqual(await answers(e), []);
});

test('False positive: the owner\'s reason stays with the owner; the reporter reads the reply only', async () => {
  const e = env(), ref = add(e);
  assert.equal((await close(e, ref, {action: 'false_positive', reply: true})).status, 400, 'a reason is still required');
  assert.equal((await close(e, ref, {action: 'false_positive', note: 'duplicate of the setup bug, SECRET-REASON', reply: true})).told, 'app');
  const [card] = await answers(e);
  assert.equal(card.message, DEFAULT_CLOSE);
  assert.doesNotMatch(JSON.stringify(card), /SECRET-REASON/);
  assert.match(row(e, ref).state_note, /SECRET-REASON/, 'the reason is kept on the card for the owner');
});

// Why (own test, 5 Nov 2026): an earlier answer that was withdrawn (Fixed, told, Reopen) must not come back as the closing reply when the owner dismisses without one.
test('a card told before, reopened and dismissed without a reply serves nothing; with a reply it serves the new words', async () => {
  const e = env(), ref = add(e);
  await close(e, ref, {action: 'fixed', fixed_in: '1.0', when: 'now'});
  await close(e, ref, {action: 'reopen'});
  await close(e, ref, {action: 'dismiss'});
  assert.deepEqual(await answers(e), []);
  await close(e, ref, {action: 'reopen'});
  await close(e, ref, {action: 'dismiss', reply: true, message: 'Sorry, not this time.'});
  assert.deepEqual((await answers(e)).map(card => [card.kind, card.message]), [['deferred', 'Sorry, not this time.']]);
});

test('only a report the owner set aside can carry it: reply on Fixed or Defer is the Fixed or Defer form, not this one', async () => {
  const e = env(), ref = add(e);
  await close(e, ref, {action: 'defer'});
  assert.equal((await close(e, ref, {action: 'dismiss', reply: true})).status, 409, 'dismiss starts from new only');
  assert.deepEqual((await answers(e)).map(card => card.message), ['Thank you: we saw this and parked it for later. If we pick it up we will tell you.']);
});

test('the admin form shows the same sentence from the one copy, and sends nothing by itself', () => {
  assert.ok(PAGE.includes(JSON.stringify(DEFAULT_CLOSE)), 'the page embeds the shared wording');
  assert.match(PAGE, /Send reply \+ dismiss/);
  assert.match(PAGE, /Dismiss without a reply/);
  assert.match(PAGE, /Mark without a reply/);
  assert.match(PAGE, /withReply \? \{\} : \{undo:/, 'Undo only when nothing was sent');
  assert.match(PAGE, /The reply cannot be taken back/);
});

// Why (code review of 1b, 5 Nov 2026): before this change Dismiss left `told` alone, so a card told (Fixed or Defer), reopened and dismissed has told = 'app' with its telling older than its dismissal.
// Such a row must never be served as a closing reply the owner did not choose; only a telling made after the card was set aside counts.
test('a card told before it was set aside is not served as a closing reply (rows from before this change)', async () => {
  const e = env();
  for (const state of ['dismissed', 'false_positive']) add(e, {state, state_at: '2026-11-04T10:00:00.000Z', told: 'app', told_at: '2026-11-03T10:00:00.000Z', tell_message: 'We will look in January.', seen_at: ''});
  assert.deepEqual(await answers(e), []);
  const fresh = add(e, {state: 'dismissed', state_at: '2026-11-04T10:00:00.000Z', told: 'app', told_at: '2026-11-04T10:00:00.000Z', tell_message: 'Thanks.', seen_at: ''});
  assert.deepEqual((await answers(e)).map(card => card.ref), [fresh], 'told in the same step as the dismissal: served');
});
