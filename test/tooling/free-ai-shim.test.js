// The compat shim at jobs/persona-search/free-ai-local.mjs lays the tree in Node, so it also runs where rsync is not installed (the Windows runners: 4 beta jobs start the relay there).
// Why (2 Nov 2026, rn; mac-07 on web #323): the first version spawned tools/lay-private.sh (rsync) and would have left those jobs red after the merge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';

// The shim sits at this repo's RAW path; in the joined tree that path is the real relay, so the raw repo is found beside it (SITE_REPO_DIR locally, .private in CI).
const here = fileURLToPath(new URL('../../', import.meta.url));
const raw = [process.env.SITE_REPO_DIR, path.join(here, '.private')].filter(Boolean).find(dir => fs.existsSync(path.join(dir, 'jobs/persona-search/free-ai-local.mjs')));
assert.ok(raw, 'the raw repo (with its jobs/persona-search shim) is not found: SITE_REPO_DIR or .private');
const {lay} = await import(pathToFileURL(path.join(raw, 'jobs/persona-search/free-ai-local.mjs')).href);

function write(root, file, text) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); }

test('the mapped folder lands at its joined path over the stub, with rsync off PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-root-')), dest = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-dest-'));
  write(root, 'tools/layout-map.txt', '# comment\nops/jobs jobs\nwebsite web\n');
  write(root, 'ops/jobs/persona-search/free-ai-local.mjs', 'REAL');
  write(root, 'jobs/persona-search/free-ai-local.mjs', 'STUB');
  write(root, 'website/index.html', 'page');
  write(root, 'shared/free-ai.js', 'shared');
  write(root, '.git/HEAD', 'x'); write(root, 'node_modules/p/index.js', 'x');
  const path0 = process.env.PATH; process.env.PATH = '';
  try { lay(root, dest); } finally { process.env.PATH = path0; }
  assert.equal(fs.readFileSync(path.join(dest, 'jobs/persona-search/free-ai-local.mjs'), 'utf8'), 'REAL');
  assert.equal(fs.readFileSync(path.join(dest, 'web/index.html'), 'utf8'), 'page');
  assert.equal(fs.readFileSync(path.join(dest, 'shared/free-ai.js'), 'utf8'), 'shared');
  assert.equal(fs.existsSync(path.join(dest, '.git')), false);
  assert.equal(fs.existsSync(path.join(dest, 'node_modules')), false);
});

test('a tree with no layout map is copied as it is', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-root-')), dest = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-dest-'));
  write(root, 'shared/a.js', 'a');
  lay(root, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'shared/a.js'), 'utf8'), 'a');
});
