// ⌘K on every /admin page, in a real browser (owner, 27 Oct 2026): tools/admin-palette-check.mjs opens each page of admin/admin.js PAGES on demo data,
// opens ⌘K, lands on every card heading (tab opened, scrolled, flashed), and follows the owner's "Promo Code" example across pages, so a new page or
// card that does not land fails here. Skipped where no playwright-core is found (the tool exits 2); CI installs it. Run: tools/site-run.sh node --test test/integration/palette-pages.test.js
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const tool = new URL('../../tools/admin-palette-check.mjs', import.meta.url).pathname;

test('every admin page has ⌘K, and every card on it lands', t => {
  const run = spawnSync(process.execPath, [tool], {encoding: 'utf8', timeout: 300_000});
  if (run.status === 2) return t.skip(run.stdout.trim());
  assert.equal(run.status, 0, run.stdout.split('\n').filter(line => line.startsWith('admin-palette-check:')).join('\n') + run.stderr.slice(-2000));
});
