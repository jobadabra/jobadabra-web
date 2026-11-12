// Both hosts keep working: workers.dev (installed apps: its API never redirected, its pages 301 since 27 Oct 2026) and the jobpilotto.top alias (bare name -> www). Guards shared/hosts.js and wrangler.toml.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {apexRedirect, MOVED_PAGES, pageRedirect, PAGE_PATHS} from '../../../shared/hosts.js';

const ask = (host, path, init) => new Request(`https://${host}${path}`, init);
const API_PATHS = ['/api/index', '/api/notion/start?state=x', '/report/fill-failure', '/telemetry', '/admin', '/privacy', '/'];

test('the old host is never redirected, on any path: installed apps call it', () => {
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobpilotto.workers.dev', path)), null, path);
});

test('the alias main address www.jobpilotto.top is served, not redirected', () => {
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobpilotto.top', path)), null, path);
});

test('the bare alias domain goes to www, keeping path and query', () => {
  const response = apexRedirect(ask('jobpilotto.top', '/privacy?x=1'));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://www.jobpilotto.top/privacy?x=1');
});

test('the worker answers the old host and the alias www the same way', async () => {
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  const [a, b] = await Promise.all([worker.fetch(ask('www.jobpilotto.workers.dev', '/not-a-page'), env, {}), worker.fetch(ask('www.jobpilotto.top', '/not-a-page'), env, {})]);
  assert.equal(a.status, b.status);
  assert.equal(await a.text(), await b.text());
  assert.notEqual(a.status, 301);
});

test('wrangler.toml keeps workers.dev on and attaches the alias hosts as custom domains', () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^workers_dev = true$/m);
  assert.match(toml, /pattern = "www\.jobpilotto\.top", custom_domain = true/);
  assert.match(toml, /pattern = "jobpilotto\.top", custom_domain = true/);
});

test('jobadabra.top: bare name goes to www, www is served, wrangler attaches both', () => {
  const response = apexRedirect(ask('jobadabra.top', '/privacy?x=1'));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://www.jobadabra.top/privacy?x=1');
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobadabra.top', path)), null, path);
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /pattern = "www\.jobadabra\.top", custom_domain = true/);
  assert.match(toml, /pattern = "jobadabra\.top", custom_domain = true/);
});

