// Feedback with a screenshot and logs (api/feedback.js, shared/feedback.js, admin/feedback.js): caps, the R2 keys, the Telegram verdicts written on the row (a refusal is no longer invisible),
// the owner-only file route, the counter of undelivered messages and the 90-day purge. Telegram is a fake fetcher; nothing here reaches the real bot or Worker.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {feedback, FILES_PER_DAY, MAX_LOGS_BYTES, MAX_SHOT_BYTES} from '../../api/feedback.js';
import {file, view} from '../../admin/feedback.js';
import {purgeFiles, undelivered, TEXT_FILES} from '../../shared/feedback.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql']) db.exec(readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const bucket = () => {
  const kept = new Map();
  return {kept, put: async (key, value, options) => { kept.set(key, {value, uploaded: options?.uploaded || new Date(), ...options}); },
    get: async key => { const o = kept.get(key); return o ? {body: o.value} : null; },
    delete: async keys => { for (const key of [].concat(keys)) kept.delete(key); },
    list: async () => ({objects: [...kept].map(([key, o]) => ({key, uploaded: o.uploaded})), truncated: false})};
};
const env = (extra = {}) => ({STATS: d1(), FEEDBACK_FILES: bucket(), BRAIN_BOT_TOKEN: 'SECRET-TOKEN', BRAIN_CHAT_ID: '42', STATS_KEY: 'owner', ...extra});
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
const good = {install: 'install-aaaa-bbbb', version: '0.5.70', platform: 'win32', text: 'Setup stops at step 2', screen: 'Settings', screenshot: PNG, logs: 'line 1\nline 2'};
const telegramOk = calls => async (url, init) => { calls.push({method: url.split('/').pop(), body: init.body}); return Response.json({ok: true, result: {message_id: 7}}); };
const send = (e, body, fetcher, now) => feedback(new Request('https://x/api/feedback', {method: 'POST', body: JSON.stringify(body)}), e, fetcher, now);
const row = e => e.STATS.db.prepare('SELECT * FROM feedback ORDER BY rowid DESC').get();

test('a screenshot and logs are kept in R2 under the row\'s ref, and the owner gets the words, then the photo, with the logs link', async () => {
  const e = env(), calls = [];
  const answer = await (await send(e, good, telegramOk(calls))).json();
  assert.deepEqual(answer, {ok: true});
  const saved = row(e);
  assert.match(saved.ref, /^[0-9a-f]{16}$/);
  assert.equal(saved.shot, 'png'); assert.equal(saved.logs, 1); assert.equal(saved.screen, 'Settings'); assert.equal(saved.notified, 'sent');
  assert.deepEqual([...e.FEEDBACK_FILES.kept.keys()].sort(), [`feedback/${saved.ref}/logs.txt`, `feedback/${saved.ref}/screen.png`]);
  assert.deepEqual(calls.map(c => c.method), ['sendMessage', 'sendPhoto']);
  const text = JSON.parse(calls[0].body).text;
  assert.match(text, /Setup stops at step 2/); assert.match(text, /win32/); assert.match(text, /Settings/);
  assert.match(text, new RegExp(`admin/growth/feedback#${saved.ref}`));
  assert.ok(calls[1].body instanceof FormData);
  assert.equal(calls[1].body.get('reply_to_message_id'), '7');
  assert.ok(calls[1].body.get('photo') instanceof Blob);
});

test('over the caps or not an image: the words are kept, the part is skipped and said', async () => {
  const e = env();
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_SHOT_BYTES + 100) * 4 / 3));
  const answer = await (await send(e, {...good, screenshot: big, logs: 'x'.repeat(MAX_LOGS_BYTES + 1)}, telegramOk([]))).json();
  assert.deepEqual(answer.skipped.sort(), ['logs', 'screenshot']);
  assert.equal(e.FEEDBACK_FILES.kept.size, 0);
  assert.equal(row(e).text, good.text);
  assert.equal((await (await send(e, {...good, screenshot: 'data:text/html;base64,PGI+'}, telegramOk([]))).json()).skipped[0], 'screenshot');
});

test('no bucket: the words still go through, the files are reported skipped', async () => {
  const e = env({FEEDBACK_FILES: undefined});
  const answer = await (await send(e, good, telegramOk([]))).json();
  assert.equal(answer.ok, true); assert.deepEqual(answer.skipped.sort(), ['logs', 'screenshot']);
});

