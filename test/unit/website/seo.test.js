import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');

test('Google can find the public pages: robots, sitemap, canonical, structured data', () => {
  const robots = file('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/www\.jobadabra\.top\/sitemap\.xml/);
  for (const path of ['/stats', '/telemetry', '/feedback', '/api/']) assert.match(robots, new RegExp(`Disallow: ${path}`));
  const sitemap = file('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/www\.jobadabra\.top\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobadabra\.top\/compare<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobadabra\.top\/intelligence<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.jobadabra\.top\/platforms<\/loc>/);
  assert.doesNotMatch(sitemap, /friends/);
  for (const [page, canonical] of [['index.html', '/'], ['compare.html', '/compare'], ['intelligence.html', '/intelligence'], ['platforms.html', '/platforms']]) {
    const html = file(page);
    assert.ok(html.includes(`<link rel="canonical" href="https://www.jobadabra.top${canonical}">`), page);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta property="og:image"/);
    assert.ok(!/<title>Jobadabra<\/title>/.test(html), `${page} needs a descriptive title`);
  }
  const ld = file('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.equal(JSON.parse(ld[1])['@type'], 'SoftwareApplication');
  assert.match(file('index.html'), /<meta name="google-site-verification" content="[\w-]{20,}">/);   // Search Console ownership: keep it, removing it un-verifies the site
  assert.match(file('friends.html'), /<meta name="robots" content="noindex">/);
});

test('the landing page links to the platform support page, which lists what is supported and what is coming', () => {
  assert.match(file('index.html'), /href="(\/platforms|platforms\.html)"/);
  const page = file('platforms.html');
  for (const word of ['Supported', 'Coming next', 'No date yet', 'Edge', 'Gmail', 'Outlook']) assert.ok(page.includes(word), word);
});

// Search Console, 25-26 Oct 2026: "Duplicate without user-selected canonical" on /changelog, /privacy, /terms (no canonical tag).
// The class: every page Google should index is in the sitemap, names itself as canonical, and robots.txt lets Google read it.
const locs = () => [...file('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const pageFile = (path) => (path === '/' ? 'index' : path.slice(1)) + '.html';

test('every sitemap page names itself as canonical on https://www.jobadabra.top', () => {
  for (const loc of locs()) {
    const url = new URL(loc);
    assert.equal(url.origin, 'https://www.jobadabra.top', loc);
    const canonicals = [...file(pageFile(url.pathname)).matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(canonicals, [loc], `${pageFile(url.pathname)}: one canonical, its own address`);
  }
});

test('every public page is either in the sitemap or marked noindex', async () => {
  const {readdirSync} = await import('node:fs');
  const listed = new Set(locs().map((loc) => new URL(loc).pathname));
  for (const name of readdirSync(new URL('../../../web/public', import.meta.url)).filter((f) => f.endsWith('.html'))) {
    const path = name === 'index.html' ? '/' : '/' + name.replace(/\.html$/, '');
    const noindex = /<meta name="robots" content="noindex/.test(file(name));
    assert.ok(listed.has(path) !== noindex, `${name}: ${noindex ? 'noindex but in the sitemap' : 'neither in the sitemap nor noindex'}`);
  }
});

test('robots.txt blocks no page the sitemap lists', () => {
  const blocked = [...file('robots.txt').matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]);
  for (const loc of locs()) {
    const path = new URL(loc).pathname;
    assert.ok(!blocked.some((rule) => path.startsWith(rule)), `${path} is disallowed`);
  }
});

test('no page links to a page by its .html file: each link uses the one address Google should index', async () => {
  const {readdirSync} = await import('node:fs');
  for (const name of readdirSync(new URL('../../../web/public', import.meta.url)).filter((f) => f.endsWith('.html')))
    assert.deepEqual(file(name).match(/href="[^"]*?\b[\w-]+\.html(?:[?#][^"]*)?"/g) || [], [], name);
});

// Search Console, 12 Nov 2026: "Crawled - currently not indexed" listed /changelog.json (a data file the changelog page links to).
// The class: a data file is read by pages and apps, never meant as a Google result. Static assets answer before the Worker, so public/_headers sets the header for every .json there.
test('every .json file in public/ is served with X-Robots-Tag: noindex (public/_headers)', async () => {
  const {readdirSync} = await import('node:fs');
  const rules = file('_headers').split(/\n(?=\S)/).filter((block) => !block.startsWith('#')).map((block) => block.trim().split('\n').map((line) => line.trim()));
  const noindexed = rules.filter((lines) => lines.slice(1).includes('X-Robots-Tag: noindex')).map((lines) => lines[0]);
  const jsons = readdirSync(new URL('../../../web/public', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.ok(jsons.length > 0, 'the check has something to look at');
  for (const name of jsons) assert.ok(noindexed.some((glob) => new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test('/' + name)), `/${name} is not covered by a noindex rule in public/_headers`);
});

test('no .json file is in the sitemap', () => {
  assert.deepEqual(locs().filter((loc) => loc.endsWith('.json')), []);
});
