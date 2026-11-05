// GET /api/ai/caps (shared/free-ai-caps.js): the app asks before an AI step whether this install is past a Free line, read exactly as Free AI enforces them
// (owner, 26 Oct 2026: show the top-up dialog "whenever ... their cap is reached", also before 60 days or 20 applications). Run: tools/site-run.sh node --test test/unit/shared/free-ai/free-ai-caps.test.js
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {tokenFor} from '../../../../shared/guard.js';
import {DAY_MESSAGE, MONTH_MESSAGE, TRIAL_MESSAGE, keysOf, who} from '../../../../shared/free-ai.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const ORIGIN = 'https://www.jobpilotto.top', A = 'install-aaaaaaaa';
function site(extra = {}) {
  const kv = new Map();
  return {kv, STATS: d1(), STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', STATS_SALT: 's', PRO_PLAN: 'promo', AI: {}, ASSETS: {fetch: () => new Response('asset')},
    WAITLIST: {get: async key => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, value); }, list: async () => ({keys: []})}, ...extra};
}
const ask = async (env, install = A, method = 'GET') => worker.fetch(new Request(`${ORIGIN}/api/ai/caps`, {method, headers: {'x-api-key': `JPF1.${install}.${await tokenFor(install, env, 'ai')}`}}), env, {});
test('a fresh install is under every line; the answer is never cached', async () => {
  const env = site(), res = await ask(env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), {ok: true, lane: 'free', capped: null, message: null, resetsAt: null});
});

test('past its day, month or trial line, the install hears which, the route\'s own words and when it opens again', async () => {
  const env = site();
  const day = new Date().toISOString().slice(0, 10);
  const me = await who(`JPF1.${A}.${await tokenFor(A, env, 'ai')}`, env);
  const keys = keysOf(me.who, day, day.slice(0, 7), '');
  env.kv.set(keys.dayUsd, String(10_000_000));
  let body = await (await ask(env)).json();
  assert.deepEqual([body.capped, body.message], ['day', DAY_MESSAGE]);
  assert.match(body.resetsAt, /T00:00:00.000Z$/);
  assert.ok(Date.parse(body.resetsAt) > Date.now() && Date.parse(body.resetsAt) - Date.now() <= 86_400_000, 'the next 00:00 UTC');
  env.kv.set(keys.monthUsd, String(100_000_000));
  body = await (await ask(env)).json();
  assert.deepEqual([body.capped, body.message], ['month', MONTH_MESSAGE]);
  assert.match(body.resetsAt, /-01T00:00:00.000Z$/);
  env.kv.set(keys.life, String(100_000_000));
  body = await (await ask(env)).json();
  assert.deepEqual([body.capped, body.message, body.resetsAt], ['trial', TRIAL_MESSAGE, null]);
});

test('with credit from a credit code, the install is in the credit lane: no Free line applies', async () => {
  const env = site();
  await env.STATS.prepare("INSERT INTO install_credit (install, credit_micro, credit_added_micro, updated_at) VALUES (?, 4000000, 10000000, 'x')").bind(A).run();
  const me = await who(`JPF1.${A}.${await tokenFor(A, env, 'ai')}`, env);
  const day = new Date().toISOString().slice(0, 10);
  env.kv.set(keysOf(me.who, day, day.slice(0, 7), '').dayUsd, String(10_000_000));
  assert.deepEqual(await (await ask(env)).json(), {ok: true, lane: 'credit', capped: null, message: null, resetsAt: null, credit: {percent: 40, warn: null}});
});

test('a wrong key is refused; only GET', async () => {
  const env = site();
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/ai/caps`, {headers: {'x-api-key': `JPF1.${A}.wrong`}}), env, {})).status, 401);
  assert.equal((await ask(env, A, 'POST')).status, 405);
  assert.equal((await (await ask(site({FREE_AI: 'off'}))).json()).capped, 'off');
});
