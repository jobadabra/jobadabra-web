// Opens every /admin page (admin/admin.js PAGES) in a real browser through the real Worker on every demo seed and checks ⌘K (admin/palette.js) there:
// ⌘K opens it, the page lists its cards, and every card heading has an id that lands (the tab that hides it opens, the card scrolls into view and flashes).
// Then the owner's example across pages: on Website, "Promo Code" + Enter opens Promo codes; a page#card link opened cold lands on the card.
// A new page or card that does not land fails here (owner, 27 Oct 2026). Run: tools/site-run.sh node tools/admin-palette-check.mjs [--width 1440]
// Exit 1 on a failure, 2 when no browser is found. Test: test/integration/palette-pages.test.js.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {eachPage, launchChromium, workerServer} from './worker-server.mjs';

const root = process.cwd();
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 1440);
const browser = await launchChromium(root);
if (!browser) { console.log('admin-palette-check: playwright-core not found (set PLAYWRIGHT_CORE)'); process.exit(2); }
const {PAGES} = await import(pathToFileURL(path.join(root, 'admin/admin.js')));
const site = await workerServer(root, 'all');
const problems = [];
let cards = 0;
const fresh = async () => {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'});
  await context.route(url => !url.href.startsWith(site.base), r => r.abort());   // never the live site
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(`${page.url().replace(site.base, '')}: script error ${error.message}`));
  return {context, page};
};
try {
  await eachPage(PAGES, async ({path: route}) => {
    const {context, page} = await fresh();
    await page.goto(site.base + route, {waitUntil: 'load'});
    await page.waitForLoadState('networkidle', {timeout: 5000}).catch(() => {});
    await page.waitForTimeout(2700);   // the palette reads again what the page's own script drew
    const seen = await page.evaluate(async () => {
      if (!window.adminPalette) return {missing: true};
      const own = window.adminPalette.entries().filter(e => e.kind === 'Section' && e.href.startsWith(location.pathname + '#'));
      const bad = [];
      for (const entry of own) {
        const id = decodeURIComponent(entry.href.split('#')[1]);
        if (document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length !== 1) { bad.push(`${entry.title}: id "${id}" is not unique`); continue; }
        await window.adminPalette.land(id);
        await new Promise(r => setTimeout(r, 50));
        const el = document.getElementById(id), box = el.closest('section, .card, details') || el, rect = el.getBoundingClientRect();
        if (!box.classList.contains('palette-flash')) bad.push(`${entry.title}: not flashed`);
        else if (!el.getClientRects().length) bad.push(`${entry.title}: still hidden (its tab did not open)`);
        else if (rect.bottom < 0 || rect.top > innerHeight) bad.push(`${entry.title}: not scrolled into view`);
      }
      return {count: own.length, bad};
    });
    if (seen.missing) problems.push(`${route}: no palette`);
    else { cards += seen.count; problems.push(...seen.bad.map(line => `${route}: ${line}`)); }
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    if (!await page.locator('dialog.admin-palette[open]').count()) problems.push(`${route}: ⌘K did not open the palette`);
    await context.close();
  });
  // The owner's example, across pages: from Website, "Promo Code" + Enter.
  const promo = PAGES.find(p => p.name === 'Promo codes').path, scouting = PAGES.find(p => p.name === 'Scouting').path;
  {
    const {context, page} = await fresh();
    await page.goto(`${site.base}${PAGES.find(p => p.name === 'Website').path}`, {waitUntil: 'load'});
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Promo Code');
    await Promise.all([page.waitForURL(url => url.pathname === promo, {timeout: 8000}).catch(() => {}), page.keyboard.press('Enter')]);
    if (new URL(page.url()).pathname !== promo) problems.push(`"Promo Code" + Enter went to ${new URL(page.url()).pathname}, not ${promo}`);
    // A card on another page, opened cold from a link: it lands.
    await page.goto(`${site.base}${scouting}#closed-sites`, {waitUntil: 'load'});
    await page.waitForTimeout(600);
    if (!await page.locator('#closed-sites.palette-flash').count()) problems.push(`${scouting}#closed-sites opened cold did not land on the card`);
    await context.close();
  }
} finally { await browser.close(); site.close(); }
for (const line of problems) console.log(`admin-palette-check: ${line}`);
console.log(`admin-palette-check: ${PAGES.length} admin pages, ${cards} cards checked, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
