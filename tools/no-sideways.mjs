// Opens every page in web/public/sitemap.xml at phone width (390px) and lists anything that reaches past the screen's right edge, unless it sits
// inside a box that scrolls or clips it (a data table may scroll inside its own box). Exit 1 when a page has one, 2 when no browser is found.
// Site audit, owner 24 Oct 2026: Platforms had an 820px table in a 342px box. Run: node tools/no-sideways.mjs [--width 390] [--web <folder>]. Test: test/integration/no-sideways.test.js.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = name => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : null);
const web = path.resolve(arg('web') || path.join(repo, 'web/public'));
const width = Number(arg('width')) || 390;
// CHROME (CI points it at the runner's Google Chrome: tests.yml), else the Mac's, else the runner's; playwright's own download is never installed on CI.
const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file)) || '';

// playwright-core: PLAYWRIGHT_CORE (a path), else the public tree's e2e kit (tools/site-run.sh builds .overlay), else this repo.
const load = () => {
  for (const from of [process.env.PLAYWRIGHT_CORE && path.dirname(process.env.PLAYWRIGHT_CORE), path.join(repo, '.overlay/desktop/e2e'), repo].filter(Boolean)) {
    try { return createRequire(path.join(from, 'package.json'))(process.env.PLAYWRIGHT_CORE || 'playwright-core'); } catch {}
  }
  return null;
};
const pw = load();
if (!pw) { console.log('no-sideways: playwright-core not found (set PLAYWRIGHT_CORE)'); process.exit(2); }

const routes = [...fs.readFileSync(path.join(web, 'sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map(m => m[1]);
const TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json'};
const server = http.createServer((req, res) => {
  let file = path.join(web, decodeURIComponent(req.url.split('?')[0]));
  if (!path.extname(file)) file = file.endsWith('/') ? path.join(file, 'index.html') : `${file}.html`;
  if (!file.startsWith(web) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream'}).end(fs.readFileSync(file));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await pw.chromium.launch({headless: true, ...(fs.existsSync(CHROME) ? {executablePath: CHROME} : {})});
let bad = 0;
for (const route of routes) {
  const page = await browser.newPage({viewport: {width, height: 844}});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());   // fonts and analytics stay out: the layout must hold with fallbacks too
  await page.goto(base + route, {waitUntil: 'load'});
  const over = await page.evaluate(vw => {
    const held = el => { for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(up).overflowX) && up.getBoundingClientRect().right <= vw + 1) return true; } return false; };
    return [...document.body.querySelectorAll('*')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.right > vw + 1 && !held(el)
      && getComputedStyle(el).position !== 'fixed'; })
      .map(el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} → ${Math.round(el.getBoundingClientRect().right)}px`);
  }, width);
  // A child of an overflowing element repeats its parent: keep the outermost few.
  if (over.length) { bad++; console.log(`no-sideways: ${route} has ${over.length} element(s) past ${width}px: ${over.slice(0, 4).join(', ')}`); }
  await page.close();
}
await browser.close();
server.close();
console.log(`no-sideways: ${routes.length} pages at ${width}px, ${bad} with something past the edge`);
process.exit(bad ? 1 : 0);
