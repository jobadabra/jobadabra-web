// Import from LinkedIn (api/linkedin-import.js): start sends the person to LinkedIn with the Data Portability scope; the callback trades the code server-side
// and passes the token ON to the app on the consenting browser's own machine, keeping nothing. The class this guards (Gitar, web#336): a token held under an id
// anyone can name is a token anyone can take. Same shape as linkedin.test.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as imp from '../../api/linkedin-import.js';
import {handedOff} from '../shared/handoff-form.js';

const STATE = 'a'.repeat(43);
const TOKEN = 'AQV-fake-dma-token-1234567890';
const env = () => ({LINKEDIN_IMPORT_CLIENT_ID: 'import-id', LINKEDIN_IMPORT_CLIENT_SECRET: 'import-secret'});
const fetcher = (calls = [], status = 200, body = {access_token: TOKEN, expires_in: 5184000, scope: 'r_dma_portability_3rd_party'}) =>
  async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify(body), {status}); };
const callback = (e, query = `code=c-1&state=${STATE}`, f = fetcher()) => imp.callback(new Request(`https://site.test/api/linkedin-import/callback?${query}`), e, f);

test('start sends the person to LinkedIn with the Data Portability scope, the app\'s state and this site as the way back', () => {
  const response = imp.start(new Request(`https://site.test/api/linkedin-import/start?state=${STATE}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('client_id'), 'import-id');
  assert.equal(to.searchParams.get('scope'), 'r_dma_portability_3rd_party');
  assert.equal(to.searchParams.get('state'), STATE);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/linkedin-import/callback');
  assert.equal(imp.start(new Request('https://site.test/api/linkedin-import/start?state=short'), env()).status, 400);
  assert.equal(imp.start(new Request(`https://site.test/api/linkedin-import/start?state=${STATE}`), {}).status, 400, 'unconfigured: a card, not a redirect');
});

test('the code is traded server-side and the token goes ON to the app on the browser\'s own machine; nothing is kept', async () => {
  const calls = [], e = env();
  const response = await callback(e, undefined, fetcher(calls));
  const sent2 = await handedOff(response);
  assert.equal(sent2.action, 'http://127.0.0.1:47111/linkedin-import/callback', 'only the loopback of the machine that consented, a fixed address (not a parameter)');
  assert.deepEqual([sent2.fields.state, sent2.fields.access_token, sent2.fields.expires_in], [STATE, TOKEN, '5184000']);
  assert.equal(response.headers.get('Location'), null, 'the key is in the form body, never in an address');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(calls.length, 1, 'one call to LinkedIn: the token; the site never fetches the profile');
  assert.equal(calls[0].url, 'https://www.linkedin.com/oauth/v2/accessToken');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(sent.get('client_secret'), 'import-secret');
  assert.equal(sent.get('redirect_uri'), 'https://site.test/api/linkedin-import/callback');
  assert.deepEqual(Object.keys(e), ['LINKEDIN_IMPORT_CLIENT_ID', 'LINKEDIN_IMPORT_CLIENT_SECRET'], 'no store is needed or touched');
});

test('an attacker\'s link cannot move the token off the victim\'s machine: the way back is fixed, whatever the link says', async () => {
  const evil = await callback(env(), `code=c&state=${STATE}&redirect_uri=https://evil.test/x&port=9999&to=https://evil.test`);
  const evilSent = await handedOff(evil);
  assert.equal(evilSent.action, 'http://127.0.0.1:47111/linkedin-import/callback');
  assert.ok(!JSON.stringify(Object.keys(evilSent.fields)).includes('evil') && !evilSent.html.includes('evil.test'), 'nothing the link says reaches the page');
  const source = readFileSync(new URL('../../api/linkedin-import.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /WAITLIST|\.put\(|expirationTtl/, 'this module stores nothing (the first design held the token under an id anyone could name)');
});

test('declined, refused, broken, missing code or unconfigured: a clear card, nothing passed on', async () => {
  const refused = await callback(env(), `error=access_denied&error_description=${encodeURIComponent('Member is not in the EEA <b>')}&state=${STATE}`);
  assert.equal(refused.status, 400);
  const text = await refused.text();
  assert.match(text, /Member is not in the EEA &lt;b&gt;/, 'LinkedIn\'s reason, escaped');
  assert.match(text, /EU, EEA and Switzerland[^]*data file/);
  const bad = await callback(env(), undefined, fetcher([], 400, {error: 'invalid_request', error_description: 'bad code'}));
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /bad code/);
  assert.equal((await callback(env(), `state=${STATE}`)).status, 400, 'no code');
  assert.equal((await callback(env(), 'code=c&state=short')).status, 400, 'bad state');
  assert.equal((await callback({})).status, 400, 'unconfigured');
});

test('revoke asks LinkedIn to end the token with the secret and keeps nothing', async () => {
  const calls = [];
  const post = (body, f) => imp.revoke(new Request('https://site/api/linkedin-import/revoke', {method: 'POST', body: JSON.stringify(body)}), env(), f);
  assert.deepEqual(await (await post({token: TOKEN}, fetcher(calls, 200, {}))).json(), {ok: true});
  assert.equal(calls[0].url, 'https://www.linkedin.com/oauth/v2/revoke');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.deepEqual([sent.get('token'), sent.get('client_secret')], [TOKEN, 'import-secret']);
  assert.deepEqual(await (await post({token: TOKEN}, fetcher([], 400, {}))).json(), {ok: false}, 'LinkedIn refused: said so');
  assert.deepEqual(await (await post({token: TOKEN}, async () => { throw new Error('offline'); })).json(), {ok: false});
  assert.equal((await post({token: 'x'})).status, 400);
  assert.equal((await imp.revoke(new Request('https://site/x'), env())).status, 405);
});