test('old www.jobpilotto.top: pages go to www.jobadabra.top, API paths are served (installed apps)', () => {
  const r = pageRedirect(ask('www.jobpilotto.top', '/compare?x=1'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://www.jobadabra.top/compare?x=1');
  assert.equal(pageRedirect(ask('www.jobpilotto.top', '/index.html')).headers.get('Location'), 'https://www.jobadabra.top/');
  for (const path of ['/api/index', '/api/ai/x', '/report/telemetry', '/report/fill-failure', '/telemetry/version', '/install', '/admin', '/download/x'])
    assert.equal(pageRedirect(ask('www.jobpilotto.top', path)), null, path);
  assert.equal(pageRedirect(ask('www.jobpilotto.top', '/', {method: 'POST'})), null);
  assert.equal(pageRedirect(ask('www.jobadabra.top', '/compare')), null);
});

test('every page in public/ is redirected and listed in run_worker_first; a page added later fails here', () => {
  const pages = readdirSync(new URL('../../../web/public', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => '/' + f.replace(/\.html$/, '').replace(/^index$/, ''));
  assert.deepEqual([...PAGE_PATHS].sort(), pages.sort());
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  for (const path of PAGE_PATHS) assert.ok(toml.includes(`"${path}"`), `run_worker_first lacks ${path}`);
});

test('every host the site accepts keeps being served: none is dropped', async () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  const hosts = ['www.jobadabra.top', 'jobadabra.top', 'www.jobpilotto.top', 'jobpilotto.top'];
  for (const host of hosts) assert.ok(toml.includes(`pattern = "${host}", custom_domain = true`), `${host} missing from wrangler.toml`);
  assert.match(toml, /^workers_dev = true$/m);
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  for (const host of ['www.jobadabra.top', 'www.jobpilotto.top', 'www.jobpilotto.workers.dev']) {
    const response = await worker.fetch(ask(host, '/privacy.json'), env, {});
    assert.notEqual(response.status, 301, host);
  }
});

// Search Console, 25-26 Oct 2026: http://www.jobadabra.top/<page> was served (200), so Google saw two copies of each page
// ("Alternative page with proper canonical tag", "Duplicate without user-selected canonical"). A page has one address.
test('a page has one address: http, the old host and .html each 301 once to https://www.jobadabra.top/<page>', () => {
  const at = (url, init) => pageRedirect(new Request(url, init));
  for (const path of PAGE_PATHS) {
    const file = path === '/' ? '/index.html' : `${path}.html`;
    for (const from of [`http://www.jobadabra.top${path}`, `http://www.jobpilotto.top${path}`, `https://www.jobpilotto.top${path}`, `https://www.jobadabra.top${file}`, `http://www.jobadabra.top${file}`]) {
      const r = at(`${from}?from=x`);
      assert.equal(r?.status, 301, from);
      assert.equal(r.headers.get('Location'), `https://www.jobadabra.top${path}?from=x`, from);
    }
    assert.equal(at(`https://www.jobadabra.top${path}`), null, `${path} is served`);
  }
  for (const path of ['/api/index', '/report/telemetry', '/download/mac', '/admin']) assert.equal(at(`http://www.jobpilotto.top${path}`), null, path);   // installed apps: never redirected
  assert.equal(apexRedirect(new Request('http://jobadabra.top/privacy')).headers.get('Location'), 'https://www.jobadabra.top/privacy');
});

test('a page folded into another 301s there from every host and as .html, query kept; the Worker still sees it; no page file is left', async () => {
  const toml = readFileSync(new URL('../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  const pages = readdirSync(new URL('../../../web/public', import.meta.url));
  for (const [path, target] of Object.entries(MOVED_PAGES)) {
    for (const from of [`https://www.jobadabra.top${path}`, `https://www.jobadabra.top${path}.html`, `http://www.jobpilotto.top${path}`, `https://www.jobpilotto.workers.dev${path}`]) {
      const r = pageRedirect(new Request(`${from}?from=x`));
      assert.equal(r?.status, 301, from);
      assert.equal(r.headers.get('Location'), `https://www.jobadabra.top${target.replace('#', '?from=x#')}`, from);
    }
    assert.ok(toml.includes(`"${path}"`), `run_worker_first keeps ${path}, or Workers Assets answers 404 before the redirect`);
    assert.ok(!pages.includes(`${path.slice(1)}.html`), `${path}.html is gone`);
    assert.ok(!PAGE_PATHS.includes(path), `${path} is not also a page`);
  }
  const env = {ASSETS: {fetch: async () => new Response('not found', {status: 404})}};
  const r = await worker.fetch(new Request('https://www.jobadabra.top/about-you'), env, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://www.jobadabra.top/how-it-works#ai-reads');
});

test('the worker sends that redirect before serving the page', async () => {
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  const r = await worker.fetch(new Request('http://www.jobadabra.top/privacy'), env, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://www.jobadabra.top/privacy');
});

// Owner, 27 Oct 2026: "https://www.jobpilotto.workers.dev/ this should always redirect (301 permanently moved) to jobadabra.top".
// Only its pages move: central-scout.yml PUTs /api/index there and installed apps call its API, which a 301 would break.
test('www.jobpilotto.workers.dev: pages 301 to www.jobadabra.top (path + query kept), API paths are served (/admin: test/unit/shared/old-hosts.test.js)', async () => {
  for (const path of PAGE_PATHS) {
    for (const from of [`https://www.jobpilotto.workers.dev${path}?from=x`, `http://www.jobpilotto.workers.dev${path}?from=x`]) {
      const r = pageRedirect(new Request(from));
      assert.equal(r?.status, 301, from);
      assert.equal(r.headers.get('Location'), `https://www.jobadabra.top${path}?from=x`, from);
    }
  }
  assert.equal(pageRedirect(ask('www.jobpilotto.workers.dev', '/download.html')).headers.get('Location'), 'https://www.jobadabra.top/download');
  for (const path of ['/api/index', '/api/ai/x', '/report/telemetry', '/telemetry/version', '/install', '/admin', '/admin/stats', '/download/mac', '/download/windows'])
    assert.equal(pageRedirect(ask('www.jobpilotto.workers.dev', path)), null, path);
  for (const method of ['PUT', 'POST']) assert.equal(pageRedirect(ask('www.jobpilotto.workers.dev', '/', {method})), null, method);
  assert.equal(pageRedirect(ask('www-staging.jobpilotto.workers.dev', '/download')), null, 'staging is its own worker: never sent to production');
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  const page = await worker.fetch(ask('www.jobpilotto.workers.dev', '/'), env, {});
  assert.equal(page.status, 301);
  assert.equal(page.headers.get('Location'), 'https://www.jobadabra.top/');
  const api = await worker.fetch(ask('www.jobpilotto.workers.dev', '/api/index', {method: 'PUT', body: '{}'}), env, {});
  assert.notEqual(api.status, 301, 'the scout PUT to /api/index is answered, not redirected');
});
