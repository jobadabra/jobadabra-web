// Opens every /admin page (admin/admin.js PAGES) as a phone does (390 px, touch, the page's viewport tag honoured) through the real Worker on every demo seed,
// and fails when a page is wider than the screen: a phone then zooms the whole page out (owner, 26 Oct 2026: "a horrible responsiveness in admin";
// Lab Form Filling laid out at 495 px, Lab Job Search at 656 px). Names the outermost elements past the edge that no scrolling box holds.
// Run: tools/site-run.sh node tools/admin-no-sideways.mjs [--width 390]. Exit 1 when a page is too wide, 2 when no browser is found. Test: test/admin/admin-no-sideways.test.js.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {eachPage, launchChromium, workerServer} from './worker-server.mjs';

const root = process.cwd();
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 390);
const browser = await launchChromium(root);
if (!browser) { console.log('admin-no-sideways: playwright-core not found (set PLAYWRIGHT_CORE)'); process.exit(2); }
const {PAGES} = await import(pathToFileURL(path.join(root, 'admin/admin.js')));
const site = await workerServer(root, 'all');
let bad = 0;
try {
  await eachPage(PAGES, async ({path: route}) => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce'});
    await context.route(url => !url.href.startsWith(site.base), r => r.abort());   // never the live site
    const page = await context.newPage();
    const response = await page.goto(site.base + route, {waitUntil: 'load'});
    await page.waitForLoadState('networkidle', {timeout: 5000}).catch(() => {});   // a page that polls never goes idle: what it drew by then is checked
    const seen = await page.evaluate(vw => {
      const held = el => { for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(up).overflowX) && up.getBoundingClientRect().right <= vw + 1) return true; } return false; };
      const name = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
      const over = [...document.body.querySelectorAll('*')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.right > vw + 1 && !held(el) && getComputedStyle(el).position !== 'fixed'; });
      return {scroll: document.scrollingElement.scrollWidth, inner: innerWidth, over: over.filter(el => !over.includes(el.parentElement)).slice(0, 4).map(el => `${name(el)} → ${Math.round(el.getBoundingClientRect().right)}px`)};
    }, width);
    if (response.status() !== 200 || seen.inner > width + 1 || seen.scroll > seen.inner + 1) {
      bad++;
      console.log(`admin-no-sideways: ${route} ${response.status() !== 200 ? `answered ${response.status()}` : `is ${Math.max(seen.inner, seen.scroll)}px wide on a ${width}px phone: ${seen.over.join(', ') || 'no single element named'}`}`);
    }
    await context.close();
  });
} finally { await browser.close(); site.close(); }
console.log(`admin-no-sideways: ${PAGES.length} admin pages at ${width}px, ${bad} wider than the screen`);
process.exit(bad ? 1 : 0);
