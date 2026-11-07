// /admin/testing/bug-bundles (admin/bug-bundles.js): the list of the AI testers' bugs, newest first, behind the Admin login, each row linking to its GitHub issue and its evidence page; no status, owner or open count.
// Guard: privacy — the list shows a twin tester's report sentences (made of the owner's real data) to a signed-in admin only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listHtml, view} from '../../../admin/bug-bundles.js';
import {listBundles} from '../../../shared/bug-bundles.js';
import {PAGES} from '../../../admin/admin.js';

const A = '0123456789abcdef', B = 'fedcba9876543210';
const report = (extra = {}) => ({source: 'persona', journey: 'J12', severity: 'high', title: 'Phone <b>wrong</b>', expected: 'typed phone', seen: 'label shown', steps: [], at: '2026-11-07T04:43:12Z', ...extra});
const bucket = files => ({
  list: async ({prefix = ''} = {}) => ({objects: Object.entries(files).filter(([key]) => key.startsWith(prefix)).map(([key, f]) => ({key, uploaded: f.uploaded})), truncated: false}),
  get: async key => (files[key] ? {text: async () => files[key].body, body: files[key].body} : null)});
const files = {
  [`bundle/${A}/report.json`]: {uploaded: '2026-11-06T10:00:00Z', body: JSON.stringify(report({title: 'Older', source: 'desktop-tester'}))},
  [`bundle/${A}/app.jpg`]: {uploaded: '2026-11-06T10:00:00Z', body: 'x'},
  [`bundle/${B}/report.json`]: {uploaded: '2026-11-07T10:00:00Z', body: JSON.stringify(report())},
  'bundle/not-an-id/report.json': {uploaded: '2026-11-07T11:00:00Z', body: JSON.stringify(report({title: 'Stray'}))},
  [`bundle/0000000000000000/report.json`]: {uploaded: '2026-11-07T12:00:00Z', body: 'not json'}};
const ask = (auth = 'owner-key', env = {LAB_FILLS: bucket(files), STATS_API_KEY: 'owner-key', STATS_KEY: 'k'}) => view(new Request('https://x.test/admin/testing/bug-bundles', {headers: auth ? {Authorization: `Bearer ${auth}`} : {}}), env);

test('listBundles reads the report objects newest first and leaves out a stray id or an unreadable report', async () => {
  const list = await listBundles(bucket(files));
  assert.deepEqual(list.map(entry => entry.id), [B, A]);
  assert.equal((await listBundles(bucket(files), 1)).length, 1);
});

test('signed out is a 404; an admin sees the list: words escaped, a link to the GitHub issue search and to the evidence, and no status or open count', async () => {
  assert.equal((await ask(null)).status, 404);
  const html = await (await ask()).text();
  assert.match(html, /2 bug bundles kept/);
  assert.ok(html.indexOf('Phone &lt;b&gt;wrong') < html.indexOf('Older'), 'newest first');
  assert.ok(!html.includes('<b>wrong</b>'));
  assert.match(html, new RegExp(`issues\\?q=${B}`));
  assert.match(html, new RegExp(`href="/admin/bug-bundle/${B}"`));
  assert.match(html, /Claude Desktop/);
  assert.doesNotMatch(html, /\b(open bugs?|closed|assignee|owner:)\b/i);
  assert.equal((await ask('owner-key', {STATS_API_KEY: 'owner-key', STATS_KEY: 'k'})).status, 200);
});

test('an empty store and a stored word like "constructor" for severity or source are drawn, not a 500', () => {
  assert.match(listHtml([]), /No bug bundle is kept yet/);
  assert.match(listHtml(Array.from({length: 100}, (_, i) => ({id: A, uploaded: i, report: {title: 't'}}))), /The newest 100 bug bundles/);
  assert.match(listHtml([{id: A, uploaded: 0, report: {severity: 'constructor', source: 'constructor'}}]), /\? severity/);
});

test('the page is in the Testing menu', () => {
  assert.equal(PAGES.find(page => page.path === '/admin/testing/bug-bundles')?.group, 'Testing');
});
