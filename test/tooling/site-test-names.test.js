// The site's test names stay in the prefixes public leaves to it (tools/site-test-names.mjs, public docs/site-test-names.json; web#163 red main, 26 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {misnamed, tracked} from '../../tools/site-test-names.mjs';

const folders = {tests: ['test_site_'], 'desktop/test': ['media-', 'web-'], 'desktop/e2e/test': [], test: ['']};

test('a site test without its folder\'s prefix is named, one with it passes', () => {
  assert.deepEqual(misnamed(folders, {tests: ['test_site_pipefail.py', 'test_workflow_app_client_id.py'], 'desktop/test': ['media-cuts.test.js', 'ladder-moves-site.test.js']}),
    ['tests/test_workflow_app_client_id.py', 'desktop/test/ladder-moves-site.test.js']);
});

test('a folder that is all the site\'s takes any name; one the site keeps nothing in takes none', () => {
  assert.deepEqual(misnamed(folders, {test: ['tools/ci-apt.test.js', 'boundary.test.js']}), []);
  assert.deepEqual(misnamed(folders, {'desktop/e2e/test': ['runner.test.mjs']}), ['desktop/e2e/test/runner.test.mjs']);
});

test('a folder the list does not know is named, never passed', () => {
  assert.match(misnamed(folders, {'worker/test': ['x.test.js']})[0], /no rule for this folder/);
});

// Why (layout 3/3, 2 Nov 2026): public's folders (tests, desktop/test) are joined-tree paths; this repo keeps them at test/python and test/media (tools/layout-map.txt).
test('a public folder is read where the map keeps it here, and the folder that holds it leaves it out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-names-'));
  const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true}); fs.writeFileSync(path.join(dir, rel), text); };
  put('tools/layout-map.txt', '# comment\ntest/python tests\ntest/media desktop/test\n');
  for (const rel of ['test/python/test_site_a.py', 'test/media/media-b.test.js', 'test/unit/c.test.js', 'test/d.test.js']) put(rel);
  execFileSync('git', ['init', '-q', '.'], {cwd: dir});
  execFileSync('git', ['add', '.'], {cwd: dir});
  assert.deepEqual(tracked(dir, 'tests'), ['test_site_a.py']);
  assert.deepEqual(tracked(dir, 'desktop/test'), ['media-b.test.js']);
  assert.deepEqual(tracked(dir, 'test').sort(), ['d.test.js', 'unit/c.test.js']);
  assert.deepEqual(tracked(dir, 'desktop/e2e/test'), []);
});
