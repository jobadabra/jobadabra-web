// Pro promo codes (shared/promo.js, admin/promo-codes.js): a right code gives Pro for that install until its end date or revoke; wrong, expired, used-up and rate-limited tries are refused;
// nothing exists while PRO_PLAN is off; the cap holds under parallel calls. Only fake codes are used here. Run: tools/site-run.sh node --test test/unit/shared/promo.test.js
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {tokenFor} from '../../../shared/guard.js';
import {newCode} from '../../../shared/promo.js';
import {givesChip, stateChip} from '../../../admin/promo-codes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const ORIGIN = 'https://www.jobpilotto.top', FAKE = 'TEST-FAKE-CODE', OWNER = {Authorization: 'Bearer script-key'};
function site(extra = {}) {
  const kv = new Map();
  return {STATS: d1(), STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', STATS_SALT: 's', PRO_PLAN: 'test', ASSETS: {fetch: () => new Response('asset')},
    WAITLIST: {get: async key => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, value); }, list: async () => ({keys: []})}, ...extra};
}
const importCode = (env, fields = {}) => worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {method: 'POST', headers: {...OWNER, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({action: 'import', code: FAKE, label: 'test', cap: '2', ends: '2999-12-31', ...fields})}), env, {});
const key = async (env, install) => `JPF1.${install}.${await tokenFor(install, env, 'ai')}`;
const redeem = async (env, install, code, ip = '1.1.1.1') => worker.fetch(new Request(`${ORIGIN}/api/pro/redeem`, {method: 'POST', headers: {'x-api-key': await key(env, install), 'CF-Connecting-IP': ip, 'Content-Type': 'application/json'}, body: JSON.stringify({code})}), env, {});
const status = async (env, install) => (await worker.fetch(new Request(`${ORIGIN}/api/pro/status`, {headers: {'x-api-key': await key(env, install)}}), env, {})).json();
const A = 'install-aaaaaaaa', B = 'install-bbbbbbbb', C = 'install-cccccccc';

test('a right code gives Pro (no credit) and a wrong one does not', async () => {
  const env = site(); await importCode(env);
  assert.equal((await status(env, A)).plan, 'free');
  const wrong = await redeem(env, A, 'NOT-THE-CODE');
  assert.equal(wrong.status, 400); assert.equal((await wrong.json()).error, 'wrong');
  assert.equal((await status(env, A)).plan, 'free');
  assert.equal((await (await redeem(env, A, 'test fake code')).json()).ok, true);   // case, spaces and dashes do not matter
  const now = await status(env, A);
  assert.equal(now.plan, 'pro'); assert.equal(now.hasCredit, false); assert.equal(now.package, 'pro');
  assert.equal((await (await redeem(env, A, FAKE)).json()).already, true);
  assert.equal((await env.STATS.prepare('SELECT COUNT(*) AS n FROM pro_promo_uses').first()).n, 1, 'asking twice uses one slot');
});

test('the promo Pro counts as licensed for the app: the status the app reads is plan pro', async () => {
  const env = site(); await importCode(env); await redeem(env, A, FAKE);
  const body = await status(env, A);
  assert.equal(body.ok, true); assert.equal(body.plan, 'pro');   // desktop licenseState() turns plan 'pro' into licensed: true (the Export gate)
});

test('PRO_PLAN "promo": a code gives Pro while paying stays off (no prices, no checkout, no sign-in)', async () => {
  const env = site({PRO_PLAN: 'promo'}); await importCode(env);
  const free = await status(env, A);
  assert.deepEqual([free.plan, free.mode, free.offers], ['free', 'promo', []], 'no prices are sent');
  assert.equal((await (await redeem(env, A, FAKE)).json()).ok, true);
  const pro = await status(env, A);
  assert.deepEqual([pro.plan, pro.source, pro.offers], ['pro', 'promo', []]);
  const post = async path => worker.fetch(new Request(`${ORIGIN}${path}`, {method: 'POST', headers: {'x-api-key': await key(env, A), 'Content-Type': 'application/json'}, body: JSON.stringify({kind: 'pro'})}), env, {});
  for (const path of ['/api/pro/checkout', '/api/pro/signin/start']) assert.equal((await post(path)).status, 404, `${path} stays off`);
});

