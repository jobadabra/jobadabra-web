// Connect with LinkedIn (api/linkedin.js): start sends the user to LinkedIn with the app's own `state`; the callback trades the code server-side and hands ONLY the OpenID profile
// (never the token) to the app on the consenting browser's machine, keeping nothing. The attack is played in test/unit/shared/oauth-handoff.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as linkedin from '../../../api/linkedin.js';
import {handedOff} from '../shared/handoff-form.js';

const STATE = 'a'.repeat(43);
const env = () => ({LINKEDIN_CLIENT_ID: 'id-1', LINKEDIN_CLIENT_SECRET: 'secret-1'});
const INFO = {sub: 'abc123', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', email_verified: true, locale: {country: 'CH', language: 'en'}, picture: 'https://media.licdn.com/x.jpg'};
const fetcher = (info = INFO, calls = []) => async (url, init) => {
  calls.push({url, init});
  if (String(url).includes('accessToken')) return new Response(JSON.stringify({access_token: 'AQ-secret-token', expires_in: 5184000}), {status: 200});
  return new Response(JSON.stringify(info), {status: 200});
};
const callback = (e, f) => linkedin.callback(new Request(`https://site.test/api/linkedin/callback?code=c-1&state=${STATE}`), e, f);

test('start sends the user to LinkedIn with the state, the scopes and this site as the way back', () => {
  const response = linkedin.start(new Request(`https://site.test/api/linkedin/start?state=${STATE}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('client_id'), 'id-1');
  assert.equal(to.searchParams.get('state'), STATE);
  assert.equal(to.searchParams.get('scope'), 'openid profile email');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/linkedin/callback');
  assert.equal(linkedin.start(new Request('https://site.test/api/linkedin/start?state=short'), env()).status, 400);
});

test('the code is traded server-side; only the profile is posted to the app\'s own socket, never the LinkedIn token or the picture', async () => {
  const calls = [];
  const back = await callback(env(), fetcher(INFO, calls));
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('client_secret'), 'secret-1');
  assert.equal(body.get('redirect_uri'), 'https://site.test/api/linkedin/callback');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer AQ-secret-token');
  const sent = await handedOff(back);
  assert.equal(sent.action, 'http://127.0.0.1:47111/linkedin-signin/callback');
  assert.deepEqual(sent.fields, {state: STATE, sub: 'abc123', name: 'Ada Example', given_name: 'Ada', family_name: 'Example', email: 'ada@example.test', locale: 'en'});
  assert.ok(!sent.html.includes('AQ-secret-token') && !sent.html.includes('licdn'));
});

test('an unverified email is not passed on; cancelled, broken or unconfigured: a clear page, nothing handed on', async () => {
  const unverified = await callback(env(), fetcher({...INFO, email_verified: false}));
  assert.equal((await handedOff(unverified)).fields.email, '');
  assert.equal((await linkedin.callback(new Request(`https://site.test/api/linkedin/callback?error=user_cancelled_login&state=${STATE}`), env())).status, 400);
  const bad = async () => new Response(JSON.stringify({error: 'invalid_request', error_description: 'bad code'}), {status: 400});
  const page = await callback(env(), bad);
  assert.equal(page.status, 400);
  assert.match(await page.text(), /bad code/);
  assert.equal(linkedin.start(new Request(`https://site.test/api/linkedin/start?state=${STATE}`), {}).status, 400);
});
