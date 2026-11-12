// Telegram alert when Free AI fails people's calls (owner, 12 Nov 2026: "That could be real users not being able to perform actions" · "I should get alerts (medium/high criticalitiy)" · "For now let's keep it like Telegram").
// Free AI is the route the desktop app's people use (shared/free-ai.js). Every /v1/messages call is counted per minute in D1; the site's five-minute tick judges the last window (shared/free-ai-alert.js).
// Fake Workers AI and fake Telegram only. Run: tools/site-run.sh node --test test/unit/shared/free-ai/free-ai-alert.test.js
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {freeAi, LIMITS} from '../../../../shared/free-ai.js';
import {tick} from '../../../../shared/free-ai-alert.js';
import {tokenFor} from '../../../../shared/guard.js';
import {connect} from '../../../../shared/notify.js';
import {alertOf} from '../../../../shared/notify-registry.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; }, all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
const answer = () => ({choices: [{message: {content: 'hi'}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 50}});
const T0 = Date.parse('2026-11-12T12:00:10Z'), MIN = 60_000, BOT = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const iso = ms => new Date(T0 + ms);

// `run` decides what Workers AI does for the next call; Telegram records what the owner would read.
function world(extra = {}) {
  const sends = [], state = {run: async () => answer()};
  const fetcher = async (url, init) => {
    const [, , method] = /bot([^/]+)\/(\w+)$/.exec(url) || [], body = JSON.parse(init?.body || '{}');
    const reply = (ok, result) => new Response(JSON.stringify({ok, result}), {status: ok ? 200 : 400});
    if (method === 'sendMessage') { sends.push(body.text); return reply(true, {message_id: 1}); }
    if (method === 'getMe') return reply(true, {username: 'a_bot'});
    if (method === 'getChat') return reply(true, {title: 'x', id: body.chat_id});
    if (method === 'getUpdates') return reply(true, [{message: {chat: {id: 777}}}]);
    return reply(true, {});
  };
  const env = {WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', NOTIFY_SECRET: 'vault', AI: {run: (...args) => state.run(...args)}, ...extra};
  const key = async install => `JPF1.${install}.${await tokenFor(install, env, 'ai')}`;
  const call = async (install, at, {headers = {}, body = {model: 'claude-haiku-5-5', max_tokens: 50, messages: [{role: 'user', content: 'hello'}]}, apiKey} = {}) =>
    freeAi(new Request('https://www.jobpilotto.top/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': apiKey ?? await key(install), ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)}), env, iso(at), null, fetcher);
  const fail = message => { state.run = async () => { throw new Error(message); }; };
  const heal = () => { state.run = async () => answer(); };
  const judge = at => tick(env, iso(at), fetcher);
  return {env, sends, call, fail, heal, judge, ready: () => connect(env, 'engineering', BOT, '', fetcher, iso(0))};
}
const failing = sends => sends.filter(text => /Free AI fails/.test(text));

test('the alert is a registry event on Engineering, wired, on by default, "changes only" with its modes', () => {
  const alert = alertOf('free-ai-failing');
  assert.deepEqual([alert?.channel, alert?.wired, alert?.on, alert?.mode], ['engineering', true, true, 'changes']);
  assert.deepEqual(alert.modes, ['every', 'changes']);
});

