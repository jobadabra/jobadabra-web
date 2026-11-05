// Both media tools install the browser the extension take drives after their packages (25 Oct 2026: a disk cleanup removed
// ~/Library/Caches/ms-playwright and hero.sh, which never installed it, failed on the Apply clip; a fresh GitHub Mac runner has none either).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('hero.sh and media.sh install Playwright\'s Chromium right after their packages', () => {
  for (const file of ['tools/hero.sh', 'tools/media.sh']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const packages = source.indexOf('for dir in desktop desktop/e2e'), install = source.search(/npx playwright-core install chromium/);
    assert.ok(packages > 0 && install > packages, `${file}: the browser is installed after the packages`);
  }
});
