// AI-credit promo codes (shared/promo-credit.js, shared/install-credit.js, admin/promo-codes.js; owner, 26 Oct 2026: "I want to be able to topup with 10e for example,
// using a promo code"): a credit code adds its euros to the install once per code, codes stack, the plan stays as it was, the credit lane serves it while it lasts
// (also while paying is off), then the Free rules apply again. Only fake codes. Run: tools/site-run.sh node --test test/unit/shared/promo-credit.test.js
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {tokenFor} from '../../../shared/guard.js';
import {chargeCall, proLane} from '../../../shared/pro-ai.js';
import {installCredit} from '../../../shared/install-credit.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const ORIGIN = 'https://www.jobpilotto.top', OWNER = {Authorization: 'Bearer script-key'};
function site(extra = {}) {
  const kv = new Map();
  return {STATS: d1(), STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', STATS_SALT: 's', PRO_PLAN: 'promo', ASSETS: {fetch: () => new Response('asset')},
    WAITLIST: {get: async key => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, value); }, list: async () => ({keys: []})}, ...extra};
}
const make = (env, fields = {}) => worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {method: 'POST', headers: {...OWNER, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({action: 'import', code: 'TOPUP-FAKE-TEN', label: 'test', cap: '2', ends: '2999-12-31', kind: 'credit', credit: '10', ...fields})}), env, {});
const key = async (env, install) => `JPF1.${install}.${await tokenFor(install, env, 'ai')}`;
const redeem = async (env, install, code) => (await worker.fetch(new Request(`${ORIGIN}/api/pro/redeem`, {method: 'POST',
  headers: {'x-api-key': await key(env, install), 'CF-Connecting-IP': '1.1.1.1', 'Content-Type': 'application/json'}, body: JSON.stringify({code})}), env, {})).json();
const status = async (env, install) => (await worker.fetch(new Request(`${ORIGIN}/api/pro/status`, {headers: {'x-api-key': await key(env, install)}}), env, {})).json();
const A = 'install-aaaaaaaa', B = 'install-bbbbbbbb', C = 'install-cccccccc';
// Credit codes are Pro's (owner, 27 Oct 2026): an install becomes Pro by a fake Pro code first.
const pro = async (env, ...installs) => { await make(env, {code: 'BETA-FAKE-PRO', kind: 'pro', cap: '10'}); for (const install of installs) assert.equal((await redeem(env, install, 'BETA-FAKE-PRO')).ok, true); };

test('only Pro can add AI credit: a Free install hears pro_only and nothing is added or used (owner, 27 Oct 2026)', async () => {
  const env = site();
  await make(env);
  assert.deepEqual(await redeem(env, A, 'TOPUP-FAKE-TEN'), {ok: false, error: 'pro_only'});
  assert.equal(await installCredit(env, A), null);
  assert.equal((await env.STATS.prepare('SELECT COUNT(*) AS n FROM pro_promo_credit_uses').first()).n, 0, 'the code keeps its places');
  assert.equal((await status(env, A)).plan, 'free');
});

test('a credit code adds its euros to a Pro install, once; the plan stays as it was; a second code stacks', async () => {
  const env = site();
  assert.equal((await make(env)).status, 200);
  await pro(env, A);
  assert.equal((await status(env, A)).creditPercent, 0, 'no credit before');
  assert.deepEqual(await redeem(env, A, 'topup fake ten'), {ok: true, credit: 10});
  const after = await status(env, A);
  assert.deepEqual([after.plan, after.source, after.hasCredit, after.creditPercent], ['pro', 'promo', true, 100], 'AI credit only (owner, 26 Oct 2026)');
  assert.deepEqual(await redeem(env, A, 'TOPUP-FAKE-TEN'), {ok: true, already: true, credit: 10}, 'the same code twice adds nothing');
  assert.equal((await installCredit(env, A)).credit_micro, 10_000_000);
  await make(env, {code: 'TOPUP-FAKE-FIVE', credit: '5'});
  assert.equal((await redeem(env, A, 'TOPUP-FAKE-FIVE')).credit, 5);
  assert.deepEqual({...await installCredit(env, A)}, {credit_micro: 15_000_000, credit_added_micro: 15_000_000}, 'codes stack');
  const ledger = (await env.STATS.prepare("SELECT reason, delta_micro FROM pro_credit WHERE account LIKE 'install:%'").all()).results;
  assert.deepEqual(ledger.map(row => [row.reason, row.delta_micro]), [['promo', 10_000_000], ['promo', 5_000_000]]);
  assert.ok(!(await env.STATS.prepare('SELECT 1 FROM pro_accounts').first()), 'no account, no e-mail row');
});

