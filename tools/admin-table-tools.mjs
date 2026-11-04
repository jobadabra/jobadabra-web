// Opens every /admin page (admin/admin.js PAGES) through the real Worker on every demo seed, as a 390 px phone, with the table tools' threshold lowered
// (--min, default 5: demo tables are short, real ones reach hundreds of rows), and fails when a long table got neither the tools (admin/table-tools.js) nor
// a stated reason to skip, when a sort click throws, when the tools push the page sideways, or when one of their taps is under 40 px (owner, 27 Oct 2026:
// sort, search and pages on every long admin table). Run: tools/site-run.sh node tools/admin-table-tools.mjs [--min 5] [--width 390].
// Exit 1 on a failure, 2 when no browser is found. Test: test/admin/table-tools.test.js.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {eachPage, launchChromium, workerServer} from './worker-server.mjs';

const root = process.cwd(), arg = (name, fallback) => Number(process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const min = arg('--min', 5), width = arg('--width', 390);
const browser = await launchChromium(root);
if (!browser) { console.log('admin-table-tools: playwright-core not found (set PLAYWRIGHT_CORE)'); process.exit(2); }
const {PAGES} = await import(pathToFileURL(path.join(root, 'admin/admin.js')));
const site = await workerServer(root, 'all');
let bad = 0, tooled = 0, skipped = 0;
const fail = (route, why) => { bad++; console.log(`admin-table-tools: ${route} ${why}`); };
try {
  await eachPage(PAGES, async ({path: route}) => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce'});
    await context.route(url => !url.href.startsWith(site.base), r => r.abort());   // never the live site
    await context.addInitScript(n => { window.__tableToolsMin = n; }, min);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base + route, {waitUntil: 'load'});
    await page.waitForLoadState('networkidle', {timeout: 5000}).catch(() => {});
    const seen = await page.evaluate(n => [...document.querySelectorAll('main table')].map((t, i) => {
      const where = t.closest('section')?.querySelector('h2,h3')?.textContent.trim().slice(0, 40) || `table ${i + 1}`;
      return {where, rows: t.rows.length - 1, tools: t.dataset.tools || (t.rows[0]?.querySelector('th.sortable') ? 'skip: its page sorts and pages it' : ''), noTools: t.hasAttribute('data-no-tools')};
    }).filter(t => t.rows > n), min);
    for (const t of seen) {
      if (t.tools === 'on') tooled++;
      else if (t.tools.startsWith('skip: ') || t.noTools) { skipped++; console.log(`admin-table-tools: ${route} "${t.where}" (${t.rows} rows) skipped: ${t.noTools ? 'data-no-tools' : t.tools.slice(6)}`); }
      else fail(route, `"${t.where}" has ${t.rows} rows and no table tools (drawn after the page loaded? a page that sorts and pages it itself gives its headers class "sortable")`);
    }
    // every header of every tooled table sorts both ways without an error and keeps its rows
    const sorts = await page.evaluate(() => [...document.querySelectorAll('table[data-tools="on"]')].map(t => {
      const n = t.rows.length; for (const b of t.querySelectorAll('.tt-sort')) { b.click(); b.click(); } return t.rows.length === n;
    }));
    if (sorts.includes(false)) fail(route, 'a sort lost or added rows');
    const looks = await page.evaluate(() => ({wide: document.scrollingElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll('.tt-bar input, .tt-bar button, .tt-foot button, .tt-sort')].filter(el => el.offsetParent && el.getBoundingClientRect().height < 40)
        .map(el => `${el.className} "${el.textContent.trim().slice(0, 20)}" ${Math.round(el.getBoundingClientRect().height)}px`).slice(0, 3)}));
    if (looks.wide) fail(route, `is wider than a ${width}px phone with the table tools on`);
    if (looks.small.length) fail(route, `has table-tool taps under 40px: ${looks.small.join(', ')}`);
    if (errors.length) fail(route, `threw: ${errors[0]}`);
    await context.close();
  });
} finally { await browser.close(); site.close(); }
console.log(`admin-table-tools: ${PAGES.length} admin pages, tables over ${min} rows: ${tooled} with the tools, ${skipped} skipped with a reason, ${bad} failures`);
process.exit(bad ? 1 : 0);
