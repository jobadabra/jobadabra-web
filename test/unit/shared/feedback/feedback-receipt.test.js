// "We got it" and the 24 hour reply clock (PR 1/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra): the receipt the app reads, closing it without hiding the owner's later answer,
// the clock rule the admin chip and the ping share, and the owner's one ping per overdue report. Fakes only: no bot, no mail, no real address.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {feedbackList} from '../../../../shared/feedback.js';
import {RECEIVED, markSeen, repliesFor, replyClock} from '../../../../shared/feedback-reply.js';
import {pingOverdue} from '../../../../shared/feedback-overdue.js';
import {ALERTS, alertOf} from '../../../../shared/notify-registry.js';
import worker from '../../../../workers/www/index.js';
import {add, env, row} from './feedback-kit.js';

const NOW = new Date('2026-11-05T12:00:00.000Z'), hoursAgo = hours => new Date(NOW.getTime() - hours * 3600000).toISOString();
const at = hours => ({at: hoursAgo(hours), day: hoursAgo(hours).slice(0, 10)});

test('a new report shows the receipt at once, with the reporter\'s own first words and the promise', async () => {
  const e = env(), ref = add(e, at(1));
  const [card] = await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW);
  assert.deepEqual([card.ref, card.kind, card.message], [`r:${ref}`, 'received', RECEIVED]);
  assert.match(RECEIVED, /within 24 hours/);
  assert.equal(card.excerpt, 'Setup stops at step 2 (invented)');
});

test('closing the receipt does not hide the owner\'s later answer: they use different columns', async () => {
  const e = env(), ref = add(e, at(5));
  assert.equal(await markSeen(e.STATS, 'install-aaaa-bbbb', `r:${ref}`, NOW), true);
  assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW), []);
  e.STATS.db.prepare("UPDATE feedback SET state = 'fixed', fixed_in = '0.9.13', told = 'app', told_at = ? WHERE ref = ?").run(NOW.toISOString(), ref);
  const [card] = await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW);
  assert.deepEqual([card.ref, card.kind], [ref, 'fixed'], 'the answer shows even though the receipt was closed');
  assert.equal(row(e, ref).seen_at, '', 'closing the receipt left seen_at alone');
});

test('an answered report shows its answer, not a receipt; dismissed, false positive and old reports show none', async () => {
  const e = env(), answered = add(e, {...at(30), state: 'deferred', told: 'app', told_at: NOW.toISOString()});
  add(e, {...at(2), state: 'dismissed'}); add(e, {...at(2), state: 'false_positive'}); add(e, at(24 * 15));
  assert.deepEqual((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).map(card => [card.ref, card.kind]), [[answered, 'deferred']]);
});

test('a receipt belongs to its install: another install sees none, and cannot close it', async () => {
  const e = env(), ref = add(e, at(1));
  assert.deepEqual(await repliesFor(e.STATS, 'install-other', NOW), []);
  assert.equal(await markSeen(e.STATS, 'install-other', `r:${ref}`, NOW), false);
});

test('the clock: due while it runs, overdue after 24 h, done once told in the app or set aside', () => {
  const clock = fields => replyClock({state: 'new', told: '', at: hoursAgo(1), ...fields}, NOW);
  assert.deepEqual(clock({}), {status: 'due', hours: 23});
  assert.deepEqual(clock({at: hoursAgo(24.5)}), {status: 'overdue', hours: 0});
  assert.deepEqual(clock({at: hoursAgo(30)}), {status: 'overdue', hours: 6});
  for (const done of [{told: 'app'}, {told: 'app+mail'}, {told: 'telling'}, {state: 'dismissed'}, {state: 'false_positive'}]) assert.equal(clock({at: hoursAgo(40), ...done}).status, 'done', JSON.stringify(done));
  assert.equal(clock({at: hoursAgo(40), state: 'fixed', told: 'pending'}).status, 'overdue', 'fixed but waiting for a release: the reporter has heard nothing yet');
});

// Why (code review of 1/7, 5 Nov 2026): the owner may answer on purpose with "Do not tell" (tell_mode never, told blank); that report is handled, so no chip, no ping, no receipt.
test('"Do not tell" ends the clock: no overdue chip, no ping, no receipt', async () => {
  const {e, sent, fetcher} = pingEnv(), ref = add(e, {...at(30), state: 'deferred', tell_mode: 'never'});
  assert.equal(replyClock({state: 'deferred', told: '', tell_mode: 'never', at: hoursAgo(30)}, NOW).status, 'done');
  assert.equal(await pingOverdue(e, NOW, fetcher), 0);
  assert.deepEqual(sent, []);
  assert.deepEqual(await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW), [], `no receipt for ${ref}`);
});

test('a report older than 7 days is history: no chip and no ping, the same window in both', async () => {
  const {e, sent, fetcher} = pingEnv();
  add(e, at(24 * 8));
  assert.equal(replyClock({state: 'new', told: '', tell_mode: '', at: hoursAgo(24 * 8)}, NOW).status, 'done');
  assert.equal(replyClock({state: 'new', told: '', tell_mode: '', at: hoursAgo(24 * 6.9)}, NOW).status, 'overdue');
  assert.equal(await pingOverdue(e, NOW, fetcher), 0);
  assert.deepEqual(sent, []);
});

