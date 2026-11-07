// The "Download for Windows" menu opened in a real browser, on every page that has one, at desktop and phone width (owner, 7 Nov 2026: "this dropdown is buggy on the pricing page":
// the menu opened under the button inside the pricing ticket, whose `overflow: hidden` (the perforation notches) cut it to the Store line). The static checks of the split button live in
// test/unit/website/windows-choice.test.js; this one plays the owner's scenario: press the caret, and the whole menu is on screen, clipped by no ancestor.
// Skipped where no playwright-core is found; CI installs it. Run: tools/site-run.sh node --test test/integration/windows-menu-open.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {launchChromium, workerServer} from '../../tools/worker-server.mjs';

const root = process.cwd();
const PAGES = ['/', '/pricing', '/download', '/platforms', '/compare', '/intelligence'];

// -> what the owner sees of the open menu: how far each of its sides is cut off by the screen or by an ancestor that clips (overflow other than visible).
const cutOff = menu => {
  const box = menu.getBoundingClientRect();
  const cuts = [Math.max(0, box.bottom - innerHeight), Math.max(0, -box.left), Math.max(0, box.right - innerWidth)];
  let clipper = null;
  for (let el = menu.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const edge = el.getBoundingClientRect();
    const hidden = Math.max(0, box.bottom - edge.bottom, edge.top - box.top, box.right - edge.right, edge.left - box.left);
    if (hidden > 0.5) clipper = {tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''), hidden: Math.round(hidden)};
  }
  return {screen: Math.round(Math.max(...cuts)), clipper, links: [...menu.querySelectorAll('a')].map(a => a.getBoundingClientRect().height > 0),
    noteLines: [...menu.querySelectorAll('span')].map(note => Math.round(note.getBoundingClientRect().height / parseFloat(getComputedStyle(note).lineHeight)))};
};

for (const width of [1440, 390]) {
  test(`the Windows menu opens in full on every page at ${width}px`, async t => {
    const browser = await launchChromium(root);
    if (!browser) return t.skip('playwright-core not found');
    const site = await workerServer(root, []);
    const context = await browser.newContext({viewport: {width, height: width > 600 ? 900 : 844}, reducedMotion: 'reduce'});
    await context.route(url => !url.href.startsWith(site.base), route => route.abort());
    const pressedOn = {};
    try {
      for (const path of PAGES) {
        const page = await context.newPage();
        await page.goto(site.base + path, {waitUntil: 'networkidle'});
        const carets = page.locator('.dl-caret');
        for (let index = 0; index < await carets.count(); index++) {
          const caret = carets.nth(index);
          if (!await caret.isVisible()) continue;   // the phone-only or desktop-only copy of a button
          await caret.scrollIntoViewIfNeeded();
          await caret.click();
          const menu = page.locator(`#${await caret.getAttribute('aria-controls')}`);
          assert.ok(await menu.isVisible(), `${path} #${index}: the menu did not open`);
          // A tall menu below the fold is reached by scrolling the PAGE (never element.scrollIntoView: it scrolls the clipping ticket's own content, which a visitor cannot, and hid this bug).
          await menu.evaluate(el => scrollBy(0, Math.max(0, el.getBoundingClientRect().bottom - innerHeight + 16)));
          const seen = await menu.evaluate(cutOff);
          assert.equal(seen.clipper, null, `${path} #${index} at ${width}px: the menu is cut off by ${seen.clipper && seen.clipper.tag} (${seen.clipper && seen.clipper.hidden}px)`);
          assert.equal(seen.screen, 0, `${path} #${index} at ${width}px: the menu runs ${seen.screen}px past the screen`);
          assert.deepEqual(seen.links, [true, true], `${path} #${index}: both choices show`);
          assert.ok(seen.noteLines.every(lines => lines <= 2), `${path} #${index} at ${width}px: a note runs ${seen.noteLines} lines, two at most (brief, 7 Nov 2026)`);
          await caret.click();   // closes again
          pressedOn[path] = (pressedOn[path] || 0) + 1;
          assert.equal(await page.locator('.dl-split').nth(index).evaluate(el => el.classList.contains('flow')), false, `${path} #${index}: a closed menu leaves its wrapper in .flow`);
        }
        await page.close();
      }
    } finally { await browser.close(); site.close(); }
    for (const path of PAGES) assert.ok(pressedOn[path] >= 1, `positive control: no menu pressed on ${path} (${JSON.stringify(pressedOn)})`);
  });
}
