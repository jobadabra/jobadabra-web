// The Worker-side helper every migrated sender uses (shared/notify-send.js, nt 2/4): the switchboard first, the sender's OLD bot only when the switchboard cannot deliver, a hold is final.
// Fake Telegram only, never the real one.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {connect, saveSetting, stats} from '../../../shared/notify.js';
import {alertOwner} from '../../../shared/notify-send.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const NOW = new Date('2026-11-05T10:00:00Z'), NEW = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', OLD = {token: '555:OLDBOT', chat: '42'};
// `refuse` = tokens Telegram answers 400 to on sendMessage.
function telegram(refuse = []) {
  const calls = [];
  const fetcher = async (url, init) => {
    const [, token, method] = /bot([^/]+)\/(\w+)$/.exec(url), body = JSON.parse(init.body || '{}');
    calls.push({token, method, body});
    const reply = (ok, result, description) => new Response(JSON.stringify({ok, result, description}), {status: ok ? 200 : 400});
    if (method === 'getMe') return reply(true, {username: 'a_bot'});
    if (method === 'getChat') return reply(true, {title: 'x', id: body.chat_id});
    if (method === 'getUpdates') return reply(true, [{message: {chat: {id: 777}}}]);
    return refuse.includes(token) ? reply(false, null, 'Bad Request: chat not found') : reply(true, {message_id: 9});
  };
  return {calls, fetcher, sends: () => calls.filter(call => call.method === 'sendMessage')};
}
const env = () => ({STATS: d1(), NOTIFY_SECRET: 'vault-secret'});
const tell = (e, tg, extra = {}, event = 'sentry-issue') => alertOwner(e, event, {text: 'Hello', html: true, fetcher: tg.fetcher, now: NOW, ...extra});

test('a connected channel: the switchboard sends it, the old bot is never called', async () => {
  const e = env(), tg = telegram();
  await connect(e, 'engineering', NEW, '', tg.fetcher, NOW);
  const answer = await tell(e, tg, {legacy: OLD});
  assert.deepEqual([answer.sent, answer.via, answer.id], [true, 'switchboard', 9]);
  assert.deepEqual(tg.sends().map(call => [call.token, call.body.chat_id, call.body.parse_mode]), [[NEW, '777', 'HTML']]);
});

test('switched off: held, final, and the old bot is not used behind the owner\'s back', async () => {
  const e = env(), tg = telegram();
  await connect(e, 'engineering', NEW, '', tg.fetcher, NOW);
  await saveSetting(e, 'sentry-issue', {enabled: false}, NOW);
  const answer = await tell(e, tg, {legacy: OLD});
  assert.deepEqual([answer.sent, answer.via, answer.why], [false, 'switchboard', 'off']);
  assert.equal(tg.sends().length, 0);
});

test('channel not connected: the old bot sends it and the switchboard counts one "sent without switchboard"', async () => {
  const e = env(), tg = telegram();
  const answer = await tell(e, tg, {legacy: OLD});
  assert.deepEqual([answer.sent, answer.via], [true, 'fallback']);
  assert.deepEqual(tg.sends().map(call => [call.token, call.body.chat_id, call.body.text]), [[OLD.token, '42', 'Hello']]);
  assert.equal((await stats(e, NOW)).get('sentry-issue')?.fallback, 1, 'Admin shows one "sent without switchboard"');
});

test('no switchboard store and no old bot: nothing delivered, said plainly (the sender keeps the alert)', async () => {
  const tg = telegram();
  const answer = await tell({}, tg);
  assert.deepEqual([answer.sent, answer.via], [false, 'none']);
  assert.equal(tg.sends().length, 0);
});

test('Telegram refuses the switchboard bot: the old bot is tried; the same bot is not tried twice', async () => {
  const e = env(), tg = telegram([NEW]);
  await connect(e, 'engineering', NEW, '', tg.fetcher, NOW);
  assert.deepEqual([(await tell(e, tg, {legacy: OLD})).via, tg.sends().length], ['fallback', 2]);
  const same = telegram(['777:SAME']), e2 = env();
  const answer = await tell(e2, same, {legacy: {token: '777:SAME', chat: '42'}});
  assert.deepEqual([answer.sent, answer.via, same.sends().length], [false, 'fallback', 1], 'no connected channel here: one post, which fails, is reported failed');
});

test('an e-mail address in the text never reaches Telegram', async () => {
  const e = env(), tg = telegram();
  await connect(e, 'engineering', NEW, '', tg.fetcher, NOW);
  await tell(e, tg, {text: 'New sign-up ana@example.com'});
  assert.ok(!tg.sends()[0].body.text.includes('ana@example.com'));
});

// Code review of 2/4 (5 Nov 2026): four ways an alert was lost or mislabelled on the switchboard path.
import {words} from '../../../shared/notify.js';
import {alertOf} from '../../../shared/notify-registry.js';

test('a long HTML alert is cut before Telegram would refuse it: never inside a tag or an entity, the link stays', () => {
  const html = `💬 <b>Feedback</b>\n\n${'a &amp; b '.repeat(500)}<a href="https://www.jobadabra.top/admin/feedback/inbox#x">Full text on /admin</a>`;
  const out = words(html, 'https://www.jobadabra.top/admin/x', true);
  assert.ok(out.length <= 4096, out.length);
  assert.ok(!/<[^>]*$/.test(out.split('\n').slice(0, -1).join('\n')) && !/&[#\w]*$/.test(out.split('\n').slice(0, -1).join('\n')));
  assert.ok(out.endsWith('https://www.jobadabra.top/admin/x'));
});

test('Free AI spend: its day, month and neuron alerts are one event with "every time" (a once-a-day mode would hold the month alert behind the day one)', () => {
  assert.deepEqual([alertOf('free-ai-spend').mode, alertOf('free-ai-spend').modes], ['every', ['every']]);
});

test('Sentry: the switchboard ceiling sits above the sender\'s own 20 an hour, so the one summary line is not held back by it', () => {
  assert.ok(alertOf('sentry-issue').maxPerHour > 20);
});

// The owner's scenario of 8 Nov 2026 ("apply · red on main" came twice, 18:25 and 23:01, while the Engineering channel was not connected): the old bot sent both and the switchboard knew no state, so "changes only" held nothing.
test('a send through the old bot while the channel is down keeps its state: the same state is held when the channel is back, a new one is told', async () => {
  const e = env(), tg = telegram();
  const first = await tell(e, tg, {legacy: OLD, state: 'red:abc:2026-11-05'}, 'main-red');
  assert.deepEqual([first.sent, first.via], [true, 'fallback'], 'positive control: the channel is down, the old bot sent it');
  await connect(e, 'engineering', NEW, '', tg.fetcher, NOW);
  const again = await tell(e, tg, {legacy: OLD, state: 'red:abc:2026-11-05'}, 'main-red');
  assert.deepEqual([again.sent, again.via, again.why], [false, 'switchboard', 'same-state']);
  const other = await tell(e, tg, {legacy: OLD, state: 'red:def:2026-11-05'}, 'main-red');
  assert.deepEqual([other.sent, other.via], [true, 'switchboard']);
  assert.equal((await stats(e)).get('main-red').fallback, 1, 'Admin still counts the one send made without the switchboard');
});
