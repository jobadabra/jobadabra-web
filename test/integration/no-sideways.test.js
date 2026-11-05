// No page in the sitemap reaches past a 390px phone screen (site audit, owner 24 Oct 2026). Runs tools/no-sideways.mjs in a real browser; skipped
// where no playwright-core is found (the tool exits 2), so run it locally before a page change: PLAYWRIGHT_CORE=<path> node --test test/integration/no-sideways.test.js
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const tool = new URL('../../tools/no-sideways.mjs', import.meta.url).pathname;

test('every sitemap page fits a 390px screen', t => {
  const run = spawnSync(process.execPath, [tool, '--width', '390'], {encoding: 'utf8', timeout: 170_000});
  if (run.status === 2) return t.skip(run.stdout.trim());
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
