// Every connect / sign-in hand-off (api/notion.js, api/linkedin.js) goes through shared/oauth-handoff.js: the result is redirected to the app on the CONSENTING browser's own
// machine and nothing is kept for anyone to collect. Plays the attack for each flow: someone else's link with their own id, then asking for the result with that id.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import * as linkedin from '../../../api/linkedin.js';
import * as notion from '../../../api/notion.js';
import * as imp from '../../../api/linkedin-import.js';
import {APP_ORIGIN, FLOWS, UPDATE_TEXT, legacyPoll, toApp} from '../../../shared/oauth-handoff.js';
import {handedOff} from './handoff-form.js';

const ATTACKER = 'z'.repeat(43);   // an id the attacker chose and put in the link
const trap = () => new Proxy({}, {get: name => () => { throw new Error(`the hand-off touched storage (${String(name)})`); }});   // any use of KV fails the test
const FLOW = {
  notion: {mod: notion, flow: 'notion-connect', env: {NOTION_CLIENT_ID: 'c', NOTION_CLIENT_SECRET: 's', WAITLIST: trap()},
    fetcher: async () => new Response(JSON.stringify({access_token: 'ntn_victim_FAKE', workspace_name: 'Victim Space', workspace_id: 'w1'}), {status: 200}), secretField: 'access_token', secret: 'ntn_victim_FAKE'},
  linkedin: {mod: linkedin, flow: 'linkedin-signin', env: {LINKEDIN_CLIENT_ID: 'c', LINKEDIN_CLIENT_SECRET: 's', WAITLIST: trap()},
    fetcher: async url => new Response(JSON.stringify(String(url).includes('accessToken') ? {access_token: 'AQ-victim-FAKE'} : {sub: 'sub1', name: 'Victim Person', email: 'victim@example.test', email_verified: true}), {status: 200}),
    secretField: 'email', secret: 'victim@example.test'},
};

for (const [name, spec] of Object.entries(FLOW)) {
  test(`${name}: the result of a victim's consent goes to the victim's own machine, never to a store the attacker's id can read`, async () => {
    const {mod, env, fetcher} = spec;
    const link = mod.start(new Request(`https://site.test/api/${name}/start?state=${ATTACKER}`), env);   // the attacker's link, opened by the victim
    assert.equal(link.status, 302);
    const back = await mod.callback(new Request(`https://site.test/api/${name}/callback?code=c1&state=${ATTACKER}`), env, fetcher);   // the victim approved; env.WAITLIST throws on any use
    assert.equal(back.headers.get('Location'), null, 'no redirect: the result never travels in an address (it would stay in the browser history)');
    const sent = await handedOff(back);
    assert.equal(sent.method, 'post');
    assert.equal(sent.action, `${APP_ORIGIN}/${spec.flow}/callback`, 'only the victim\'s own machine, a fixed address');
    assert.equal(new URL(sent.action).search, '');
    assert.equal(sent.fields.state, ATTACKER);
    assert.equal(sent.fields[spec.secretField], spec.secret);
    assert.equal(back.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(back.headers.get('Cache-Control'), /no-store/);
    // The attacker asks for the result with the id they chose (the old way): there is nothing to hand out.
    const asked = await mod.collect(new Request(`https://site.test/api/${name}/token`, {method: 'POST', body: JSON.stringify({session: ATTACKER})}), env);
    const text = await asked.text();
    assert.equal(asked.status, 410);
    assert.ok(!text.includes(spec.secret) && !JSON.parse(text).ok, 'the old poll gives nothing');
  });

  test(`${name}: an installed app's old start (?session=) is told to update, and nothing is started`, async () => {
    const old = spec.mod.start(new Request(`https://site.test/api/${name}/start?session=${ATTACKER}`), spec.env);
    assert.equal(old.status, 410);
    assert.match(await old.text(), /Update Jobadabra/);
    assert.equal(old.headers.get('Location'), null);
  });

  test(`${name}: nothing stored, nothing to poll, in the source`, () => {
    const source = readFileSync(new URL(`../../../api/${name}.js`, import.meta.url), 'utf8');
    assert.ok(!/WAITLIST|expirationTtl|\.put\(/.test(source.replace(/\/\/.*$/gm, '')), 'no store in the route code');
    assert.ok(source.includes('toApp('), 'the result leaves through the shared hand-off');
  });
}

test('the hand-off page escapes what it carries and the import flow uses it too', async () => {
  const hostile = await handedOff(toApp('notion-connect', ATTACKER, {workspace_name: '"><script>steal()</script>'}));
  assert.ok(!hostile.html.includes('<script>steal()'), 'a value cannot break out of its field');
  assert.equal(hostile.fields.workspace_name, '"><script>steal()</script>', 'and arrives intact');
  const ok = await handedOff(await imp.callback(new Request(`https://site.test/api/linkedin-import/callback?code=c&state=${ATTACKER}`), {LINKEDIN_IMPORT_CLIENT_ID: 'i', LINKEDIN_IMPORT_CLIENT_SECRET: 's'},
    async () => new Response(JSON.stringify({access_token: 'AQV-FAKE-token-123456789012', expires_in: 5184000}), {status: 200})));
  assert.equal(ok.action, `${APP_ORIGIN}/linkedin-import/callback`);
  assert.equal(ok.fields.access_token, 'AQV-FAKE-token-123456789012');
});

test('the shared hand-off only knows its own flows and the update answer carries no data', async () => {
  assert.deepEqual(FLOWS, ['notion-connect', 'linkedin-signin', 'linkedin-import']);
  assert.throws(() => toApp('other', ATTACKER, {}), /unknown hand-off flow/);
  const gone = legacyPoll();
  assert.deepEqual(await gone.json(), {ok: false, gone: true, error: UPDATE_TEXT});
});

test('the class: every api file with an OAuth callback hands its result over through the shared hand-off (no new store-and-poll flow)', () => {
  const dir = new URL('../../../api/', import.meta.url);
  const withCallback = readdirSync(dir).filter(name => name.endsWith('.js') && /export (async )?function callback\(/.test(readFileSync(new URL(name, dir), 'utf8')));
  assert.ok(['notion.js', 'linkedin.js', 'linkedin-import.js'].every(name => withCallback.includes(name)), `positive control: ${withCallback}`);
  for (const name of withCallback) assert.ok(readFileSync(new URL(name, dir), 'utf8').includes("from '../shared/oauth-handoff.js'"), `${name} must use shared/oauth-handoff.js`);
});
