// The scheduled jobs read the PUBLIC repo's runs, PRs and tags: REPO (set by each workflow) wins over GITHUB_REPOSITORY, which here is this private repo. Since the repo was renamed
// (20 Oct 2026) e2e-intel asked the private repo for desktop.yml, got a 404 and failed hourly; /admin/testing/e2e stayed at 20 Oct.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../jobs/', import.meta.url);
for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
  test(`${file} never lets GITHUB_REPOSITORY outrank REPO`, () => {
    const source = fs.readFileSync(new URL(file, dir), 'utf8');
    assert.ok(!/process\.env\.GITHUB_REPOSITORY\s*\|\|\s*process\.env\.REPO/.test(source), 'REPO must come first');
  });
}