test('a refusal by Telegram is written on the row and counted; the token never lands there', async () => {
  const e = env();
  const refuse = async () => Response.json({ok: false, description: 'Bad Request: chat not found'}, {status: 400});
  assert.equal((await send(e, good, refuse)).status, 200);   // the person is not told about our bot
  assert.match(row(e).notified, /^failed: 400 Bad Request: chat not found/);
  const boom = async url => { throw new Error(`fetch failed ${url}`); };
  await send(e, good, boom);
  assert.match(row(e).notified, /^failed: network/);
  assert.ok(!row(e).notified.includes('SECRET-TOKEN'));
  assert.equal(await undelivered(e.STATS), 2);
});

test('the photo failing after the words went is a failure too, and no bot secrets is "off" (counted)', async () => {
  const e = env();
  const photoRefused = async url => url.endsWith('sendPhoto') ? Response.json({ok: false, description: 'wrong file'}, {status: 400}) : Response.json({ok: true, result: {message_id: 1}});
  await send(e, good, photoRefused);
  assert.match(row(e).notified, /^failed: photo 400 wrong file/);
  const none = env({BRAIN_BOT_TOKEN: undefined});
  await send(none, good, telegramOk([]));
  assert.equal(row(none).notified, 'off');
  assert.equal(await undelivered(none.STATS), 1);
});

test('without files the message is the words only (no photo call)', async () => {
  const e = env(), calls = [];
  await send(e, {...good, screenshot: undefined, logs: undefined}, telegramOk(calls));
  assert.deepEqual(calls.map(c => c.method), ['sendMessage']);
  assert.ok(!JSON.parse(calls[0].body).text.includes('/admin/'));
});

test('the file route is the owner\'s only; a bad ref, a missing kind or an expired file is a 404', async () => {
  const e = env();
  await send(e, good, telegramOk([]));
  const {ref} = row(e);
  const open = (query, auth = 'owner') => file(new Request(`https://x/admin/growth/feedback/file${query}`, {headers: auth ? {Authorization: `Bearer ${auth}`} : {}}), e);
  assert.equal((await open(`?ref=${ref}&kind=screen`, null)).status, 404);
  assert.equal((await open(`?ref=${ref}&kind=screen`, 'wrong')).status, 404);
  const shot = await open(`?ref=${ref}&kind=screen`);
  assert.equal(shot.status, 200); assert.equal(shot.headers.get('Content-Type'), 'image/png'); assert.equal(shot.headers.get('Cache-Control'), 'no-store');
  assert.equal((await open(`?ref=${ref}&kind=logs`)).headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal((await open(`?ref=../../x&kind=logs`)).status, 404);
  assert.equal((await open(`?ref=${ref}&kind=other`)).status, 404);
  e.FEEDBACK_FILES.kept.clear();
  assert.equal((await open(`?ref=${ref}&kind=logs`)).status, 404);
});

test('the list carries what /admin shows: ref, flags, the delivery verdict and the counter', async () => {
  const e = env();
  await send(e, good, async () => Response.json({ok: false, description: 'nope'}, {status: 403}));
  const data = await (await view(new Request('https://x/feedback?json=1', {headers: {Authorization: 'Bearer owner'}}), e)).json();
  assert.equal(data.undelivered, 1);
  assert.deepEqual([data.rows[0].shot, data.rows[0].logs, data.rows[0].screen], ['png', 1, 'Settings']);
  assert.match(data.rows[0].notified, /^failed: 403 nope/);
});

test('90 days on, the files leave R2 and the row stops pointing at them', async () => {
  const e = env(), now = new Date('2026-11-02T10:00:00Z');
  await send(e, good, telegramOk([]), new Date('2026-07-01T10:00:00Z'));
  const old = row(e).ref;
  for (const [key, o] of e.FEEDBACK_FILES.kept) o.uploaded = new Date('2026-07-01T10:00:00Z');
  await send(e, {...good, install: 'install-cccc-dddd'}, telegramOk([]), new Date('2026-10-30T10:00:00Z'));
  const fresh = row(e).ref;
  assert.equal(await purgeFiles(e, now), 2);
  assert.deepEqual([...e.FEEDBACK_FILES.kept.keys()].every(key => key.includes(fresh)), true);
  assert.deepEqual({...e.STATS.db.prepare('SELECT shot, logs FROM feedback WHERE ref = ?').get(old)}, {shot: '', logs: 0});
  assert.equal(e.STATS.db.prepare('SELECT shot FROM feedback WHERE ref = ?').get(fresh).shot, 'png');
});

test('past the day\'s cap of feedbacks with files, the words still go and the files (and the photo) stop', async () => {
  const e = env(), calls = [];
  for (let i = 0; i < FILES_PER_DAY; i++) e.STATS.db.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, shot, logs) VALUES ('2026-11-02T08:00:00Z', ?, ?, '1', 'x', 't', '', 'png', 1)").run('2026-11-02', `install-${i}-padding`);
  const answer = await (await send(e, {...good, install: 'install-new-zzzz'}, telegramOk(calls), new Date('2026-11-02T10:00:00Z'))).json();
  assert.deepEqual(answer.skipped.sort(), ['logs', 'screenshot']);
  assert.equal(e.FEEDBACK_FILES.kept.size, 0);
  assert.deepEqual(calls.map(c => c.method), ['sendMessage']);
  assert.equal(row(e).text, good.text);
});

