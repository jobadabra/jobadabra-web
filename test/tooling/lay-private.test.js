// tools/lay-private.sh puts this repo's tidy top-level folders at the paths the joined tree's code expects (tools/layout-map.txt).
// Why (2 Nov 2026, owner: "I should clearly see separated top level: admin, api, website, workers... but not 20 other folders"): a folder can move in the repo without moving in the tree the code runs in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const put = (base, rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(base, rel)), {recursive: true}); fs.writeFileSync(path.join(base, rel), text); };

test('website/ lands as web/, everything else keeps its path', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'lay-src-')), dst = fs.mkdtempSync(path.join(os.tmpdir(), 'lay-dst-'));
  for (const rel of ['website/public/index.html', 'website/README.md', 'admin/page.js', 'workers/www/index.js', 'README.md', '.claude/x.md']) put(src, rel);
  execFileSync('bash', [path.join(root, 'tools', 'lay-private.sh'), src, dst]);
  const tree = fs.readdirSync(dst, {recursive: true}).map(name => name.split(path.sep).join('/')).sort();
  assert.deepEqual(tree.filter(name => !fs.statSync(path.join(dst, name)).isDirectory()), ['admin/page.js', 'web/public/index.html', 'workers/www/index.js']);
  assert.ok(!tree.includes('website'), 'the tidy name does not reach the joined tree');
});