test('the cap holds, also for parallel calls', async () => {
  const env = site(); await importCode(env, {cap: '2'});
  const answers = await Promise.all([A, B, C].map(install => redeem(env, install, FAKE).then(r => r.json())));
  assert.equal(answers.filter(a => a.ok).length, 2);
  assert.deepEqual(answers.filter(a => !a.ok).map(a => a.error), ['used_up']);
});

test('an expired code is refused only after a right code; Pro by a code ends on its date', async () => {
  const env = site(); await importCode(env);
  await redeem(env, A, FAKE);
  await env.STATS.prepare("UPDATE pro_promo_codes SET ends_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await status(env, A)).plan, 'free');
  const late = await redeem(env, B, FAKE);
  assert.equal((await late.json()).error, 'expired');
  assert.equal((await (await redeem(env, B, 'NOT-THE-CODE')).json()).error, 'wrong', 'a wrong code never says the date has passed');
});

test('revoke ends Pro at once, delete removes the code and its uses', async () => {
  const env = site(); await importCode(env); await redeem(env, A, FAKE);
  const id = (await env.STATS.prepare('SELECT id FROM pro_promo_codes').first()).id;
  const post = fields => worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {method: 'POST', headers: {...OWNER, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(fields)}), env, {});
  assert.equal((await post({action: 'revoke', id})).status, 303);
  assert.equal((await status(env, A)).plan, 'free');
  assert.equal((await (await redeem(env, B, FAKE)).json()).error, 'wrong');
  await post({action: 'delete', id});
  assert.equal((await env.STATS.prepare('SELECT COUNT(*) AS n FROM pro_promo_uses').first()).n, 0);
});

test('tries are limited per install and per IP', async () => {
  const env = site(); await importCode(env);
  for (let i = 0; i < 5; i++) assert.equal((await redeem(env, A, 'NOT-THE-CODE')).status, 400);
  assert.equal((await redeem(env, A, FAKE)).status, 429, 'the 6th try of one install in an hour is refused, even with the right code');
  const env2 = site(); await importCode(env2);
  for (let i = 0; i < 20; i++) await redeem(env2, `install-${String(i).padStart(8, '0')}`, 'NOT-THE-CODE', '9.9.9.9');
  assert.equal((await redeem(env2, 'install-zzzzzzzz', FAKE, '9.9.9.9')).status, 429);
});

test('nothing exists while PRO_PLAN is off, and the route needs the install key', async () => {
  const off = site({PRO_PLAN: 'off'});
  assert.equal((await redeem(off, A, FAKE)).status, 404);
  const env = site();
  const bare = await worker.fetch(new Request(`${ORIGIN}/api/pro/redeem`, {method: 'POST', body: '{}'}), env, {});
  assert.equal(bare.status, 401);
});