test('a promo Pro install with a credit code has credit (the app no longer blocks it)', async () => {
  const env = site();
  await make(env); await pro(env, A);
  assert.deepEqual([(await status(env, A)).hasCredit, (await status(env, A)).creditPercent], [false, 0], 'Pro by a code: no credit (the owner\'s case)');
  await redeem(env, A, 'TOPUP-FAKE-TEN');
  const now = await status(env, A);
  assert.deepEqual([now.plan, now.source, now.hasCredit, now.creditPercent, now.warn], ['pro', 'promo', true, 100, null]);
});

test('the cap, the end date and a revoke hold for credit codes', async () => {
  const env = site(); await make(env, {cap: '1'}); await pro(env, A, B, C);
  assert.equal((await redeem(env, A, 'TOPUP-FAKE-TEN')).ok, true);
  assert.deepEqual(await redeem(env, B, 'TOPUP-FAKE-TEN'), {ok: false, error: 'used_up'});
  await make(env, {code: 'TOPUP-FAKE-LATE'});
  await env.STATS.prepare("UPDATE pro_promo_codes SET ends_at = '2020-01-01T00:00:00.000Z' WHERE label = 'test' AND cap = 2").run();
  assert.equal((await redeem(env, C, 'TOPUP-FAKE-LATE')).error, 'expired');
  assert.equal(await installCredit(env, C), null);
});

test('the credit lane serves install credit while it lasts, then says used up; off with the plan switch off', async () => {
  const env = site(); await make(env); await pro(env, A); await redeem(env, A, 'TOPUP-FAKE-TEN');
  assert.deepEqual(await proLane(env, A), {install: A});
  assert.equal(await proLane(env, B), null, 'no credit: the Free rules');
  await chargeCall(env, {install: A}, 6_000_000, 'score');   // $6 raw = more than €10 at our prices
  assert.ok((await installCredit(env, A)).credit_micro <= 0);
  assert.equal(await proLane(env, A), null, 'used up: no credit lane');
  const used = await status(env, A);
  assert.deepEqual([used.hasCredit, used.creditPercent, used.warn], [true, 0, 0], 'the app hears "used up" (warn 0) and offers Top up');
  await redeem(env, A, 'TOPUP-FAKE-TEN');
  const off = site({PRO_PLAN: 'off'}); await off.STATS.prepare("INSERT INTO install_credit (install, credit_micro, credit_added_micro, updated_at) VALUES (?, 1000000, 1000000, 'x')").bind(A).run();
  assert.equal(await proLane(off, A), null);
});

test('the admin page makes a credit code, names the two kinds apart, and refuses a bad amount', async () => {
  const env = site();
  for (const credit of ['0', '101', 'x']) assert.equal((await make(env, {credit})).status, 400, credit);
  await make(env);
  const page = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), env, {})).text();
  // Named apart in the admin (owner, 27 Oct 2026: "in our admin, they should be distinguished"); the € field shows only for a top-up.
  assert.match(page, /<option value="pro">Pro upgrade<\/option><option value="credit">AI credit top-up<\/option>/);
  assert.match(page, /<label class="muted credit-field" hidden>€ of AI credit/);
  assert.match(page, /onchange="this\.form\.querySelector\('\.credit-field'\)\.hidden=this\.value!=='credit'"/);
  // Gives is a chip, one colour per kind (owner, 27 Oct 2026: "this column values/cells should be displayed as chips").
  assert.match(page, /<td class="one-line"><span class="chip credit">€10 top-up<\/span><\/td>/);
  assert.match(page, /\.chip\{[^}]*white-space:nowrap/, 'a chip never wraps');
  // One line per row (owner, 27 Oct 2026): the short cells never wrap (the Copy icon: test/unit/shared/promo.test.js).
  assert.match(page, /<td class="one-line">0 of 2<\/td>/);
  await make(env, {code: 'BETA-FAKE-PRO', kind: 'pro'});
  const after = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), env, {})).text();
  assert.match(after, /<td class="one-line"><span class="chip pro">Pro upgrade<\/span><\/td>/, 'a Pro code says Pro upgrade, in the Pro colour');
});