test('3 upstream failures from 2 people in a window send one 🔴 with the count, the cause and the installs; more failures send nothing; recovery sends one 🟢', async () => {
  const w = world(); await w.ready();
  w.fail('upstream timed out (3040)');
  assert.equal((await w.call('install-aaaa', 1000)).status, 502);
  assert.equal((await w.call('install-bbbb', 2000)).status, 502);
  await w.judge(3 * MIN); assert.equal(failing(w.sends).length, 0, '2 of 2 is under the 3-call floor');
  assert.equal((await w.call('install-aaaa', 3.5 * MIN)).status, 502);
  await w.judge(4 * MIN);
  assert.equal(failing(w.sends).length, 1);
  assert.match(w.sends[0], /^🔴 Free AI fails people's calls: 3 of 3 in 5 min/);
  assert.match(w.sends[0], /Workers AI failed: upstream timed out \(3040\)/); assert.match(w.sends[0], /installs affected: 2/);
  for (let i = 0; i < 4; i++) await w.call('install-aaaa', 4.2 * MIN + i * 1000);
  await w.judge(5 * MIN); await w.judge(6 * MIN);
  assert.equal(failing(w.sends).length, 1, 'once per streak');
  // The outage ends: calls answer, the window clears, and one whole calm window later the 🟢 goes out, once.
  w.heal();
  const greens = () => w.sends.filter(text => /^🟢 Free AI answers again/.test(text)).length;
  const seen = [];
  for (let m = 7; m <= 24; m++) { assert.equal((await w.call('install-aaaa', m * MIN)).status, 200); await w.judge(m * MIN + 30_000); seen.push(greens()); }
  assert.equal(greens(), 1);
  assert.ok(seen[0] === 0 && seen[2] === 0, '🟢 not before the calm window is whole');
  await w.judge(40 * MIN); assert.equal(greens(), 1);
});

test('limits that belong to one person are not an outage: day, month and trial 429s, a bad token, a bad body', async () => {
  const w = world(); await w.ready();
  const me = 'install-cccc', day = '2026-11-12';
  await w.call(me, 500);   // learn the digest of this install
  const mine = [...w.env.WAITLIST.m.keys()].find(k => k.startsWith('freeai:min:')).split(':')[2];
  w.env.WAITLIST.m.set(`freeai:dusd:${mine}:${day}`, String(LIMITS.installDayUsd * 1e6));
  for (let i = 0; i < 5; i++) assert.equal((await w.call(me, 1000 + i)).status, 429);
  for (let i = 0; i < 5; i++) assert.equal((await w.call('install-dddd', 2000 + i, {apiKey: 'JPF1.install-dddd.forged'})).status, 401);
  w.env.WAITLIST.m.set(`freeai:dusd:${mine}:${day}`, '0');
  for (let i = 0; i < 5; i++) assert.equal((await w.call(me, 3000 + i, {body: '{not json'})).status, 400);
  await w.judge(2 * MIN); await w.judge(8 * MIN);
  assert.deepEqual(failing(w.sends), []);
});

test('the global busy line (every install waits) is a failure people feel: 3 of them send a 🔴 that says busy', async () => {
  const w = world(); await w.ready();
  w.env.WAITLIST.m.set('freeai:usd:2026-11-12', String(LIMITS.stopUsd * 1e6));
  for (let i = 0; i < 3; i++) assert.equal((await w.call(`install-${i}${i}${i}${i}`, 1000 * (i + 1))).status, 503);
  await w.judge(2 * MIN);
  assert.equal(failing(w.sends).length, 1); assert.match(w.sends[0], /busy/); assert.match(w.sends[0], /installs affected: 3/);
});

test('the owner\'s own pause (FREE_AI=off) is not a failure', async () => {
  const w = world({FREE_AI: 'off'}); await w.ready();
  for (let i = 0; i < 6; i++) assert.equal((await w.call('install-eeee', 1000 * (i + 1))).status, 503);
  await w.judge(2 * MIN);
  assert.deepEqual(failing(w.sends), []);
});

test('answered calls dilute: 3 failures among 8 answers (27%) is a normal hour, not an outage', async () => {
  const w = world(); await w.ready();
  for (let i = 0; i < 8; i++) await w.call('install-ffff', 1000 * i);
  w.fail('boom'); for (let i = 0; i < 3; i++) await w.call('install-ffff', 10_000 + i * 1000);
  await w.judge(2 * MIN);
  assert.deepEqual(failing(w.sends), []);
});

test('a site without its database or without Workers AI answers as before and counts nothing', async () => {
  const w = world({STATS: undefined}); await w.ready().catch(() => {});
  w.fail('x');
  assert.equal((await w.call('install-gggg', 1000)).status, 502);
});
