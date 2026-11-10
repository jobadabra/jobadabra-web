// /admin/job-search/lab (owner, 10 Nov 2026: the old 6-recording replay and its four tabs are retired): the route, the four tabs, a retired tab's bookmark, the removed upload route. Each tab has its own test file.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {GROUPS, PAGES} from '../../../../admin/admin.js';
import {TABS, page} from '../../../../admin/search-lab-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}

const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}});
const get = (e, query = '', headers = {Cookie: 'jp_stats=k3y'}) => worker.fetch(new Request(`https://www.jobpilotto.top/admin/job-search/lab${query}`, {headers}), e, {});

test('the route: owner only, the page is in the "Job search" group, the group is in the menu', async () => {
  const e = env();
  assert.equal((await get(e, '', {})).status, 404);
  const shown = await get(e);
  assert.equal(shown.status, 200);
  const html = await shown.text();
  assert.match(html, /Real installs/, 'the page opens on the live numbers');
  assert.match(html, /🔎 Job search/, 'the menu has the group');
  assert.ok(GROUPS.some(([name]) => name === 'Job search'));
  assert.equal(PAGES.find(item => item.path === '/admin/job-search/lab').group, 'Job search');
});

test('the Lab has four tabs, and the old replay\'s tabs are gone (owner, 10 Nov 2026: retire it)', () => {
  assert.deepEqual(TABS.map(([, name]) => name), ['Real installs', 'Random draws', 'Night search', 'Session checks']);
  const html = page();
  assert.deepEqual([...html.matchAll(/<a href="\?tab=(\w+)"/g)].map(match => match[1]), ['real', 'draws', 'night', 'checks']);
  for (const gone of ['Replays', 'Needs a fix', 'Fixed', 'History', "Each candidate's newest search"]) assert.ok(!html.includes(gone), `${gone} is retired`);
});

test('a bookmark of a retired tab, and any unknown tab, opens Real installs', async () => {
  const e = env();
  for (const tab of ['lab', 'needs', 'fixed', 'history', 'nonsense', '']) {
    const html = await (await get(e, `?tab=${tab}`)).text();
    assert.match(html, /<a href="\?tab=real" class="on">Real installs/, `?tab=${tab} is Real installs`);
    assert.doesNotMatch(html, /class="on">(Replays|Needs a fix|Fixed|History)/);
  }
  assert.match(page([], 'lab'), /<a href="\?tab=real" class="on">/, 'the page itself falls back too');
  assert.match(await (await get(e, '?tab=draws')).text(), /<a href="\?tab=draws" class="on">Random draws/, 'a live tab still opens');
});

test('the old replay\'s upload route is gone: a PUT to /search-lab/rows stores nothing and is served as a plain page', async () => {
  const e = {...env(), REPLAYS_PUBLISH_KEY: 'k'};
  const response = await worker.fetch(new Request('https://www.jobpilotto.top/search-lab/rows', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify({rows: [{candidate: 'a'}]})}), e, {});
  assert.equal(await response.text(), 'asset', 'it reaches the static-asset fallback, no handler');
  assert.equal(e.STATS.db.prepare("SELECT name FROM sqlite_master WHERE name = 'search_lab_runs'").all().length, 1, 'the stored rows stay in the database');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM search_lab_runs').get().n, 0);
});
