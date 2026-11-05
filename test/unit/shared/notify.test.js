// The notification switchboard (shared/notify.js, notify-registry.js, notify-vault.js, notify-telegram.js): the registry, the sealed token, the owner's settings, every rule that decides
// whether an alert goes out (off, when, rate, channel), Change bot against a fake Telegram, and that no token or e-mail address leaks.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ALERTS, CHANNELS, GROUPS, MODES, alertOf, alertsForJob, effective} from '../../../shared/notify-registry.js';
import {open, seal} from '../../../shared/notify-vault.js';
import {botOf, channelStatus, connect, notify, readSettings, saveSetting, sendTest, stats, words} from '../../../shared/notify.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', NOW = new Date('2026-11-05T10:00:00Z');
const env = extra => ({STATS: d1(), NOTIFY_SECRET: 'vault-secret', ...extra});
// A fake Telegram: records every call; `chats` = the chats a bot can see; `down` makes sendMessage fail.
function telegram({down = false, updates = [{message: {chat: {id: 777}}}], webhook = false} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const [, token, method] = /bot([^/]+)\/(\w+)$/.exec(url), body = JSON.parse(init.body || '{}');
    calls.push({token, method, body});
    const reply = (ok, result, description) => new Response(JSON.stringify({ok, result, description}), {status: ok ? 200 : 400});
    if (method === 'getMe') return token === TOKEN || token.startsWith('9') ? reply(true, {username: 'jobadabra_ci_bot'}) : reply(false, null, 'Unauthorized');
    if (method === 'getChat') return reply(true, {title: 'Jobadabra CI', id: body.chat_id});
    if (method === 'getUpdates') return webhook ? new Response(JSON.stringify({ok: false, description: 'Conflict: can\'t use getUpdates while webhook is active'}), {status: 409}) : reply(true, updates);
    if (method === 'sendMessage') return down ? reply(false, null, `Bad Request: chat not found (${token})`) : reply(true, {message_id: 1});
    return reply(false, null, 'unknown');
  };
  return {calls, fetcher};
}
const withBot = async (e, channel = 'engineering') => { const tg = telegram(); assert.equal((await connect(e, channel, TOKEN, '', tg.fetcher, NOW)).ok, true); return tg; };

test('the registry: unique ids, a default mode its alert allows, a known group and channel, a workflow file only where it is a .yml', () => {
  assert.equal(new Set(ALERTS.map(alert => alert.id)).size, ALERTS.length);
  const groups = new Set(GROUPS.map(([id]) => id)), channels = new Set(CHANNELS.map(channel => channel.id));
  for (const alert of ALERTS) {
    assert.ok(alert.modes.includes(alert.mode) && alert.modes.every(mode => MODES[mode]), alert.id);
    assert.ok(groups.has(alert.group) && channels.has(alert.channel), alert.id);
    assert.ok(alert.jobs.every(file => /^(jobadabra-web\/)?[\w-]+\.yml$/.test(file)), alert.id);
    assert.ok(!/@/.test(alert.label), 'no address in a label');
  }
  assert.deepEqual(ALERTS.filter(alert => !alert.on).map(alert => alert.id).sort(), ['daily-build-digest', 'record-sites'], 'the owner\'s defaults: the digest and the record-sites/watch list are off, the rest on');
  assert.deepEqual(alertsForJob('e2e.yml').map(alert => alert.id), ['main-red', 'nightly-skipped']);
  assert.deepEqual(alertsForJob('schedules-snapshot.yml'), [], 'a job that sends nothing has no alert');
});

test('effective: the saved row over the defaults; a value the registry no longer allows falls back', () => {
  const alert = alertOf('main-red');
  assert.deepEqual([effective(alert).on, effective(alert).mode, effective(alert).channel], [true, 'changes', 'engineering']);
  assert.equal(effective(alert, {enabled: 0, mode: null, channel: null}).on, false);
  assert.equal(effective(alert, {enabled: null, mode: 'every', channel: 'marketing'}).mode, 'every');
  assert.equal(effective(alert, {mode: 'daily', channel: 'gone'}).mode, 'changes', 'daily is not a mode of main-red');
  assert.equal(effective(alert, {channel: 'gone'}).channel, 'engineering');
});

