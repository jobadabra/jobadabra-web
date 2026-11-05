// Every /admin page fits a 390 px phone (owner, 26 Oct 2026: "a horrible responsiveness in admin"): tools/admin-no-sideways.mjs opens each page of
// admin/admin.js PAGES in a real browser as a phone, on every demo seed, so a new page that is too wide fails here. Skipped where no playwright-core
// is found (the tool exits 2); CI installs it (tests.yml "playwright-core for the phone checks"). Run: tools/site-run.sh node --test test/integration/admin-no-sideways.test.js
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {nav, NAV_STYLE} from '../../admin/admin.js';

const tool = new URL('../../tools/admin-no-sideways.mjs', import.meta.url).pathname;

test('every admin page fits a 390px phone', t => {
  const run = spawnSync(process.execPath, [tool, '--width', '390'], {encoding: 'utf8', timeout: 240_000});
  if (run.status === 2) return t.skip(run.stdout.trim());
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('on a phone the menu is one bar: where you are, and ☰ listing every page by group', () => {
  const html = nav('/admin/form-filling/lab', {role: 'superadmin'});
  const menu = html.match(/<details class="admin-menu">.*<\/details>/s)?.[0] || '';
  assert.match(menu, /<span class="here">Form filling › 🛡️ Lab Form Filling<\/span>/);
  assert.match(menu, /href="\/admin\/form-filling\/lab" aria-current="page"/);
  for (const path of ['/admin', '/admin/growth/email', '/admin/testing/bug-loop', '/admin/ai/costs', '/admin/agents/access']) assert.ok(menu.includes(`href="${path}"`), `the ☰ menu lists ${path}`);
  assert.ok(!nav('/admin', {role: 'admin', name: 'Ann'}).includes('/admin/agents/access'), 'Access stays the super admin\'s');
  assert.match(NAV_STYLE, /@media \(max-width:700px\)\{\.admin-nav>div\{display:none\}\.admin-menu\{display:block\}/, 'the rows hide and the bar shows under 700px');
});
