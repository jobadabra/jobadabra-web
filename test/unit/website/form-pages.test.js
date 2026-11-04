// The three form-filling admin pages (owner, 14 Oct 2026): Real Form Filling and Lab Form Filling side by side in Form filling, with Benchmark and Learning; the old addresses only redirect.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {PAGES, oldPaths} from '../../../admin/admin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: () => new Response('asset')}, fetcher: async () => new Response('', {status: 503})});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const get = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});

test('each page is in its menu group under its name, and Real and Lab sit side by side', () => {
  const by = path => PAGES.find(page => page.path === path);
  assert.deepEqual([by('/admin/form-filling/real-users')?.name, by('/admin/form-filling/real-users')?.group], ['Real users', 'Form filling']);
  assert.deepEqual([by('/admin/form-filling/lab')?.name, by('/admin/form-filling/lab')?.group], ['Lab', 'Form filling']);
  assert.deepEqual([by('/admin/form-filling/learning')?.name, by('/admin/form-filling/learning')?.group], ['Learning', 'Form filling']);
  const order = PAGES.map(page => page.path);
  assert.equal(order.indexOf('/admin/form-filling/lab') - order.indexOf('/admin/form-filling/real-users'), 1);
});

test('each section lives on exactly the page the owner named, and Real and Lab link to each other', async () => {
  const e = env(), html = async path => (await get(e, path, owner)).text();
  const real = await html('/admin/form-filling/real-users'), learning = await html('/admin/form-filling/learning'), lab = await html('/admin/form-filling/lab');
  const where = {'Top weaknesses': real, 'Real use: what the fill missed': real, 'Why fields were left empty': real, 'How applications ended': real, 'Efficiency, day by day': real, 'Required marks: seen vs counted': real,
    'Recipe funnel': learning, 'By AI family': learning, 'Proposed answers': learning};
  for (const [section, page] of Object.entries(where)) for (const other of [real, learning]) assert.equal(other.includes(section), other === page, `${section} on ${other === real ? 'Real' : 'Learning'}`);
  assert.ok(lab.includes('<h1>🛡️ Lab Form Filling</h1>'));
  assert.ok(real.includes('href="/admin/form-filling/lab">Lab Form Filling →'), 'Real links the Lab scorecard');
  assert.ok(lab.includes("href: '/admin/form-filling/real-users'"), 'Lab links Real back');
});

test('the old addresses redirect the owner to the new pages, the digest too, and anyone else gets a 404', async () => {
  const e = env();
  const moves = {'/admin/form-filling': '/admin/form-filling/overview', '/admin/real-form-filling': '/admin/form-filling/real-users', '/smart-form-filling': '/admin/form-filling/real-users',
    '/admin/applying': '/admin/form-filling/lab', '/admin/lab-form-filling': '/admin/form-filling/lab', '/admin/lab-form-filling/video': '/admin/form-filling/lab/video',
    '/admin/form-filling/digest.md': '/admin/form-filling/real-users/digest.md', '/admin/form-filling/digest.json': '/admin/form-filling/real-users/digest.json',
    '/admin/real-form-filling/digest.md': '/admin/form-filling/real-users/digest.md', '/admin/real-form-filling/digest.json': '/admin/form-filling/real-users/digest.json'};
  for (const [old, now] of Object.entries(moves)) {
    assert.equal((await get(e, old)).status, 404, old);
    const moved = await get(e, `${old}?json`, owner);
    assert.deepEqual([moved.status, moved.headers.get('Location')], [301, `${now}?json`], old);
  }
  // CI's `curl -s` (no -L) with its key: the old digest address still answers the digest itself, not a 301.
  for (const path of ['/admin/form-filling/real-users/digest.md', '/admin/real-form-filling/digest.json']) assert.equal((await get({...env(), STATS_API_KEY: 'api'}, path, {headers: {Authorization: 'Bearer api'}})).status, 200, path);
  assert.notEqual((await get(e, '/applying/verify', {method: 'PUT', body: '{}'})).status, 301, 'API routes keep their paths');
});

// The class: no file links an old page path (every /admin/… address in the redirect list, so a page moved later is covered too). The redirect list (admin/admin.js) is the one place; migrations and the dated specs are history and are never rewritten.
// Only this repo's files (SITE_REPO_DIR from tools/site-run.sh and site-guards.sh; CI's "Site tests" step has this repo's checkout in .private): the public repo moves its
// links after the site lands, and until then the redirects answer them.
test('no tracked file names an old page path except the redirect list', () => {
  const tree = new URL('../../../', import.meta.url).pathname;
  const root = process.env.SITE_REPO_DIR ? `${process.env.SITE_REPO_DIR}/` : existsSync(`${tree}.private/.git`) ? `${tree}.private/` : tree;
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0').filter(Boolean);
  // Why (2 Nov 2026, [am]): test/fixtures hold recorded data (PR bodies from 16 Oct name /admin/…/ai-cost as it was); a recording is history, not a link, so it keeps what it recorded.
  const skip = file => file.startsWith('ops/db/migrations/') || file.startsWith('site/src/') || file.startsWith('docs/superpowers/') || file.startsWith('test/fixtures/') || file === 'admin/admin.js' || file === 'test/unit/website/form-pages.test.js' || file === 'test/unit/admin/admin-urls.test.js' || /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$/.test(file);
  const names = oldPaths().filter(path => path.startsWith('/admin/')).map(path => path.slice('/admin/'.length).replace(/[.]/g, '\\.'));
  assert.ok(names.includes('lab-form-filling') && names.includes('form-filling'), 'the list is read');
  // A file name (admin/app.js) or a new address under an old group word (/admin/form-filling/lab) is not an old path.
  const old = new RegExp(`(?:/|\\\\/)admin(?:/|\\\\/)(?:${names.map(name => name.replace(/\//g, '(?:/|\\\\/)')).join('|')})(?![-\\w/\\\\]|\\.(?:js|mjs|test|json|md|py)\\b)|/smart-form-filling`);
  const hits = [];
  for (const file of files.filter(name => !skip(name))) {
    let text = '';
    try { text = readFileSync(`${root}${file}`, 'utf8'); } catch { continue; }
    const hit = text.match(old);
    if (hit) hits.push(`${file}: ${hit[0]}`);
  }
  assert.deepEqual(hits, [], 'these files still link an old page path');
});
