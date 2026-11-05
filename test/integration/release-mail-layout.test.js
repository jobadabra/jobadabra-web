// The release draft uses the shared admin container and readable test controls at desktop and phone widths.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {launchChromium, workerServer} from '../../tools/worker-server.mjs';

test('release draft stays centered and its email field is styled inside the admin shell', async t => {
  const browser = await launchChromium(process.cwd());
  if (!browser) return t.skip('playwright-core not installed');
  const site = await workerServer(process.cwd(), ['release-mail']);
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      await page.route(url => !url.href.startsWith(site.base), route => route.abort());
      await page.goto(site.base + '/admin/growth/email?release=0.9.9', {waitUntil: 'load'});
      assert.equal(await page.locator('main input[type=email]').count(), 1, 'test form belongs to the shared container');
      const seen = await page.locator('input[type=email]').evaluate(input => {
        const style = getComputedStyle(input), main = input.closest('main').getBoundingClientRect();
        const button = input.form.querySelector('button').getBoundingClientRect();
        return {background: style.backgroundColor, color: style.color, radius: parseFloat(style.borderRadius),
          left: main.left, right: main.right, buttonRight: button.right, buttonHeight: button.height,
          viewport: innerWidth, scroll: document.scrollingElement.scrollWidth};
      });
      assert.ok(seen.radius >= 6 && seen.background !== 'rgb(255, 255, 255)', 'email input has the admin theme');
      assert.ok(seen.scroll <= width && seen.buttonRight <= width, 'controls fit without sideways scrolling');
      assert.ok(seen.buttonHeight >= 44, 'test button has a usable touch target');
      assert.ok(Math.abs(seen.left - (width - seen.right)) <= 1, 'container is centered');
      if (width === 1440) assert.ok(seen.left > 100, 'desktop content has bounded width');
      await page.close();
    }
  } finally { await browser.close(); site.close(); }
});
