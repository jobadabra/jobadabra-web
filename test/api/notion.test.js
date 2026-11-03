// Connect with Notion (api/notion.js): start sends the user to Notion with the app's own `state`; the callback trades the code server-side and hands the token to the app on the
// consenting browser's machine, keeping nothing. The attack (another person's id) is played in test/shared/oauth-handoff.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../../api/notion.js';

const STATE = 'a'.repeat(43);
const env = () => ({NOTION_CLIENT_ID: 'client-1', NOTION_CLIENT_SECRET: 'secret-1'});

test('start sends the user to Notion with the state and this site as the way back', () => {
  const response = notion.start(new Request(`https://site.test/api/notion/start?state=${STATE}`), env());
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://api.notion.com/v1/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), 'client-1');
  assert.equal(to.searchParams.get('state'), STATE);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://site.test/api/notion/callback');
  assert.equal(notion.start(new Request('https://site.test/api/notion/start?state=short'), env()).status, 400);
});

test('the code is traded for the token server-side and the token goes to the app\'s own socket, with the workspace and template', async () => {
  let sent;
  const fetcher = async (url, init) => { sent = {url, init}; return new Response(JSON.stringify({access_token: 'ntn_user', workspace_name: 'Ada\'s Space', duplicated_template_id: 'tpl'}), {status: 200}); };
  const back = await notion.callback(new Request(`https://site.test/api/notion/callback?code=c-1&state=${STATE}`), env(), fetcher);
  assert.equal(sent.init.headers.Authorization, `Basic ${btoa('client-1:secret-1')}`);
  assert.equal(JSON.parse(sent.init.body).redirect_uri, 'https://site.test/api/notion/callback');
  assert.equal(back.status, 302);
  const to = new URL(back.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'http://127.0.0.1:47111/notion-connect/callback');
  assert.deepEqual(Object.fromEntries(to.searchParams), {state: STATE, access_token: 'ntn_user', workspace_name: 'Ada\'s Space', workspace_id: '', duplicated_template_id: 'tpl'});
});

test('cancelled, broken or unconfigured: a clear page, nothing handed on', async () => {
  assert.equal((await notion.callback(new Request(`https://site.test/api/notion/callback?error=access_denied&state=${STATE}`), env())).status, 400);
  const refused = async () => new Response(JSON.stringify({error: 'invalid_grant'}), {status: 400});
  const page = await notion.callback(new Request(`https://site.test/api/notion/callback?code=x&state=${STATE}`), env(), refused);
  assert.equal(page.status, 400);
  assert.match(await page.text(), /invalid_grant/);
  assert.equal((await notion.callback(new Request(`https://site.test/api/notion/callback?code=x&state=${STATE}`), {}, refused)).status, 400);
});