test('the vault: a sealed token opens only under its own secret, and never contains the token', async () => {
  const sealed = await seal({NOTIFY_SECRET: 'a'}, TOKEN);
  assert.ok(sealed.startsWith('v1.') && !sealed.includes(TOKEN) && !sealed.includes('AAHdq'));
  assert.equal(await open({NOTIFY_SECRET: 'a'}, sealed), TOKEN);
  assert.equal(await open({NOTIFY_SECRET: 'b'}, sealed), null);
  assert.equal(await open({}, sealed), null);
  assert.equal(await open({NOTIFY_SECRET: 'a'}, 'v1.x.y'), null);
  await assert.rejects(seal({}, TOKEN), /no-secret/);
});

test('settings: a change is kept, a value the alert does not allow is refused, an unknown alert too', async () => {
  const e = env();
  assert.equal(await saveSetting(e, 'beta-published', {enabled: false}, NOW), true);
  assert.equal(await saveSetting(e, 'beta-published', {channel: 'marketing'}, NOW), true);
  assert.deepEqual({...(await readSettings(e)).get('beta-published')}, {event: 'beta-published', enabled: 0, mode: null, channel: 'marketing'}, 'the second change kept the first');
  assert.equal(await saveSetting(e, 'beta-published', {mode: 'daily'}, NOW), false, 'beta-published has one mode');
  assert.equal(await saveSetting(e, 'beta-published', {channel: 'nope'}, NOW), false);
  assert.equal(await saveSetting(e, 'not-an-alert', {enabled: true}, NOW), false);
});

