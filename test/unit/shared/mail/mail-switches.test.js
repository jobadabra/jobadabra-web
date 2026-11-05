// The owner's pressed mail switches (shared/mail-switches.js; owner, 5 Nov 2026: "be actual switches that I can turn on or off"): a press lies over the deployed value, no row or no table leaves the
// deployed value, and the real send path obeys the pressed state. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {send} from '../../../../shared/mail.js';
import {NAMES, SWITCHES, resetSwitchCache, setSwitch, storedSwitches, switchRows, withSwitches} from '../../../../shared/mail-switches.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1(files = ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0135_mail_on.sql', '0137_mail_switch.sql']) {
  resetSwitchCache();   // one cache slot per isolate: every test starts with none
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const now = new Date('2026-11-05T10:00:00Z');

test('the four switches, in the order Admin shows them, each asks before it turns on', () => {
  assert.deepEqual(NAMES, ['MAIL', 'MARKETING_MAIL', 'TRIAL_REMINDERS', 'MAIL_LAUNCH']);
  assert.ok(SWITCHES.every(one => one.ask && one.says));
});

test('nothing pressed: the deployed values stand', async () => {
  const env = {STATS: d1(), MAIL: 'on', MARKETING_MAIL: 'off'};
  const laid = await withSwitches(env);
  assert.equal(laid.MAIL, 'on');
  assert.equal(laid.MARKETING_MAIL, 'off');
  assert.deepEqual((await switchRows(env)).map(row => [row.name, row.on, row.pressed]), [['MAIL', true, false], ['MARKETING_MAIL', false, false], ['TRIAL_REMINDERS', false, false], ['MAIL_LAUNCH', false, false]]);
});

test('a press lies over the deployed value in both directions, and shows when it was pressed', async () => {
  const env = {STATS: d1(), MAIL: 'on', MARKETING_MAIL: 'off'};
  assert.equal(await setSwitch(env, 'MARKETING_MAIL', true, now), true);
  assert.equal(await setSwitch(env, 'MAIL', false, now), true);
  const laid = await withSwitches(env);
  assert.equal(laid.MARKETING_MAIL, 'on');
  assert.equal(laid.MAIL, 'off');
  const rows = await switchRows(env);
  assert.deepEqual([rows[0].on, rows[0].pressed, rows[0].at], [false, true, '2026-11-05T10:00:00.000Z']);
  await setSwitch(env, 'MAIL', true, now);
  assert.equal((await withSwitches(env)).MAIL, 'on');   // the press replaces the old one at once, not after the 5 s read
});

test('a name that is not a switch is refused and stores nothing', async () => {
  const env = {STATS: d1()};
  assert.equal(await setSwitch(env, 'MAIL_DAY_MAX', true, now), false);
  assert.equal(await setSwitch(env, 'STATS_KEY', true, now), false);
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM mail_switch').get().n, 0);
});

test('a stored row for a name or state we do not know is ignored (never turns something on)', async () => {
  const env = {STATS: d1(), MAIL: 'off'};
  env.STATS.db.prepare("INSERT INTO mail_switch (name, state, at) VALUES ('MAIL', 'maybe', 'x'), ('STATS_KEY', 'on', 'x')").run();
  const laid = await withSwitches(env);
  assert.equal(laid.MAIL, 'off');
  assert.equal(laid.STATS_KEY, undefined);
});

test('a missing table (the migration only warns in CI) leaves every switch as deployed', async () => {
  const env = {STATS: d1([]), MAIL: 'on', MARKETING_MAIL: 'off'};
  const laid = await withSwitches(env);
  assert.equal(laid.MAIL, 'on');
  assert.equal(laid.MARKETING_MAIL, 'off');
  assert.equal((await switchRows(env))[0].on, true);
});

test("the owner's case: MAIL pressed off stops a mail the deployed MAIL = on would send; pressed on sends it", async () => {
  const sent = [], STATS = d1();
  const env = {MAIL: 'on', STATS, STATS_SALT: 'salt', EMAIL: {send: async mail => { sent.push(mail); return {messageId: 'm1'}; }}};
  await setSwitch(env, 'MAIL', false, now);
  assert.deepEqual(await send(await withSwitches(env), 'welcome', 'me@example.com', {url: 'https://www.jobadabra.top/confirm?t=x'}, {now}), {ok: false, reason: 'off'});
  assert.equal(sent.length, 0);
  await setSwitch(env, 'MAIL', true, now);
  assert.equal((await send(await withSwitches(env), 'welcome', 'me@example.com', {url: 'https://www.jobadabra.top/confirm?t=x'}, {now})).ok, true);
  assert.equal(sent.length, 1);
});

// What a failed read means (review of this change): the owner pressed MAIL off, then D1 hiccups. That must never send.
const failing = env => ({...env, STATS: {prepare: () => ({all: async () => { throw new Error('D1_ERROR: network connection lost'); }})}});

test('a read error after a press keeps the last good answer: MAIL pressed off stays off, and the failure is not cached', async () => {
  const env = {STATS: d1(), MAIL: 'on', MARKETING_MAIL: 'on'};
  await setSwitch(env, 'MAIL', false, now);
  assert.equal((await withSwitches(env)).MAIL, 'off');   // a good read, now cached
  const broken = failing(env);
  assert.equal((await storedSwitches(broken, {fresh: true})).states.MAIL, 'off');
  assert.equal((await withSwitches(broken)).MAIL, 'off');
  await setSwitch(env, 'MAIL', true, now);   // the press clears the slot, so the next read is real again
  assert.equal((await withSwitches(env)).MAIL, 'on');
});

test('a read error with no good answer yet holds every switch off (sends less, never more than pressed)', async () => {
  const env = failing({STATS: d1(), MAIL: 'on', MARKETING_MAIL: 'on'});
  const laid = await withSwitches(env);
  assert.deepEqual(NAMES.map(name => laid[name]), ['off', 'off', 'off', 'off']);
  assert.equal((await switchRows(env)).every(row => row.held && !row.on), true);
  // not cached: the database is back, so the next request sees the real state at once
  const back = {...env, STATS: d1()};
  assert.equal((await withSwitches(back)).MAIL, 'on');
});

test('a press made through a wrapped STATS (the per-request meter copy) clears the cache of the raw binding', async () => {
  const raw = {STATS: d1(), MAIL: 'on'};
  assert.equal((await withSwitches(raw)).MAIL, 'on');   // cached: no row
  const wrapped = {...raw, STATS: {prepare: text => raw.STATS.prepare(text)}};
  await setSwitch(wrapped, 'MAIL', false, now);
  assert.equal((await withSwitches(raw)).MAIL, 'off');   // the next request on the raw binding sees the press at once, not after 5 s
});

test('the card can show a press that differs from the deploy', async () => {
  const env = {STATS: d1(), MAIL: 'off'};
  await setSwitch(env, 'MAIL', true, now);
  const laid = await withSwitches(env);
  const row = (await switchRows(laid))[0];
  assert.deepEqual([row.on, row.pressed, row.deployed], [true, true, 'off']);
});
