// The CI's small stores (admin/ci-state.js) and the owner's buttons on the Bug loop page: who may read or write which key, the append and tick rules, Forget and the two POSTs.
// Replaces the pinned issues #274 (noise register), #2736 (verdict audit) and #2817 (red main).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appended, forgotten, readState, route, ticked} from '../../../admin/ci-state.js';
import {view} from '../../../admin/selfheal.js';

// A D1 stand-in that keeps the ci_state rows in a Map.
function fakeEnv(rows = new Map()) {
  const STATS = {prepare: sql => ({bind: (...args) => ({
    first: async () => (/^SELECT/.test(sql) ? (rows.has(args[0]) ? {body: rows.get(args[0])} : null) : null),
    run: async () => { rows.set(args[0], args[1]); return {}; }})})};
  return {rows, env: {STATS, SELFHEAL_PUBLISH_KEY: 'ci-key', STATS_KEY: 'owner-key'}};
}
const call = (env, key, method, body, auth = 'Bearer ci-key') => route(new Request(`https://x.dev/ci-state/${key}`, {method, headers: auth ? {Authorization: auth} : {}, body}), env, key);

test('positive control: CI writes red-main, anyone reads it; the other keys need the CI key', async () => {
  const {env} = fakeEnv();
  assert.equal((await call(env, 'red-main', 'PUT', JSON.stringify({at: 'x', reds: [{suite: 'apply'}]}))).status, 200);
  assert.deepEqual(await (await call(env, 'red-main', 'GET', undefined, '')).json(), {at: 'x', reds: [{suite: 'apply'}]});
  assert.equal((await call(env, 'noise-register', 'GET', undefined, '')).status, 404);
  assert.equal((await call(env, 'verdict-audit', 'GET', undefined, 'Bearer wrong')).status, 404);
  assert.equal((await call(env, 'red-main', 'PUT', '{}', '')).status, 404);
  assert.equal((await call(env, 'other', 'GET')).status, 404);
});

test('a PUT is checked for size and shape; only the register takes a POST', async () => {
  const {env} = fakeEnv();
  assert.equal((await call(env, 'red-main', 'PUT', 'nope')).status, 400);
  assert.equal((await call(env, 'red-main', 'PUT', '[]')).status, 400);
  assert.equal((await call(env, 'red-main', 'PUT', ` ${'x'.repeat(300001)}`)).status, 413);
  assert.equal((await call(env, 'red-main', 'POST', '{}')).status, 404);
});

test('a PUT with a null inside a list is refused, so one bad CI write cannot make a page throw; one POST with a repeated id appends it once', async () => {
  const {env} = fakeEnv();
  for (const [key, body] of [['noise-register', {entries: [null]}], ['verdict-audit', {audits: [{items: 'x'}]}], ['red-main', {reds: [null]}], ['red-main', {reds: [{suite: 'a', tested: [null]}]}]]) {
    assert.equal((await call(env, key, 'PUT', JSON.stringify(body))).status, 400, key);
  }
  assert.equal((await call(env, 'red-main', 'PUT', JSON.stringify({reds: [{suite: 'a', tested: [['abc', 'failure']]}]}))).status, 200);
  await call(env, 'noise-register', 'POST', JSON.stringify({entries: [{id: 'a'}, {id: 'a'}]}));
  assert.equal((await readState(env, 'noise-register', null)).entries.length, 1);
});

test('the register is appended on the server: an id already there is kept, the oldest go past 300, a Forget removes one', async () => {
  const {env} = fakeEnv();
  await call(env, 'noise-register', 'POST', JSON.stringify({entries: [{id: 'a', title: 'first'}, {id: 'b'}]}));
  await call(env, 'noise-register', 'POST', JSON.stringify({entries: [{id: 'a', title: 'again'}, {id: 'c'}, {title: 'no id'}]}));
  const state = await readState(env, 'noise-register', null);
  assert.deepEqual(state.entries.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(state.entries[0].title, 'first');
  assert.equal(appended({entries: Array.from({length: 300}, (_, i) => ({id: `o${i}`}))}, [{id: 'new'}]).entries.length, 300);
  assert.deepEqual(forgotten(state, 'b').entries.map(item => item.id), ['a', 'c']);
});

test('a tick lands on the open audit only, can be changed or cleared, and never on a closed one', () => {
  const audits = [{week: '2026-11-07', closed: null, items: [{key: 'i1', tick: null}, {key: 'i2', tick: null}]}, {week: '2026-10-31', closed: 'x', items: [{key: 'i9', tick: 'right'}]}];
  const right = ticked({audits}, 'i1', 'right');
  assert.equal(right.audits[0].items[0].tick, 'right');
  assert.equal(ticked({audits: right.audits}, 'i1', 'wrong').audits[0].items[0].tick, 'wrong');
  assert.equal(ticked({audits: right.audits}, 'i1', '').audits[0].items[0].tick, null);
  assert.equal(ticked({audits}, 'i9', 'wrong').changed, false);
  assert.equal(ticked({audits}, 'nope', 'wrong').changed, false);
  assert.equal(ticked({audits: [{...audits[0], closed: 'now'}]}, 'i1', 'right').changed, false);
});

async function ownerCookie(env) {
  const first = await view(new Request('https://x.dev/self-heal?key=owner-key'), env);
  return first.headers.get('Set-Cookie').split(';')[0];
}
const post = (env, cookie, fields, origin = 'https://x.dev') => view(new Request('https://x.dev/admin/testing/bug-loop', {method: 'POST', headers: {Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(fields).toString()}), env);

test('the owner presses Forget and a tick: both save and redirect back to their card; a stranger or another site is refused', async () => {
  const {env, rows} = fakeEnv(new Map([['noise-register', JSON.stringify({entries: [{id: 'a'}, {id: 'b'}]})], ['verdict-audit', JSON.stringify({audits: [{week: 'w', closed: null, items: [{key: 'i1', tick: null}]}]})]]));
  const cookie = await ownerCookie(env);
  const forgot = await post(env, cookie, {action: 'forget', id: 'a'});
  assert.equal(forgot.status, 303);
  assert.match(forgot.headers.get('Location'), /#noise$/);
  assert.deepEqual(JSON.parse(rows.get('noise-register')).entries, [{id: 'b'}]);
  const tick = await post(env, cookie, {action: 'tick', key: 'i1', value: 'wrong'});
  assert.match(tick.headers.get('Location'), /#audit$/);
  assert.equal(JSON.parse(rows.get('verdict-audit')).audits[0].items[0].tick, 'wrong');
  assert.equal((await post(env, cookie, {action: 'forget', id: 'b'}, 'https://evil.dev')).status, 404);
  assert.equal((await post(env, '', {action: 'forget', id: 'b'})).status, 404);
  assert.equal((await post(env, cookie, {action: 'nope'})).status, 400);
  assert.deepEqual(JSON.parse(rows.get('noise-register')).entries, [{id: 'b'}]);
});
