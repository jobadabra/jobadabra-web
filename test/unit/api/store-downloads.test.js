// The site sends Windows visitors to the Microsoft Store and the extension's button to the Chrome Web Store (owner, 26 Oct 2026: "Store first,
// .exe small"): a Store install never shows SmartScreen or Edge's Keep/Delete. Every click is still counted.
// 31 Oct 2026 (owner): every Windows button offers BOTH, the Store (the main click, as before) and the .exe directly, because each Store version takes 1-3 days of review;
// the page side is test/unit/website/windows-choice.test.js, the two routes and their counting are here.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {STORES} from '../../../api/downloads.js';
import {report} from '../../../shared/traffic.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0001_stats.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../../db/migrations/0032_download_net.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0';
const click = path => new Request(`https://www.jobadabra.top${path}`, {headers: {'CF-Connecting-IP': '1.2.3.4', 'User-Agent': WINDOWS}});
const env = () => ({STATS: d1(), STATS_SALT: 'salt', ASSETS: {fetch: () => new Response('asset')}, fetcher: async () => new Response('', {status: 503})});

test('the Windows button opens the Microsoft Store listing, and the click is counted', async () => {
  const e = env();
  const response = await worker.fetch(click('/download/windows?from=download'), e, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://apps.microsoft.com/detail/9NW1JJ7Z90MP');
  assert.deepEqual(e.STATS.db.prepare('SELECT platform, button FROM downloads').all().map(r => ({...r})), [{platform: 'windows', button: 'download'}]);
});

test('the small .exe link still gives the GitHub installer', async () => {
  const e = env();
  const response = await worker.fetch(click('/download/windows-exe?from=download'), e, {});
  assert.equal(response.status, 302);
  assert.match(response.headers.get('Location'), /^https:\/\/github\.com\/jobadabra\/jobadabra\/releases\/latest\/download\/.+-x64\.exe$/);
  assert.equal(e.STATS.db.prepare('SELECT platform FROM downloads').get().platform, 'windows-exe');
});

test('Add to Chrome opens the Chrome Web Store listing of our extension', async () => {
  const response = await worker.fetch(click('/download/chrome?from=download'), env(), {});
  assert.equal(response.headers.get('Location'), 'https://chromewebstore.google.com/detail/nmbnjhmpofifgcdalfefddbiihccogoi');
  assert.deepEqual(Object.keys(STORES).sort(), ['chrome', 'windows']);
});

test('the download page leads with both stores and keeps the .exe as a small link', () => {
  const page = readFileSync(new URL('../../../web/public/download.html', import.meta.url), 'utf8');
  assert.match(page, /href="\/download\/windows\?from=download"[^>]*>Get it from the Microsoft Store</);
  assert.match(page, /href="\/download\/windows-exe\?from=download"/);
  assert.match(page, /href="\/download\/chrome\?from=download"[^>]*>Add to Chrome</);
});

// The class: no current page (web/public) still tells Windows users to click past a warning.
test('no page tells Windows visitors to click "More info → Run anyway" or calls Windows unsigned', () => {
  const dir = new URL('../../../web/public/', import.meta.url);
  const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
  assert.ok(pages.length > 10, `positive control: ${pages.length} pages read`);
  const stale = pages.filter(name => /Run anyway|Not signed by (Apple or )?Microsoft|Neither is signed|Installers are not signed|your computer asks once/i.test(readFileSync(new URL(name, dir), 'utf8')));
  assert.deepEqual(stale, []);
});

// Since 31 Oct 2026 (owner) the .exe is offered beside the Store on every Windows button, not only on the download page: the only Windows links on any page are the Store route
// (the main click) and the .exe route (its pair, same ?from=; test/unit/website/windows-choice.test.js checks the pairing), never a GitHub file or a hand-written store address.
test('every Windows download link on every page is the Store route or its .exe pair', () => {
  const dir = new URL('../../../web/public/', import.meta.url);
  const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
  const links = pages.flatMap(name => [...readFileSync(new URL(name, dir), 'utf8').matchAll(/href="([^"]*(?:windows|\.exe)[^"]*)"/gi)]
    .map(([, href]) => ({name, href})));
  assert.ok(links.filter(l => l.href.startsWith('/download/windows?')).length >= 8, `positive control: ${links.length} Windows links read`);
  const wrong = links.filter(({href}) => !href.startsWith('/download/windows?') && !href.startsWith('/download/windows-exe?'));
  assert.deepEqual(wrong, []);
});

const RELEASE = {assets: [{name: 'Jobadabra-0.8.60-x64.exe', browser_download_url: 'https://github.com/jobadabra/jobadabra/releases/download/desktop-v0.8.60/Jobadabra-0.8.60-x64.exe'}]};

test('both Windows choices resolve: the Store route to the Store, the .exe route to the newest stable release\'s installer', async () => {
  const e = {...env(), fetcher: async () => new Response(JSON.stringify(RELEASE), {headers: {'Content-Type': 'application/json'}})};
  const store = await worker.fetch(click('/download/windows?from=hero'), e, {});
  assert.equal(store.status, 302);
  assert.equal(store.headers.get('Location'), 'https://apps.microsoft.com/detail/9NW1JJ7Z90MP');
  const exe = await worker.fetch(click('/download/windows-exe?from=hero'), e, {});
  assert.equal(exe.status, 302);
  assert.equal(exe.headers.get('Location'), RELEASE.assets[0].browser_download_url, 'the versioned installer of the latest stable release');
});

test('the same button tells the Store click from the .exe click: one row each, same button, platform windows vs windows-exe, and the admin report reads both', async () => {
  const e = env();
  await worker.fetch(click('/download/windows?from=hero'), e, {});
  await worker.fetch(click('/download/windows-exe?from=hero'), e, {});
  const rows = e.STATS.db.prepare('SELECT platform, button FROM downloads ORDER BY platform').all().map(r => ({...r}));
  assert.deepEqual(rows, [{platform: 'windows', button: 'hero'}, {platform: 'windows-exe', button: 'hero'}]);
  const seen = await report(e.STATS, 7);
  assert.deepEqual(seen.platforms.map(p => p.name).sort(), ['windows', 'windows-exe'], 'the /stats Platform bars show both');
  assert.equal(seen.buttons.find(b => b.name === 'hero').n, 1, 'one person pressing two choices of one button counts once per day in Buttons');
});
