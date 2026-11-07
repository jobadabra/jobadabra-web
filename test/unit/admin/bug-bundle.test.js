// /admin/bug-bundle/<id> (admin/bug-bundle.js): the page of one tester bug, opened from its GitHub issue; signed-out is a 404, a missing bundle says it is not kept, words from the store are escaped, and the page links only to files it has.
// Guard: privacy — the page of a twin bundle shows the owner's real data to a signed-in admin only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bundleHtml, shell, view} from '../../../admin/bug-bundle.js';

const REPORT = {source: 'desktop-tester', journey: 'J12', severity: 'high', title: 'Phone <b>wrong</b>', expected: 'Typed phone shown', seen: 'Label shown', steps: ['Open Profile'], at: '2026-11-07T09:58:00Z'};
const store = files => ({get: async key => (files[key] ? {text: async () => files[key], body: files[key]} : null), head: async key => (files[key] ? {size: 1} : null)});
const ID = '0123456789abcdef';
const open = (env, path = `/admin/bug-bundle/${ID}`, key = 'owner-key') => view(new Request(`https://x.test${path}`, {headers: key ? {Authorization: `Bearer ${key}`} : {}}), env);
const env = files => ({LAB_FILLS: store(files), STATS_API_KEY: 'owner-key', STATS_KEY: 'k'});

test('signed out, a bad id or an extra path is a 404; a bundle that is not kept says so', async () => {
  assert.equal((await open(env({}), undefined, null)).status, 404);
  assert.equal((await open(env({}), '/admin/bug-bundle/nope')).status, 404);
  assert.equal((await open(env({}), `/admin/bug-bundle/${ID}/logs.txt/more`)).status, 404);
  const gone = await open(env({}));
  assert.equal(gone.status, 404);
  assert.match(await gone.text(), /not kept/);
});

test('a kept bundle is drawn with its words escaped, its pictures and files only when they exist, and the replay command', async () => {
  const files = {[`bundle/${ID}/report.json`]: JSON.stringify(REPORT), [`bundle/${ID}/app.jpg`]: 'x', [`bundle/${ID}/logs.txt`]: 'l'};
  const answer = await open(env(files));
  assert.equal(answer.status, 200);
  const html = await answer.text();
  assert.match(html, /Phone &lt;b&gt;wrong&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>wrong</b>'));
  assert.match(html, new RegExp(`src="/admin/bug-bundle/${ID}/app.jpg"`));
  assert.match(html, /Not in this bundle: the job tab/);
  assert.match(html, new RegExp(`href="/admin/bug-bundle/${ID}/logs.txt"`));
  assert.ok(!html.includes('state.json"'), 'no link to a file the bundle does not have');
  assert.match(html, new RegExp(`npm run twin -- --replay ${ID}`));
  assert.match(html, /Claude Desktop \(a copy of real data\)/);
});

test('a stored word like "constructor" for severity or source does not find the table\'s prototype', () => {
  const html = bundleHtml({...REPORT, severity: 'constructor', source: 'constructor'}, {}, ID);
  assert.match(html, /\? severity/);
  assert.match(html, /tester/);
});

test('the file route of the page is the shared one: a stored file streams for an admin', async () => {
  const files = {[`bundle/${ID}/report.json`]: JSON.stringify(REPORT), [`bundle/${ID}/state.json`]: '{"s":1}'};
  assert.equal((await open(env(files), `/admin/bug-bundle/${ID}/state.json`)).status, 200);
  assert.equal((await open(env(files), `/admin/bug-bundle/${ID}/state.json`, null)).status, 404);
});

test('the route answers inside the Admin shell (stylesheet and top bar), a file answer passes untouched', async () => {
  const files = {[`bundle/${ID}/report.json`]: JSON.stringify(REPORT), [`bundle/${ID}/state.json`]: '{"s":1}'};
  const ask = path => shell(new Request(`https://x.test${path}`, {headers: {Authorization: 'Bearer owner-key'}}), env(files), path);
  const html = await (await ask(`/admin/bug-bundle/${ID}`)).text();
  assert.match(html, /<nav/);
  assert.match(html, /background:#0b0d10/);
  assert.equal(await (await ask(`/admin/bug-bundle/${ID}/state.json`)).text(), '{"s":1}');
});
