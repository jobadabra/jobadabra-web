// One page, rendered through the REAL Worker (workers/www/index.js) on demo data, shot at every width and theme, and refused when it is unstyled
// (owner, 25 Oct 2026: jobadabra-web#92's Before/After images were the admin page as raw HTML, rendered without the layout that adds its CSS).
//   tools/site-run.sh node tools/page-shot.mjs --path /admin/growth/promo-codes --width 1440,390 --theme dark,light --out <dir> [--name before] [--seed promo-codes] [--full] [--clip '<selector>'] [--scroll '<selector>'] [--click '<selector>'] [--then '<selector>']
// --clip '<selector>': shoot only that element (the section the PR changed: readable at a table cell's width; exit 1 when it is not on the page).
// Writes <dir>/<name>-<width>[-<theme>].png (theme in the name only when more than one). Exit 1 when the page is unstyled (nothing is written for it).
// The data is an in-memory database built from db/migrations/ plus a seed (tools/page-shot-seeds.mjs); the owner login is the test key. The live site is never contacted:
// every request to another host is blocked. Run inside the overlay (tools/site-run.sh), from the checkout of the tree to shoot (before: a worktree of the old commit).
import fs from 'node:fs';
import path from 'node:path';
import {unstyledReasons} from './page-shot-check.mjs';
import {launchChromium, workerServer} from './worker-server.mjs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map(part => { const [k, ...v] = part.split(' '); return [k, v.join(' ') || true]; }));
const root = process.cwd();
const pagePath = args.path, out = path.resolve(args.out || '.');
if (!pagePath || !pagePath.startsWith('/')) { console.error('usage: tools/site-run.sh node tools/page-shot.mjs --path /admin/growth/promo-codes [--width 1440,390] [--theme dark,light] --out <dir> [--name before] [--seed promo-codes] [--full]'); process.exit(2); }
const widths = String(args.width || '1440,390').split(',').map(Number), themes = String(args.theme || 'dark').split(','), name = args.name || 'shot';
let site;
try { site = await workerServer(root, args.seed ? [args.seed] : []); } catch (error) { console.error(error.message); process.exit(2); }
const {base} = site;
const browser = await launchChromium(root);
if (!browser) { console.error('page-shot: playwright-core not found (npm ci in desktop/e2e of the public repo, or set JOBADABRA_PUBLIC or PLAYWRIGHT_CORE)'); site.close(); process.exit(2); }
fs.mkdirSync(out, {recursive: true});
let failed = false;
try {
  for (const width of widths) for (const theme of themes) {
    const context = await browser.newContext({viewport: {width, height: width > 600 ? 900 : 844}, deviceScaleFactor: width > 600 ? 1 : 2, colorScheme: theme, reducedMotion: 'reduce'});
    await context.route(url => !url.href.startsWith(base), route => route.abort());   // never the live site
    const page = await context.newPage(), bad = [];
    page.on('requestfailed', r => { if (r.url().startsWith(base)) bad.push({url: r.url(), type: r.resourceType(), reason: r.failure()?.errorText}); });
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400 && ['stylesheet', 'font'].includes(r.request().resourceType())) bad.push({url: r.url(), type: r.request().resourceType(), reason: `HTTP ${r.status()}`}); });
    const response = await page.goto(base + pagePath, {waitUntil: 'networkidle'});
    await page.evaluate(() => document.fonts.ready);
    const seen = await page.evaluate(() => { const b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
      return {bodyFont: b.fontFamily, bodyBackground: b.backgroundColor, background: h.backgroundColor, sheets: [...document.styleSheets].filter(s => { try { return s.cssRules.length; } catch { return true; } }).length}; });
    const reasons = unstyledReasons({...seen, failed: bad, status: response.status()});
    const file = path.join(out, `${name}-${width}${themes.length > 1 ? `-${theme}` : ''}.png`);
    if (reasons.length) { failed = true; console.error(`UNSTYLED ${pagePath} at ${width}px ${theme}: ${reasons.join('; ')}`); }
    else {
      if (args.scroll) { await page.locator(String(args.scroll)).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); }   // --scroll '<selector>': shoot that part of the page (a full-page shot leaves iframes blank)
      if (args.click) { await page.locator(String(args.click)).first().click(); await page.waitForTimeout(300); }
      if (args.then) { await page.locator(String(args.then)).first().click(); await page.waitForTimeout(300); }   // --then '<selector>': a second press after --click (a menu item, then its form; 3 Nov 2026)   // --click '<selector>': press it before the shot (an open dropdown); after --scroll
      if (args.clip) {   // Why (5 Nov 2026, owner: "the screenshots on the PRs … has nothing to do with the changes"): the PR's shot is the changed section, readable in a table cell; a selector that matches nothing fails, never a full-page fallback
        const sections = page.locator(String(args.clip));
        await sections.first().waitFor({state: 'visible', timeout: 3000}).catch(() => {});
        const found = await sections.count(), visible = found === 1 && await sections.isVisible();
        if (!visible) { failed = true; console.error(`${found > 1 ? 'AMBIGUOUS SECTION' : found ? 'HIDDEN SECTION' : 'NO SECTION'} ${pagePath} at ${width}px ${theme}: --clip '${args.clip}' matches ${found}${found === 1 ? ' (not visible)' : ''}; it must match exactly one visible element (the changed card), never the first of several`); await context.close(); continue; }
        await sections.screenshot({path: file});   // a popover opened by --click that sits outside this element is not in the image: clip its container
      } else await page.screenshot({path: file, fullPage: !!args.full});
      console.log(file);
    }
    await context.close();
  }
} finally { await browser.close(); site.close(); }
process.exit(failed ? 1 : 0);
