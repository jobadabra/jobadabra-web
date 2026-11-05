// Every admin page at /admin/{group}/{page} (owner, 27 Oct 2026: "normalize all the page urls"), and every address a page had before still answering:
// the owner is sent on (301, query kept), anyone else gets a 404, and a script with its key (CI's curl, its POST upload) is answered in place.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {GROUPS, PAGES, groupSlug, movedTo, oldPaths, slugOf} from '../../../admin/admin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
// The owner's cookie (the legacy one, accepted until STATS_API_KEY is set) and a script's key each get their own env.
const env = (extra = {}) => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', ...extra, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: () => new Response('asset')}, fetcher: async () => new Response('', {status: 503})}), keyed = () => env({STATS_API_KEY: 'api'});
const owner = {headers: {Cookie: 'jp_stats=k3y'}}, script = {headers: {Authorization: 'Bearer api'}};
const get = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {waitUntil() {}});

test('every page is at /admin/{its group}/{its name}, and no two share an address (a new page off the pattern fails here)', () => {
  const groups = GROUPS.map(([name]) => name);
  for (const page of PAGES.filter(item => item.path !== '/admin')) {
    assert.ok(groups.includes(page.group), page.path);
    assert.equal(page.path, `/admin/${groupSlug(GROUPS.find(group => group[0] === page.group))}/${page.slug || slugOf(page.name)}`, `${page.group} › ${page.name}`);
  }
  assert.equal(new Set(PAGES.map(page => page.path)).size, PAGES.length);
  assert.ok(PAGES.some(page => page.path === '/admin' && page.group === 'Overview'), 'the home stays /admin');
});

test('every old address sends the owner to its page (query kept), and nobody else learns it exists', async () => {
  const e = env();
  assert.ok(oldPaths().length >= 40, `old addresses: ${oldPaths().length}`);
  for (const old of oldPaths()) {
    const now = movedTo(old);
    assert.ok(now.startsWith('/admin/') && !oldPaths().includes(now), `${old} -> ${now}: one hop, to a live address`);
    assert.equal((await get(e, old)).status, 404, old);
    const moved = await get(e, `${old}?days=7`, owner);
    assert.deepEqual([moved.status, moved.headers.get('Location')], [301, `${now}?days=7`], old);
  }
  const form = await get(e, '/admin/promo-codes', {method: 'POST', headers: owner.headers, body: 'x=1'});
  assert.deepEqual([form.status, form.headers.get('Location')], [308, '/admin/growth/promo-codes'], 'a form sent to an old address keeps its method');
  assert.equal((await get(e, '/admin/promo-codes', {method: 'POST', body: 'x=1'})).status, 404);
  for (const page of PAGES) for (const old of [page.old || []].flat()) assert.equal(movedTo(old), page.path, old);
  assert.equal(movedTo('/admin/signups'), '/admin/growth/email', 'Signups is merged into E-mail');
  assert.ok(!PAGES.some(page => page.path === '/admin/signups'));
  for (const group of GROUPS.slice(1)) assert.equal(movedTo(`/admin/${groupSlug(group)}`), PAGES.find(page => page.group === group[0]).path, `${group[0]}'s own address opens its first page`);
});

test('a script calling an old address with its key gets the same answer as at the new one, never a 301 (curl -s and POST uploads do not follow it)', async () => {
  for (const old of oldPaths().filter(path => path.startsWith('/admin/'))) {
    const [before, after] = [await get(keyed(), old, script), await get(keyed(), movedTo(old), script)];
    assert.notEqual(before.status, 301, old);
    assert.equal(before.status, after.status, old);
  }
  const post = path => get(keyed(), path, {method: 'POST', headers: {Authorization: 'Bearer api', 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal((await post('/admin/lab-form-filling')).status, (await post('/admin/form-filling/lab')).status, 'the Lab upload');
  assert.equal((await get(keyed(), '/admin/real-form-filling/digest.json', script)).status, 200, 'the digest CI curls');
});

test('the e2e run report and its files answer under the E2E page and at their old /admin/e2e/... addresses', async () => {
  const e = env();
  for (const path of ['/admin/operations/e2e/run/5/report', '/admin/e2e/run/5/report']) assert.notEqual((await get(e, path, owner)).status, 302, path);
  for (const path of ['/admin/operations/e2e/report/1/bad/index.html', '/admin/e2e/report/1/bad/index.html']) assert.equal(await (await get(e, path)).text(), 'Not found', path);
});

// Intelligence was spread out (owner, 2 Nov 2026, "Intelligence is very thin"): Insights, Product Brain and AI cost went to Growth, its Overview folded into Growth's.
test('every Intelligence address, old and new, is one hop from a live Growth address', () => {
  const expect = {'/admin/intelligence/insights': '/admin/growth/insights', '/admin/intelligence/brain': '/admin/growth/brain', '/admin/intelligence/ai-cost': '/admin/ai/costs',
    '/admin/insights': '/admin/growth/insights', '/intel': '/admin/growth/insights', '/admin/brain': '/admin/growth/brain', '/admin/growth/ai-cost': '/admin/ai/costs', '/admin/ai-cost': '/admin/ai/costs', '/ai-cost': '/admin/ai/costs',
    '/admin/intelligence/overview': '/admin/growth/overview', '/admin/intelligence-overview': '/admin/growth/overview', '/admin/intelligence': '/admin/growth/overview'};
  for (const [old, now] of Object.entries(expect)) assert.equal(movedTo(old), now, old);
  for (const old of Object.keys(expect)) assert.ok(old === '/admin/intelligence' || oldPaths().includes(old), `${old} is listed as an old address`);
});