test('a poll keeps the cards it already drew (an open Logs viewer must not snap shut) and scrolls to #ref only on the first load', async () => {
  const page = await (await view(new Request('https://x/feedback', {headers: {Authorization: 'Bearer owner'}}), env())).text();
  assert.match(page, /kept\.sig === sig/);   // a kept card is rebuilt when what it shows changes: the delivery verdict, the files, and (3 Nov 2026) the state, its note and the impact
  assert.match(page, /const sig = \[row\.notified[^\]]*row\.state, row\.state_note, row\.impact/);
  assert.match(page, /const mark = \(card, fresh\)/);   // NEW is set on a poll and cleared on the next
  assert.match(page, /firstLoad && location\.hash/);
});

const PAGE = JSON.stringify({screen: 'What we learned', questions: [{id: 'q1', wording: 'Summary', field: 'summary', value: 'Summary', verdict: 'saved'}]}, null, 1);

test('the screen data and the profile snapshot are kept beside the logs, served by kind, flagged on the row and linked in the message', async () => {
  const e = env(), calls = [];
  const answer = await (await send(e, {...good, page: PAGE, profile: '{"details":{"city":"Porto"}}'}, telegramOk(calls))).json();
  assert.deepEqual(answer, {ok: true});
  const saved = row(e);
  assert.deepEqual([saved.logs, saved.page, saved.profile], [1, 1, 1]);
  assert.deepEqual([...e.FEEDBACK_FILES.kept.keys()].sort(), ['logs.txt', 'page.json', 'profile.json', 'screen.png'].map(name => `feedback/${saved.ref}/${name}`));
  assert.match(JSON.parse(calls[0].body).text, /Screenshot · Logs · Screen data · Profile on \/admin/);
  const open = kind => file(new Request(`https://x/admin/growth/feedback/file?ref=${saved.ref}&kind=${kind}`, {headers: {Authorization: 'Bearer owner'}}), e);
  for (const kind of ['page', 'profile']) {
    const served = await open(kind);
    assert.equal(served.status, 200); assert.equal(served.headers.get('Content-Type'), 'application/json; charset=utf-8'); assert.equal(served.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(await (await open('page')).text(), PAGE);
  const data = await (await view(new Request('https://x/feedback?json=1', {headers: {Authorization: 'Bearer owner'}}), e)).json();
  assert.deepEqual([data.rows[0].page, data.rows[0].profile], [1, 1]);
});

test('screen data or a profile over its cap, or not text, is skipped and said; the words and the rest stay', async () => {
  const e = env();
  const answer = await (await send(e, {...good, page: 'x'.repeat(TEXT_FILES.page.max + 1), profile: {not: 'text'}}, telegramOk([]))).json();
  assert.deepEqual(answer.skipped.sort(), ['page', 'profile']);
  const saved = row(e);
  assert.deepEqual([saved.logs, saved.page, saved.profile, saved.shot], [1, 0, 0, 'png']);
  assert.equal(saved.text, good.text);
});

test('90 days on, the screen data and the profile snapshot are deleted and their flags cleared', async () => {
  const e = env();
  await send(e, {...good, page: PAGE, profile: '{}'}, telegramOk([]), new Date('2026-07-01T10:00:00Z'));
  const {ref} = row(e);
  for (const o of e.FEEDBACK_FILES.kept.values()) o.uploaded = new Date('2026-07-01T10:00:00Z');
  assert.equal(await purgeFiles(e, new Date('2026-11-02T10:00:00Z')), 4);
  assert.deepEqual({...e.STATS.db.prepare('SELECT shot, logs, page, profile FROM feedback WHERE ref = ?').get(ref)}, {shot: '', logs: 0, page: 0, profile: 0});
});

test('the admin page offers the three text viewers', async () => {
  const page = await (await view(new Request('https://x/feedback', {headers: {Authorization: 'Bearer owner'}}), env())).text();
  for (const label of ["'Logs'", "'Screen data'", 'Profile snapshot']) assert.ok(page.includes(label), label);
  assert.match(page, /kind=' \+ kind/);
});

test('the platform field keeps the OS version and architecture (a Windows tester\'s build is what a bug starts from)', async () => {
  const e = env();
  await send(e, {...good, platform: 'win32 10.0.19045 x64'}, telegramOk([]));
  assert.equal(row(e).platform, 'win32 10.0.19045 x64');
});