test('the admin page is the owner\'s: others get 404; a made code is shown once, only its hash is kept', async () => {
  const env = site({PROMO_CODE_KEY: 'test-key'});
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`), env, {})).status, 404);
  const made = await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {method: 'POST', headers: {...OWNER, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({action: 'generate', label: 'friends', count: '2', cap: '5', ends: '2999-12-31'})}), env, {});
  const text = await made.text();
  const codes = [...text.matchAll(/\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/g)].map(m => m[1]);
  assert.equal(new Set(codes).size, 1, 'one Generate makes one code, even if a count is sent');
  assert.ok(!/name="count"/.test(text) && /People who can use it/.test(text) && !/How many|Uses each/.test(text), 'the form has no count field, only the people cap');
  assert.equal((await redeem(env, A, codes[0])).status, 200);
  const stored = JSON.stringify((await env.STATS.prepare('SELECT * FROM pro_promo_codes').all()).results);
  for (const code of codes) assert.ok(!stored.includes(code), 'the code is not stored in plain text');
  assert.ok(/"code_enc":"[^"]+"/.test(stored), 'but it is stored encrypted');
  const list = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), env, {})).text();
  assert.ok(list.includes('<td class="one-line">1 of 5</td>') && codes.every(code => list.includes(code)), 'the owner sees the full code in the list');
  // One line per row (owner, 27 Oct 2026): Copy is a small icon at the start of the code.
  assert.match(list, /<span class="code-cell"><button type="button" class="copy"[^>]*aria-label="Copy the code"[\s\S]*?<\/button><span class="full" id="c-/);
  const other = await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: {Authorization: 'Bearer wrong'}}), env, {});
  assert.equal(other.status, 404, 'anyone else gets nothing');
  const keyless = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), {...env, PROMO_CODE_KEY: undefined}, {})).text();
  assert.ok(!codes.some(code => keyless.includes(code)) && keyless.includes('Made before full codes were kept: re-make it with the Code field to see it') && keyless.includes("Full codes can't be shown"), 'without the key the code cannot be shown, and the page says why');
  const wrongKey = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), {...env, PROMO_CODE_KEY: 'other'}, {})).text();
  assert.ok(!codes.some(code => wrongKey.includes(code)), 'a wrong key fails closed');
  assert.match(newCode(), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

const make = (env, fields) => worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {method: 'POST', headers: {...OWNER, Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({action: 'generate', label: 'mine', cap: '3', ends: '2999-12-31', ...fields})}), env, {});

test('the owner can type his own code: saved, redeemable in any case or spacing, shown in the list', async () => {
  const env = site({PROMO_CODE_KEY: 'test-key'}), mine = 'Test-Own-Code7';
  const made = await make(env, {code: ` ${mine} `});
  assert.equal(made.status, 200);
  const text = await made.text();
  assert.ok(text.includes(mine) && text.includes('It also stays in the list below'));
  assert.equal((await redeem(env, A, 'test own code7')).status, 200, 'normalised like the redeem check');
  const list = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), env, {})).text();
  assert.ok(list.includes(mine), 'full code in the list');
  assert.ok(!JSON.stringify((await env.STATS.prepare('SELECT * FROM pro_promo_codes').all()).results).includes(mine), 'not stored in plain text');
});

test('a typed code that is too short, has other characters, or already exists is refused and makes nothing', async () => {
  const env = site({PROMO_CODE_KEY: 'test-key'}), count = async () => (await env.STATS.prepare('SELECT COUNT(*) AS n FROM pro_promo_codes').first()).n;
  for (const [code, message] of [['short7-', 'at least 8'], ['has space!!ok', 'letters, digits and dashes'], ['emoji-code-🎟', 'letters, digits and dashes'], ['--ab--cd--', 'at least 8']]) {
    const res = await make(env, {code});
    assert.equal(res.status, 400, code); assert.ok((await res.text()).includes(message), code);
  }
  assert.equal(await count(), 0);
  assert.equal((await make(env, {code: 'Own-Code-1234'})).status, 200);
  const twice = await make(env, {code: 'own code 1234'.replace(/ /g, '-').toLowerCase()});
  assert.equal(twice.status, 400); assert.ok((await twice.text()).includes('That code already exists'));
  assert.equal(await count(), 1);
});

test('empty Code still makes a random one; with no key the page says so and fails closed', async () => {
  const env = site();
  const text = await (await make(env, {code: ''})).text();
  assert.match(text, /\b[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\b/);
  assert.ok(text.includes("Full codes can't be shown: the site's PROMO_CODE_KEY is not set") && !text.includes('It also stays in the list below'));
  assert.ok(text.includes('Made before full codes were kept: re-make it with the Code field to see it'), 'a row without its copy says how to get it');
  const keyed = await (await worker.fetch(new Request(`${ORIGIN}/admin/growth/promo-codes`, {headers: OWNER}), site({PROMO_CODE_KEY: 'k', STATS: env.STATS}), {})).text();
  assert.ok(!keyed.includes("Full codes can't be shown"), 'no notice when the key is set');
});

// Every value cell is a chip (owner, 27 Oct 2026: "this column values/cells should be displayed as chips"): each State the page can draw, and each kind in Gives.
test('the admin draws every state and every kind as a chip: green Active, amber Used up, grey Revoked and Expired', () => {
  const now = Date.parse('2026-10-27T12:00:00Z'), code = {ends_at: '2026-12-31T23:59:59Z', cap: 2};
  const cases = [[code, 0, 'good">Active'], [code, 2, 'warn">Used up'], [{...code, revoked_at: '2026-10-01'}, 0, 'off">Revoked'], [{...code, ends_at: '2026-10-01T00:00:00Z'}, 0, 'off">Expired']];
  for (const [row, used, want] of cases) assert.equal(stateChip(row, used, now), `<span class="chip ${want}</span>`);
  assert.equal(givesChip({kind: 'credit', credit_eur: 10}), '<span class="chip credit">€10 top-up</span>');
  assert.equal(givesChip({kind: 'pro'}), '<span class="chip pro">Pro upgrade</span>');
});
