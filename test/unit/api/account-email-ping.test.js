// The owner's Telegram ping when an install gives an e-mail address (api/account-email.js tellOwner; owner, 3 Nov 2026: "Send me a telegram message everytime a new user puts his email,
// adds his email in the application"): one ping for a first address, one "changed" for a new address, none for a re-save, a GET, or the resend / confirm routes; Telegram failing never fails the save.
// Fake fetcher only, never the real Telegram.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {address, resend} from '../../../api/account-email.js';
import {tokenFor} from '../../../shared/guard.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE revoked (who TEXT PRIMARY KEY, reason TEXT, created_at TEXT)');
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const TOKEN = 'bot-secret-123';
function setup(extra = {BRAIN_BOT_TOKEN: TOKEN, BRAIN_CHAT_ID: '42'}, answer = () => new Response(JSON.stringify({ok: true, result: {message_id: 1}}))) {
  const calls = [], logs = [];
  const fetcher = async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return answer(); };
  return {calls, logs, fetcher, e: {MAIL: 'on', STATS: d1(), STATS_SALT: 'salt', EMAIL: {send: async () => ({messageId: 'm'})}, ...extra}};
}
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const put = async (s, install, email, method = 'PUT', fn = address) => {
  const request = new Request('https://x/api', {method, headers: {'x-api-key': await keyOf(install)}, ...(method === 'PUT' && {body: JSON.stringify({email})})});
  const response = await fn(request, s.e, new Date('2026-11-03T10:00:00Z'), s.fetcher);
  return {status: response.status, ...(await response.json())};
};

test('a first address pings the owner once, with the address escaped; the same address again pings nobody', async () => {
  const s = setup();
  assert.equal((await put(s, 'install-aaaa1234', 'not an address')).status, 400);
  assert.equal(s.calls.length, 0, 'a refused address pings nobody');
  assert.equal((await put(s, 'install-aaaa1234', 'ana@example.com')).ok, true);
  assert.equal(s.calls.length, 1);
  const {url, body} = s.calls[0];
  assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(body.chat_id, '42');
  assert.equal(body.parse_mode, 'HTML');
  assert.equal(body.text, '📧 <b>New user e-mail</b> · ana@example.com · install install- · 1 with an e-mail');
  assert.equal((await put(s, 'install-aaaa1234', 'ana@example.com')).ok, true);
  await put(s, 'install-aaaa1234', null, 'GET');
  await put(s, 'install-aaaa1234', null, 'POST', resend);
  assert.equal(s.calls.length, 1, 'a re-save, a GET and a resend do not ping');
});

test('an address with an & is HTML-escaped, and the count is the accounts holding an address in the message', async () => {
  const s = setup();
  s.e.STATS.db.exec("INSERT INTO pro_accounts (id, email_hash, email, created_at, plan) VALUES ('acc_x', 'hx', 'x', 'x', 'trial')");
  // validAddress refuses < and >, so the escape is proven on what a valid address can still carry: & in the local part.
  assert.equal((await put(s, 'install-bbbb1234', 'o&co@example.com')).ok, true);
  assert.ok(s.calls[0].body.text.includes('o&amp;co@example.com'), s.calls[0].body.text);
  assert.ok(s.calls[0].body.text.includes('· 2 with an e-mail'));
});

test('a changed address on an existing account pings once, worded "changed"', async () => {
  const s = setup();
  await put(s, 'install-aaaa1234', 'ana@example.com');
  assert.equal((await put(s, 'install-aaaa1234', 'ana.new@example.com')).ok, true);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].body.text, '📧 <b>User e-mail changed</b> · ana.new@example.com · install install- · 1 with an e-mail');
});

test('a taken or Pro refusal pings nobody', async () => {
  const s = setup();
  await put(s, 'install-aaaa1234', 'ana@example.com');
  assert.equal((await put(s, 'install-bbbb1234', 'ana@example.com')).error, 'taken');
  assert.equal(s.calls.length, 1);
  s.e.STATS.db.prepare("UPDATE pro_accounts SET plan = 'pro'").run();
  assert.equal((await put(s, 'install-aaaa1234', 'other@example.com')).error, 'pro');
  assert.equal(s.calls.length, 1, 'a Pro account changing its address is refused before any ping');
});

for (const [name, answer] of [['Telegram answers 500', () => new Response('{"ok":false,"description":"boom"}', {status: 500})], ['the call throws', () => { throw new Error(`down ${TOKEN}`); }]]) {
  test(`${name}: the save still answers 200, the account is kept, and the log never shows the token`, async () => {
    const s = setup(undefined, answer), lines = [], log = console.log;
    console.log = (...parts) => lines.push(parts.join(' '));
    try { assert.equal((await put(s, 'install-aaaa1234', 'ana@example.com')).status, 200); } finally { console.log = log; }
    assert.equal(s.calls.length, 1);
    assert.equal(s.e.STATS.db.prepare('SELECT COUNT(*) AS n FROM pro_accounts WHERE email = ?').get('ana@example.com').n, 1);
    assert.ok(lines.some(line => line.includes('account e-mail ping failed')) && !lines.join('\n').includes(TOKEN));
  });
}

test('no BRAIN_* secrets: no Telegram call, the save works', async () => {
  const s = setup({});
  assert.equal((await put(s, 'install-aaaa1234', 'ana@example.com')).ok, true);
  assert.equal(s.calls.length, 0);
});

test('with a Worker context the ping rides ctx.waitUntil and the answer does not wait for it', async () => {
  const s = setup(), waiting = [];
  const request = new Request('https://x/api', {method: 'PUT', headers: {'x-api-key': await keyOf('install-aaaa1234')}, body: JSON.stringify({email: 'ana@example.com'})});
  assert.equal((await address(request, s.e, new Date(), s.fetcher, {waitUntil: promise => waiting.push(promise)})).status, 200);
  assert.equal(waiting.length, 1);
  await Promise.all(waiting);
  assert.equal(s.calls.length, 1);
});
