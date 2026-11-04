// The repo key (JPT1.<handle>.<mac>) is what Always-on repos on GitHub hold: it proves WHICH install asks, carries no install id, and spends nothing.
// Guard: security + money — a purpose-'ai' key (JPF1) copied into a user's repo can spend that install's Free AI budget, so the repo key must neither open an AI route nor reveal the install id.
// Only the trial status and the notify mail accept it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {notify, address, resend} from '../../../api/account-email.js';
import {installToken} from '../../../api/recipes.js';
import {installOfTrialKey} from '../../../shared/trial-key.js';
import worker from '../../../workers/www/index.js';
import {tokenFor} from '../../../shared/guard.js';
import {status} from '../../../shared/trial.js';
import {freeAi} from '../../../shared/free-ai.js';
import {caps} from '../../../shared/free-ai-caps.js';

const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
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
const sent = [];
const env = () => { const seen = []; return {seen, MAIL: 'on', STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', EMAIL: {send: async m => { sent.push(m); return {messageId: 'm1'}; }},
  AI: {run: async (model, input) => { seen.push(model); return {choices: [{message: {content: 'hi'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1}}; }}}; };
const INSTALL = 'install-0001', now = new Date('2026-10-16T10:00:00Z');
const aiKey = async (install = INSTALL) => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const mint = async (e, install = INSTALL, proof) => installToken(new Request('https://x/api/install-token', {method: 'POST', headers: {'x-api-key': proof ?? await aiKey(install)}, body: JSON.stringify({install, purpose: 'trial'})}), e, now);
const repoKey = async (e, install = INSTALL) => (await (await mint(e, install)).json()).key;
const get = (fn, e, apiKey, path = '', method = 'GET', body) => fn(new Request(`https://x/api${path}`, {method, headers: {'x-api-key': apiKey}, ...(body && {body: JSON.stringify(body)})}), e, now);
const AI_BODY = {model: 'claude-haiku-5-5', max_tokens: 50, messages: [{role: 'user', content: 'hello'}]};

test('minting needs the install\'s own AI key; the same install gets the same key every time', async () => {
  const e = env();
  assert.equal((await mint(e, INSTALL, 'nope')).status, 401);
  assert.equal((await mint(e, INSTALL, await aiKey('install-0002'))).status, 401, 'another install\'s proof');
  assert.equal((await mint(e, INSTALL, '')).status, 401, 'a bare install id is no proof');
  const first = await repoKey(e);
  assert.match(first, /^JPT1\.[0-9a-f]{32}\.[0-9a-f]{32}$/);
  assert.equal(await repoKey(e), first);
  assert.notEqual(await repoKey(e, 'install-0002'), first);
});

test('the repo key carries no install id and no AI token: nothing in it can be turned into a Free AI key', async () => {
  const e = env(), key = await repoKey(e), aiToken = (await aiKey()).split('.')[2];
  assert.ok(!key.includes(INSTALL) && !key.includes(aiToken));
});

test('the trial status answers a JPT1 key and still a JPF1 key (the app), for the same install', async () => {
  const e = env(), repo = await repoKey(e);
  for (const given of [repo, await aiKey()]) assert.equal((await get(status, e, given, '/trial/status?applied=7')).status, 200);
  assert.equal((await (await get(status, e, repo, '/trial/status?applied=0')).json()).used, 7, 'the repo key reads the install\'s own count');
});

test('the notify mail answers a JPT1 key; the address and its resend (reading or changing the person\'s mail) do not', async () => {
  const e = env(), repo = await repoKey(e);
  // a fresh install has no address: {ok:false, reason:'no_address'} with status 200 shows auth passed (a refused key is 401)
  const noAddress = await get(notify, e, repo, '/notify/email', 'POST', {subject: 's', html: '<b>x</b>'});
  assert.equal(noAddress.status, 200);
  assert.equal((await noAddress.json()).reason, 'no_address');
  assert.equal((await get(address, e, repo, '/account/email', 'GET')).status, 401);
  assert.equal((await get(resend, e, repo, '/account/email/resend', 'POST')).status, 401);
});

test('a JPT1 key never reaches Free AI: 401 on /api/ai and /api/ai/caps through the worker, the model never runs', async () => {
  const e = {...env(), STATS_KEY: 'k', STATS_API_KEY: 's', ASSETS: {fetch: () => new Response('asset')}}, repo = await repoKey(e);
  for (const [path, method, body] of [['/api/ai/v1/messages', 'POST', AI_BODY], ['/api/ai/caps', 'GET']]) {
    const answer = await worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {method, headers: {'x-api-key': repo}, ...(body && {body: JSON.stringify(body)})}), e, {});
    assert.equal(answer.status, 401, path);
  }
  assert.equal(e.seen.length, 0);
  assert.equal((await get(freeAi, e, repo, '/ai/v1/messages', 'POST', AI_BODY)).status, 401);
  assert.equal((await get(caps, e, repo, '/ai/caps')).status, 401);
});

test('a forged mac, a handle nobody minted, a JPF1 key with a repo mac and a revoked install are all refused', async () => {
  const e = env(), repo = await repoKey(e), [, handle, mac] = repo.split('.');
  const unminted = '0'.repeat(32), unmintedMac = await tokenFor(unminted, {STATS_SALT: 'salt'}, 'trial');
  for (const bad of [`JPT1.${handle}.deadbeef`, `JPT1.${handle}.${'0'.repeat(32)}`, `JPT1.${unminted}.${unmintedMac}`, `JPT1.${handle}`, `JPF1.${INSTALL}.${mac}`, `JPT1.${INSTALL}.${mac}`, 'JPT1.', '']) {
    assert.equal(await installOfTrialKey(bad, e), null, bad);
  }
  const named = await installOfTrialKey(repo, e);
  assert.equal(named.install, INSTALL);
  e.STATS.db.prepare('INSERT INTO revoked (who, reason, created_at) VALUES (?, ?, ?)').run(named.who, 'test', 'now');
  assert.equal(await installOfTrialKey(repo, e), null, 'a revoked install\'s repo key stops with it');
});
