// Import from LinkedIn (api/linkedin-import.js): start sends the person to LinkedIn with the Data Portability scope; the callback trades the code
// server-side and keeps ONLY the sealed token (no profile data ever reaches this server); the app collects it once. Same shape as linkedin.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as imp from '../../api/linkedin-import.js';

function kv() {
  const data = new Map();
  return {data, get: async k => data.get(k) ?? null, put: async (k, v, o) => { data.set(k, v); data.ttl = o?.expirationTtl; }, delete: async k => { data.delete(k); }};
}
const SESSION = 'a'.repeat(43);
const TOKEN = 'AQV-fake-dma-token-1234567890';
const env = () => ({LINKEDIN_IMPORT_CLIENT_ID: 'import-id', LINKEDIN_IMPORT_CLIENT_SECRET: 'import-secret', WAITLIST: kv()});
const collect = (e, session = SESSION) => imp.collect(new Request('https://site/api/linkedin-import/token', {method: 'POST', body: JSON.stringify({session})}), e);
const fetcher = (calls = [], status = 200, body = {access_token: TOKEN, expires_in: 5184000, scope: 'r_dma_portability_3rd_party'}) =>
  async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify(body), {status}); };
const callback = (e, query = `code=c-1&state=${SESSION}`, f = fetcher()) => imp.callback(new Request(`https://site.test/api/linkedin-import/callback?${query}`), e, f);

test('start sends the person to LinkedIn with the Data Portability scope, the session as state and this site as the way back', () => {
  const response = imp.start(new Request(`https://site.test/api/linkedin-import/start?session=${SESSION}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('client_id'), 'import-id');
  assert.equal(to.searchParams.get('scope'), 'r_dma_portability_3rd_party');
  assert.equal(to.searchParams.get('state'), SESSION);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/linkedin-import/callback');
  assert.equal(imp.start(new Request('https://site.test/api/linkedin-import/start?session=short'), env()).status, 400);
  assert.equal(imp.start(new Request(`https://site.test/api/linkedin-import/start?session=${SESSION}`), {WAITLIST: kv()}).status, 400, 'unconfigured: a card, not a redirect');
});

test('the code is traded server-side; only the sealed token is kept, under a hash, for 10 minutes, and collected once', async () => {
  const e = env(), calls = [];
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true});
  const page = await callback(e, undefined, fetcher(calls));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connected to LinkedIn/);
  assert.equal(calls.length, 1, 'one call to LinkedIn: the token; the site never fetches the profile');
  assert.equal(calls[0].url, 'https://www.linkedin.com/oauth/v2/accessToken');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('client_secret'), 'import-secret');
  assert.equal(sent.get('redirect_uri'), 'https://site.test/api/linkedin-import/callback');
  const stored = [...e.WAITLIST.data.entries()];
  assert.equal(stored.length, 1);
  assert.equal(e.WAITLIST.data.ttl, 600);
  assert.ok(!stored[0][0].includes(SESSION), 'stored under a hash, not the session');
  assert.ok(!stored[0][1].includes(TOKEN), 'the token is encrypted at rest');
  assert.deepEqual(await (await collect(e, 'b'.repeat(43))).json(), {ok: false, pending: true}, 'another session gets nothing');
  assert.deepEqual(await (await collect(e)).json(), {ok: true, access_token: TOKEN, expires_in: 5184000});
  assert.deepEqual(await (await collect(e)).json(), {ok: false, pending: true}, 'gone after one read');
});

test('a sealed token cannot be opened with another session id (the key is not in the store)', async () => {
  const e = env();
  await callback(e);
  const [[key, value]] = [...e.WAITLIST.data.entries()];
  const other = 'c'.repeat(43);
  const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  e.WAITLIST.data.delete(key);
  e.WAITLIST.data.set(`linkedin-import:${await sha(other)}`, value);   // a reader of the store moves it under another session's hash
  assert.deepEqual(await (await collect(e, other)).json(), {ok: false, pending: true}, 'wrong key: nothing leaks');
});

test('declined, refused, broken, missing code or unconfigured: a clear card, nothing stored', async () => {
  const e = env();
  const refused = await callback(e, `error=access_denied&error_description=${encodeURIComponent('Member is not in the EEA <b>')}&state=${SESSION}`);
  assert.equal(refused.status, 400);
  const text = await refused.text();
  assert.match(text, /Member is not in the EEA &lt;b&gt;/, 'LinkedIn\'s reason, escaped');
  assert.match(text, /EU, EEA and Switzerland[^]*data file/);
  const bad = await callback(e, undefined, fetcher([], 400, {error: 'invalid_request', error_description: 'bad code'}));
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /bad code/);
  assert.equal((await callback(e, `state=${SESSION}`)).status, 400, 'no code');
  assert.equal((await callback(e, 'code=c&state=short')).status, 400, 'bad state');
  assert.equal((await callback({WAITLIST: kv()})).status, 400, 'unconfigured');
  assert.equal(e.WAITLIST.data.size, 0);
  assert.equal((await imp.collect(new Request('https://site/x', {method: 'POST', body: JSON.stringify({session: 'x'})}), e)).status, 400);
  assert.equal((await imp.collect(new Request('https://site/x'), e)).status, 405);
  assert.equal((await imp.collect(new Request('https://site/x', {method: 'POST', body: JSON.stringify({session: SESSION})}), {WAITLIST: kv()})).status, 503);
});

test('revoke asks LinkedIn to end the token with the secret and keeps nothing', async () => {
  const e = env(), calls = [];
  const post = (body, f) => imp.revoke(new Request('https://site/api/linkedin-import/revoke', {method: 'POST', body: JSON.stringify(body)}), e, f);
  assert.deepEqual(await (await post({token: TOKEN}, fetcher(calls, 200, {}))).json(), {ok: true});
  assert.equal(calls[0].url, 'https://www.linkedin.com/oauth/v2/revoke');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.deepEqual([sent.get('token'), sent.get('client_secret')], [TOKEN, 'import-secret']);
  assert.deepEqual(await (await post({token: TOKEN}, fetcher([], 400, {}))).json(), {ok: false}, 'LinkedIn refused: said so');
  assert.deepEqual(await (await post({token: TOKEN}, async () => { throw new Error('offline'); })).json(), {ok: false});
  assert.equal((await post({token: 'x'})).status, 400);
  assert.equal(e.WAITLIST.data.size, 0);
});
