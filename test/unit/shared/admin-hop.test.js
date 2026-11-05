// The owner's /admin sign-in carried from the old host to the main one (shared/admin-hop.js): once, within a minute, same path only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {SESSION_COOKIE, isOwner, sessionToken} from '../../../shared/auth.js';
import {hopIn, hopOut, safeTo} from '../../../shared/admin-hop.js';

const now = Date.parse('2026-10-21T12:00:00Z');
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => m.set(k, v), list: async ({prefix}) => ({keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({name}))})}; };
const env = () => ({STATS_KEY: 'owner-key', WAITLIST: kv()});
const page = (host, path, headers = {}) => new Request(`https://${host}${path}`, {headers: {Accept: 'text/html', ...headers}});
const owner = async e => ({Cookie: `${SESSION_COOKIE}=${await sessionToken(e, now)}`});
async function hopUrl(e, path = '/admin/ai/costs?days=7') {
  const out = await hopOut(page('www.jobpilotto.top', path, await owner(e)), e, now);
  assert.equal(out.status, 302);
  return out.headers.get('Location');
}

test('a signed-in owner on the old host is hopped once, and lands signed in on the main host', async () => {
  const e = env(), location = await hopUrl(e);
  assert.match(location, /^https:\/\/www\.jobadabra\.top\/admin\/hop\?t=h1\./);
  assert.ok(!location.includes('owner-key'));
  const first = await hopIn(page('www.jobadabra.top', new URL(location).pathname + new URL(location).search), e, now + 1000);
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('Location'), '/admin/ai/costs?days=7');
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /^jp_admin=v1\./);
  assert.equal(await isOwner(page('www.jobadabra.top', '/admin', {Cookie: cookie.split(';')[0]}), e, now + 2000), true);
  const again = await hopIn(page('www.jobadabra.top', new URL(location).pathname + new URL(location).search), e, now + 3000);
  assert.equal(again.status, 404);   // a second use
  assert.equal(again.headers.get('Set-Cookie'), null);
});

test('an expired, forged or re-aimed token is a 404', async () => {
  const e = env(), location = await hopUrl(e), u = new URL(location);
  const ask = (t, to, at = now + 1000) => hopIn(page('www.jobadabra.top', `/admin/hop?t=${encodeURIComponent(t)}&to=${encodeURIComponent(to)}`), e, at);
  const t = u.searchParams.get('t'), to = u.searchParams.get('to');
  assert.equal((await ask(t, to, now + 61000)).status, 404);   // expired
  assert.equal((await ask(t.slice(0, -2) + (t.endsWith('xx') ? 'yy' : 'xx'), to)).status, 404);   // forged signature
  assert.equal((await ask(t, '/admin/agents/access')).status, 404);   // signed for another path
  assert.equal((await hopIn(page('www.jobadabra.top', '/admin/hop'), e, now)).status, 404);
  const other = {...e, STATS_KEY: 'other'};
  assert.equal((await hopIn(page('www.jobadabra.top', `/admin/hop?t=${encodeURIComponent(t)}&to=${encodeURIComponent(to)}`), other, now + 1000)).status, 404);
  assert.equal((await ask(t, to)).status, 302);   // the good one still works after the bad tries
});

test('to must be a same-origin /admin path', () => {
  for (const to of ['https://evil.example/admin', '//evil.example', '/admin//evil.example', '/admin/../x', '/other', '/admin\\x', 'admin', '', '/admin?next=https://x']) assert.equal(safeTo(to), false, to);
  for (const to of ['/admin', '/admin/ai/costs?days=7', '/admin/testing/e2e']) assert.equal(safeTo(to), true, to);
});

test('only an owner cookie on an old host, asking for a page, is hopped; no or a forged cookie is sent on without one', async () => {
  const e = env(), c = await owner(e);
  const plain = async headers => (await hopOut(page('www.jobpilotto.top', '/admin/growth/app?days=7', headers), e, now))?.headers.get('Location');
  assert.equal(await plain({}), 'https://www.jobadabra.top/admin/growth/app?days=7');   // no cookie: same page there, no token
  assert.equal(await plain({Cookie: 'jp_admin=v1.1792000000.' + 'a'.repeat(43)}), 'https://www.jobadabra.top/admin/growth/app?days=7');   // forged cookie
  assert.equal(await hopOut(page('www.jobadabra.top', '/admin', c), e, now), null);   // the main host serves it
  assert.match((await hopOut(page('www.jobpilotto.workers.dev', '/admin', c), e, now)).headers.get('Location'), /^https:\/\/www\.jobadabra\.top\/admin\/hop\?t=h1\./);
  assert.equal(await hopOut(page('www-staging.jobpilotto.workers.dev', '/admin', c), e, now), null);   // staging is its own worker
  assert.equal(await hopOut(page('www.jobpilotto.top', '/admin', {...c, Authorization: 'Bearer x'}), e, now), null);   // scripts
  assert.equal(await hopOut(page('www.jobpilotto.top', '/admin?key=k', c), e, now), null);
  assert.equal(await hopOut(page('www.jobpilotto.top', '/admin/growth/app', {...c, Accept: 'application/json'}), e, now), null);   // a fetch, not a page
  assert.equal(await hopOut(new Request('https://www.jobpilotto.top/admin', {method: 'POST', headers: {Accept: 'text/html', ...c}}), e, now), null);
  assert.equal(await hopOut(page('www.jobpilotto.top', '/api/index', c), e, now), null);
});

test('through the worker: a non-owner on the old host is sent to the same page there, an owner through the hop', async () => {
  const e = {...env(), ASSETS: {fetch: async () => new Response('page')}};
  const plain = await worker.fetch(page('www.jobpilotto.top', '/admin'), e, {});
  assert.equal(plain.status, 302);
  assert.equal(plain.headers.get('Location'), 'https://www.jobadabra.top/admin');
  assert.equal((await worker.fetch(page('www.jobadabra.top', '/admin'), e, {})).status, 404);   // and there, signed out, the usual 404
  assert.equal((await worker.fetch(page('www.jobadabra.top', '/admin/hop?t=x&to=/admin'), e, {})).status, 404);
  const real = await worker.fetch(page('www.jobpilotto.top', '/admin', await owner(e)), e, {});
  assert.equal(real.status, 302);
  assert.match(real.headers.get('Location'), /^https:\/\/www\.jobadabra\.top\/admin\/hop\?t=/);
});

test('the used-token marker never shows in the waitlist listing, and no URL with a token is logged', async () => {
  const e = env(), u = new URL(await hopUrl(e));
  await hopIn(page('www.jobadabra.top', u.pathname + u.search), e, now + 1000);
  assert.deepEqual([...e.WAITLIST.m.keys()].map(k => k.split(':')[0]), ['admin-hop']);
  assert.equal((await e.WAITLIST.list({prefix: 'signup:'})).keys.length, 0);   // shared/traffic.js lists 'signup:'
  const lines = [], log = console.log; console.log = line => lines.push(String(line));
  try { await worker.fetch(page('www.jobadabra.top', u.pathname + u.search), {...e, STATS: {prepare: () => ({bind: () => ({run: async () => ({}), first: async () => null, all: async () => ({results: []})})})}}, {}); } finally { console.log = log; }
  assert.ok(lines.every(l => !l.includes('h1.') && !l.includes(u.searchParams.get('t'))));
});
