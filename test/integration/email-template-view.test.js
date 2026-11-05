// Email template cards open full-page previews and retain clear send feedback beside styled controls.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {launchChromium, workerServer} from '../../tools/worker-server.mjs';

test('template navigation, test results and inputs work at desktop and phone widths', async t => {
  const browser = await launchChromium(process.cwd());
  if (!browser) return t.skip('playwright-core not installed');
  const site = await workerServer(process.cwd(), ['release-mail']);
  const sent = []; site.env.EMAIL = {send: async mail => { sent.push(mail); return {messageId: 'fake-message'}; }};
  try {
    for (const width of [1440, 390]) {
      site.env.MAIL = 'on';
      const page = await browser.newPage({viewport: {width, height: 900}});
      await page.route(url => !url.href.startsWith(site.base), route => route.abort());
      await page.goto(site.base + '/admin/growth/email', {waitUntil: 'load'});
      assert.equal(await page.locator('a[href="/admin/growth/email?release=0.9.9"]').count(), 1);
      await page.locator('#template-welcome h2 a').click();
      assert.equal(await page.locator('.tpl').count(), 1);
      assert.equal(await page.locator('iframe').count(), 1);
      const input = page.locator('input[type=email]');
      const seen = await input.evaluate(el => ({background: getComputedStyle(el).backgroundColor, height: el.getBoundingClientRect().height, scroll: document.scrollingElement.scrollWidth, width: innerWidth}));
      assert.notEqual(seen.background, 'rgb(255, 255, 255)');
      assert.ok(seen.height >= 44 && seen.scroll <= seen.width);
      await page.getByRole('button', {name: 'Send to test inbox', exact: true}).click();
      await page.waitForURL(url => url.hash === '#test-result-welcome');
      assert.equal(await page.locator('.tpl').count(), 1);
      assert.match(await page.locator('[role=status]').textContent(), /Sent to the test inbox/);
      const box = await page.locator('[role=status]').boundingBox();
      assert.ok(box.y >= 0 && box.y < 900, 'send feedback is in view');
      await input.fill('reviewer@example.com');
      await page.getByRole('button', {name: 'Send to my email', exact: true}).click();
      await page.waitForURL(url => url.searchParams.get('destination') === 'personal');
      assert.match(await page.locator('[role=status]').textContent(), /Sent to the email address you entered/);
      site.env.MAIL = 'off';
      await page.getByRole('button', {name: 'Send to test inbox', exact: true}).click();
      await page.waitForURL(url => url.searchParams.get('test') === 'welcome:off');
      assert.match(await page.locator('[role=alert]').textContent(), /Email sending is switched off/);
      await page.getByRole('link', {name: '← All email', exact: true}).click();
      await page.locator('#template-welcome').getByRole('button', {name: 'Send to test inbox', exact: true}).click();
      await page.waitForURL(url => !url.searchParams.has('template') && url.hash === '#test-result-welcome');
      assert.match(await page.locator('#template-welcome [role=alert]').textContent(), /Email sending is switched off/);
      const galleryResult = await page.locator('#template-welcome [role=alert]').boundingBox();
      assert.ok(galleryResult.y >= 0 && galleryResult.y < 900, 'gallery feedback stays in view too');
      await page.close();
    }
    assert.equal(sent.length, 4, 'only the fake sender receives the successful test messages');
  } finally { await browser.close(); site.close(); }
});

test('the release title opens the live stable draft and its test sends that content without broadcasting', async t => {
  const browser = await launchChromium(process.cwd());
  if (!browser) return t.skip('playwright-core not installed');
  const site = await workerServer(process.cwd(), ['release-mail']);
  const sent = []; site.env.EMAIL = {send: async mail => { sent.push(mail); return {messageId: 'fake-message'}; }};
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.route(url => !url.href.startsWith(site.base), route => route.abort());
    await page.goto(site.base + '/admin/growth/email', {waitUntil: 'load'});
    await page.locator('#template-release h2 a').click();
    await page.waitForURL(url => url.searchParams.get('release') === '0.9.9');
    assert.match(await page.locator('h1').textContent(), /0\.9\.9/);
    const frame = page.frames().find(frame => frame !== page.mainFrame());
    const text = await frame.locator('body').textContent();
    assert.match(text, /Changes since version 0\.9\.6/);
    assert.match(text, /Faster location updates/);
    assert.doesNotMatch(text, /0\.8\.42|See why each job fits/);
    assert.equal(sent.length, 0, 'opening the draft never sends anything');
    await page.locator('#release-test-address').fill('reviewer@example.com');
    await page.getByRole('button', {name: 'Send test · 0.9.9', exact: true}).click();
    await page.waitForURL(url => url.searchParams.has('done'));
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /\[TEST\] Jobadabra 0\.9\.9/);
    assert.match(sent[0].text, /Changes since version 0\.9\.6/);
    const row = await site.env.STATS.prepare("SELECT status FROM release_mail WHERE version='0.9.9'").first();
    assert.equal(row.status, 'draft');
    await page.close();
  } finally { await browser.close(); site.close(); }
});