test('marked fixed for a release but not told yet: the reporter keeps the receipt until the answer arrives', async () => {
  const e = env(), ref = add(e, {...at(30), state: 'fixed', told: 'pending', tell_mode: 'release'});
  assert.deepEqual((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).map(card => [card.ref, card.kind]), [[`r:${ref}`, 'received']]);
  e.STATS.db.prepare("UPDATE feedback SET told = 'app', told_at = ? WHERE ref = ?").run(NOW.toISOString(), ref);
  assert.deepEqual((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).map(card => [card.ref, card.kind]), [[ref, 'fixed']], 'told: the answer replaces the receipt');
});

test('five answers waiting leave no room for a receipt; it comes back when they are closed', async () => {
  const e = env(), waiting = add(e, at(2));
  for (let n = 0; n < 5; n++) add(e, {...at(40 + n), state: 'deferred', told: 'app', told_at: NOW.toISOString()});
  assert.equal((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).length, 5);
  assert.ok((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).every(card => card.kind === 'deferred'));
  e.STATS.db.prepare("UPDATE feedback SET seen_at = ? WHERE state = 'deferred'").run(NOW.toISOString());
  assert.deepEqual((await repliesFor(e.STATS, 'install-aaaa-bbbb', NOW)).map(card => card.ref), [`r:${waiting}`]);
});

test('the owner\'s list carries each report\'s clock for the chip', async () => {
  const e = env(), late = add(e, at(30)), fresh = add(e, at(2));
  const byRef = Object.fromEntries((await feedbackList(e.STATS, 30, NOW)).map(item => [item.ref, item.clock.status]));
  assert.deepEqual([byRef[late], byRef[fresh]], ['overdue', 'due']);
});

test('the alert is registered, on, every time, in the users channel, and wired with its sender', () => {
  const alert = alertOf('feedback-overdue');
  assert.deepEqual([alert.on, alert.mode, alert.channel, alert.group, alert.wired, alert.status], [true, 'every', 'users', 'users', true, 'live']);
  assert.equal(ALERTS.filter(item => item.id === 'feedback-overdue').length, 1);
});

// A fake Worker env whose alert goes to the Brain bot: `answer` decides what the bot says (fetcher result).
const pingEnv = (answer = 'ok') => {
  const e = env({BRAIN_BOT_TOKEN: 'bot', BRAIN_CHAT_ID: '1'}), sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body).text); return answer === 'ok' ? Response.json({ok: true, result: {message_id: 1}}) : new Response('{"ok":false,"description":"bad"}', {status: 400}); };
  return {e, sent, fetcher};
};

test('the ping: one line per overdue report with no name, address or words, once per report', async () => {
  const {e, sent, fetcher} = pingEnv(), ref = add(e, at(30));
  add(e, at(2)); add(e, {...at(40), state: 'dismissed'}); add(e, {...at(40), state: 'deferred', told: 'app'});
  assert.equal(await pingOverdue(e, NOW, fetcher), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], new RegExp(`Feedback ${ref} from v0\\.9\\.1 has had no reply for 24 h`));
  assert.doesNotMatch(sent[0], /ana@example|Setup stops/);
  assert.equal(await pingOverdue(e, NOW, fetcher), 0, 'a second tick pings nobody again');
  assert.equal(sent.length, 1);
});

test('a burst after an outage is one summary line, all of them claimed', async () => {
  const {e, sent, fetcher} = pingEnv();
  const refs = [30, 31, 32, 33, 34].map(hours => add(e, at(hours)));
  assert.equal(await pingOverdue(e, NOW, fetcher), 5);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /5 feedbacks have had no reply for 24 h/);
  assert.ok(refs.every(ref => row(e, ref).overdue_told_at !== ''));
});

test('a send that really failed is tried again next tick; nothing configured and a switched-off alert are final', async () => {
  const failing = pingEnv('bad'), ref = add(failing.e, at(30));
  assert.equal(await pingOverdue(failing.e, NOW, failing.fetcher), 1);
  assert.equal(row(failing.e, ref).overdue_told_at, '', 'the flag was given back: the next tick tries again');
  const none = env(), quiet = add(none, at(30));   // no bot, no store: not a failed send
  assert.equal(await pingOverdue(none, NOW, async () => { throw new Error('no call expected'); }), 1);
  assert.notEqual(row(none, quiet).overdue_told_at, '', 'unconfigured keeps the flag, or every tick would redo it');
});

// Why (Gitar on #439, 5 Nov 2026): the ping first sat in the daily block, so a report was warned about up to a day late. The Worker's real triggers are played here: only the 5-minute trigger at minute 10 pings.
test('the Worker pings within the hour: the 5-minute trigger at :10 does, :05 and the daily trigger do not', async () => {
  const {e, sent} = pingEnv(), realFetch = globalThis.fetch, realError = console.error, ref = add(e, at(30));
  globalThis.fetch = async (url, init) => { if (/telegram/.test(String(url))) { sent.push(JSON.parse(init.body).text); return Response.json({ok: true, result: {message_id: 1}}); } return new Response(null, {status: 204}); };
  console.error = () => {};
  const tick = async (cron, minute) => { const tasks = []; await worker.scheduled({cron, scheduledTime: Date.UTC(2026, 10, 5, 12, minute)}, {...e, ASSETS: {fetch: () => new Response('asset')}}, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
  try {
    await tick('*/5 * * * *', 5);
    await tick('30 5 * * *', 30);
    assert.deepEqual(sent, [], 'not at :05, not from the daily trigger');
    await tick('*/5 * * * *', 10);
    assert.equal(sent.length, 1);
    assert.match(sent[0], new RegExp(ref));
  } finally { globalThis.fetch = realFetch; console.error = realError; }
});