test('an event that is not in the registry cannot send; the sender gets a 400', async () => {
  const e = env(), tg = await withBot(e);
  const out = await notify(e, {event: 'made-up', text: 'x'}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([out.status, out.body.why], [400, 'unknown-event']);
  assert.equal(tg.calls.filter(call => call.method === 'sendMessage').length, 0);
});

test('an alert goes to its channel\'s bot with its link; off holds it back; a switched-back-on one sends again', async () => {
  const e = env(), tg = await withBot(e);
  const sent = await notify(e, {event: 'beta-published', text: 'Beta 0.9.1 is out', link: 'https://www.jobadabra.top/admin/agents/build-log'}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([sent.status, sent.body.ok, sent.body.sent, typeof sent.body.id], [200, true, true, 'number']);   // id = Telegram's message id (a sender replies to it)
  const call = tg.calls.find(item => item.method === 'sendMessage');
  assert.deepEqual([call.token, call.body.chat_id, call.body.text], [TOKEN, '777', 'Beta 0.9.1 is out\nhttps://www.jobadabra.top/admin/agents/build-log']);
  await saveSetting(e, 'beta-published', {enabled: false}, NOW);
  assert.deepEqual((await notify(e, {event: 'beta-published', text: 'again'}, {fetcher: tg.fetcher, now: NOW})).body, {ok: true, sent: false, why: 'off'});
  assert.equal(tg.calls.filter(item => item.method === 'sendMessage').length, 1);
  await saveSetting(e, 'beta-published', {enabled: true}, NOW);
  assert.equal((await notify(e, {event: 'beta-published', text: 'back'}, {fetcher: tg.fetcher, now: NOW})).body.sent, true);
});

test('when: "changes only" skips the same state, "only problems" skips an all-clear, "once a day" sends one a day, a rate ceiling holds the rest', async () => {
  const e = env(), tg = await withBot(e), sends = () => tg.calls.filter(item => item.method === 'sendMessage').length;
  const ask = (event, extra, at = NOW) => notify(e, {event, text: 't', ...extra}, {fetcher: tg.fetcher, now: at}).then(out => out.body.why || 'sent');
  assert.deepEqual([await ask('main-red', {state: 'red'}), await ask('main-red', {state: 'red'}), await ask('main-red', {state: 'green'}), await ask('main-red', {state: 'green'})], ['sent', 'same-state', 'sent', 'same-state']);
  await saveSetting(e, 'main-red', {mode: 'every'}, NOW);
  assert.deepEqual([await ask('main-red', {state: 'green'}), await ask('main-red', {state: 'green'})], ['sent', 'sent'], 'every time ignores the state');
  assert.deepEqual([await ask('chrome-store-failed', {level: 'ok'}), await ask('chrome-store-failed', {level: 'problem'}), await ask('chrome-store-failed', {})], ['not-a-problem', 'sent', 'sent']);
  const later = new Date(NOW.getTime() + 86400000);
  assert.deepEqual([await ask('ai-credit', {}), await ask('ai-credit', {}), await ask('ai-credit', {}, later)], ['sent', 'already-today', 'sent']);
  const before = sends();
  const results = []; for (let i = 0; i < 32; i++) results.push(await ask('sentry-issue', {}));
  assert.deepEqual([results.filter(item => item === 'sent').length, results.filter(item => item === 'rate').length, sends() - before], [30, 2, 30], 'Sentry: a ceiling of 30 an hour (the sender keeps its own 20 + one summary)');
});

test('fail-open: a channel without a bot, or Telegram refusing, answers 503 so the sender posts with its old bot; the sender\'s report is only counted', async () => {
  const e = env(), tg = telegram({down: true});
  const none = await notify(e, {event: 'signup-new', text: 'x'}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([none.status, none.body.why], [503, 'channel-not-connected'], 'Marketing has no bot yet');
  await connect(e, 'engineering', TOKEN, '777', telegram().fetcher, NOW);
  const refused = await notify(e, {event: 'beta-published', text: 'x'}, {fetcher: tg.fetcher, now: NOW});
  assert.equal(refused.status, 503);
  assert.ok(refused.body.why.startsWith('telegram:') && !JSON.stringify(refused.body).includes(TOKEN), 'the reason never carries the token');
  const told = await notify(e, {event: 'main-red', text: 'x', fallback: true}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([told.status, told.body.logged], [200, true]);
  const numbers = await stats(e, NOW);
  assert.equal(numbers.get('main-red').fallback, 1);
  assert.equal(numbers.get('beta-published'), undefined, 'a failed send is not a "last sent"');
});

test('Users keeps working on the Brain bot\'s own secrets until the owner changes it; Change bot then takes over', async () => {
  const e = env({BRAIN_BOT_TOKEN: '555555:BRAINBRAINBRAINBRAINBRAIN', BRAIN_CHAT_ID: '42'}), tg = telegram();
  assert.deepEqual([(await botOf(e, 'users')).source, await botOf(e, 'engineering')], ['secret', null]);
  assert.equal((await notify(e, {event: 'feedback-received', text: 'New feedback'}, {fetcher: tg.fetcher, now: NOW})).body.sent, true);
  assert.equal(tg.calls.at(-1).token, '555555:BRAINBRAINBRAINBRAINBRAIN');
  assert.equal((await connect(e, 'users', TOKEN, '', tg.fetcher, NOW)).ok, true);
  assert.equal((await botOf(e, 'users')).source, 'admin');
  await notify(e, {event: 'form-reported', text: 'x'}, {fetcher: tg.fetcher, now: NOW});
  assert.equal(tg.calls.at(-1).token, TOKEN);
});

test('Change bot: checks the token with Telegram, finds the chat, keeps the token sealed and shows the bot and chat read live', async () => {
  const e = env(), tg = telegram();
  assert.match((await connect(e, 'engineering', 'nope', '', tg.fetcher, NOW)).why, /not a bot token/);
  assert.match((await connect({...e, NOTIFY_SECRET: ''}, 'engineering', TOKEN, '', tg.fetcher, NOW)).why, /NOTIFY_SECRET/);
  assert.match((await connect(e, 'engineering', '8888888:ZZZZZZZZZZZZZZZZZZZZZZZZZ', '', tg.fetcher, NOW)).why, /did not accept/);
  assert.match((await connect(e, 'engineering', TOKEN, '', telegram({updates: []}).fetcher, NOW)).why, /send it any message/);
  assert.match((await connect(e, 'engineering', TOKEN, '', telegram({webhook: true}).fetcher, NOW)).why, /webhook.*chat id/);
  assert.deepEqual(await connect(e, 'engineering', TOKEN, '', tg.fetcher, NOW), {ok: true, name: '@jobadabra_ci_bot', title: 'Jobadabra CI'});
  const row = e.STATS.db.prepare('SELECT * FROM notify_channels').get();
  assert.ok(!JSON.stringify(row).includes('AAHdq') && row.chat_id === '777');
  assert.deepEqual({...await channelStatus(e, 'engineering', tg.fetcher)}, {connected: true, source: 'admin', live: true, name: '@jobadabra_ci_bot', title: 'Jobadabra CI', why: ''});
  const down = await channelStatus(e, 'engineering', async () => { throw new Error(`network down ${TOKEN}`); });
  assert.deepEqual([down.connected, down.live, down.name], [true, false, '@jobadabra_ci_bot'], 'Telegram not answering falls back to what was kept');
  assert.ok(!down.why.includes(TOKEN));
  assert.deepEqual(await channelStatus(e, 'marketing', tg.fetcher), {connected: false});
});

test('Send test reaches the chat and is not an alert\'s last sent', async () => {
  const e = env(), tg = await withBot(e);
  assert.equal((await sendTest(e, 'engineering', tg.fetcher, NOW)).ok, true);
  assert.match(tg.calls.at(-1).body.text, /Test from Admin/);
  assert.equal((await sendTest(e, 'marketing', tg.fetcher, NOW)).ok, false);
  assert.equal([...(await stats(e, NOW)).keys()].filter(key => alertOf(key)).length, 0);
});

test('the text never carries an e-mail address, is cut to Telegram\'s size, and a link must be https', () => {
  assert.equal(words('Feedback from ada@example.com about login', ''), 'Feedback from [e-mail] about login');
  assert.equal(words('x'.repeat(5000), '').length, 3500);
  assert.equal(words('hi', 'https://www.jobadabra.top/admin/x'), 'hi\nhttps://www.jobadabra.top/admin/x');
  assert.equal(words('hi', 'javascript:alert(1)'), 'hi');
});

test('last sent and the 7-day count come from the same log; older rows fall out of the week', async () => {
  const e = env(), tg = await withBot(e), day = 86400000;
  await notify(e, {event: 'beta-published', text: 'a'}, {fetcher: tg.fetcher, now: new Date(NOW.getTime() - 9 * day)});
  await notify(e, {event: 'beta-published', text: 'b'}, {fetcher: tg.fetcher, now: new Date(NOW.getTime() - 2 * day)});
  await notify(e, {event: 'beta-published', text: 'c'}, {fetcher: tg.fetcher, now: NOW});
  const row = (await stats(e, NOW)).get('beta-published');
  assert.deepEqual([row.week, row.last], [2, NOW.toISOString()]);
});

test('a delivered alert answers 200 even when its log row cannot be written (else the sender would post it a second time)', async () => {
  const e = env(), tg = await withBot(e);
  e.STATS.db.exec('DROP TABLE notify_log');
  const out = await notify(e, {event: 'beta-published', text: 'x'}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([out.status, out.body.sent], [200, true]);
});

test('a setting change touches only its own column, whatever the order or overlap of changes', async () => {
  const e = env();
  await Promise.all([saveSetting(e, 'main-red', {enabled: false}, NOW), saveSetting(e, 'main-red', {mode: 'every'}, NOW), saveSetting(e, 'main-red', {channel: 'users'}, NOW)]);
  assert.deepEqual({...(await readSettings(e)).get('main-red')}, {event: 'main-red', enabled: 0, mode: 'every', channel: 'users'});
});

test('a link carries no e-mail address either, and a job\'s switch belongs to its own repo', () => {
  assert.equal(words('x', 'https://www.jobadabra.top/admin/x?email=ada@example.com'), 'x\nhttps://www.jobadabra.top/admin/x');
  assert.deepEqual(alertsForJob('e2e.yml', 'jobadabra').map(alert => alert.id), ['main-red', 'nightly-skipped']);
  assert.deepEqual(alertsForJob('e2e.yml', 'jobadabra-web'), [], 'the same file name in another repo is another job');
  assert.deepEqual(alertsForJob('daily-digest.yml', 'jobadabra-web').map(alert => alert.id), ['daily-build-digest']);
});

test('release-failed: a registered, switched-on Engineering alert that sends every time and sits on the desktop and promote workflows (owner, 5 Nov 2026: "I didn\'t get any notification. I should have")', async () => {
  const alert = alertOf('release-failed');
  assert.deepEqual([alert.on, alert.mode, alert.channel, alert.group], [true, 'every', 'engineering', 'releases']);
  assert.ok(alertsForJob('desktop.yml').some(item => item.id === 'release-failed') && alertsForJob('canary-promote.yml').some(item => item.id === 'release-failed'));
  const e = env(), tg = await withBot(e);
  const sent = await notify(e, {event: 'release-failed', text: '🔴 Beta 0.9.12 did not ship', html: true}, {fetcher: tg.fetcher, now: NOW});
  assert.deepEqual([sent.status, sent.body.sent], [200, true]);
  assert.equal((await notify(e, {event: 'release-failed', text: 'again', html: true}, {fetcher: tg.fetcher, now: NOW})).body.sent, true, 'every failure, not once a day');
});
