// Guards the media cache's auto-prune (media/prune.mjs; owner, 25 Oct 2026: "make an auto-prune of the media recordings"): 99 kept runs filled 42 GB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('every kind of media cache folder keeps its newest few; a KEEP folder, a protected one and unknown names stay (media/prune.mjs)', async () => {
  const {pruneCache} = await import('../../media/prune.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-prune-'));
  const dirs = ['hero-20261024-010000', 'hero-20261024-020000', 'hero-20261024-030000', 'hero-20261025-010000', 'hero-20261025-020000',
    'hero-preview-20261024-010000', 'hero-preview-20261024-020000', 'hero-preview-20261024-030000',
    'set-20261021-010000', 'set-20261021-020000', 'set-20261021-030000', 'modules-desktop-1111111111111111', 'modules-desktop-2222222222222222',
    'modules-desktop-3333333333333333', 'modules-desktop-e2e-4444444444444444', 'hero-r5-final', 'something-else'];
  dirs.forEach(name => fs.mkdirSync(path.join(root, name)));
  fs.writeFileSync(path.join(root, 'hero-20261024-010000', 'KEEP'), 'owner approved');
  dirs.forEach((name, i) => fs.utimesSync(path.join(root, name), 1e9 + i, 1e9 + i));   // written in the order listed
  for (let i = 0; i < 12; i++) { const log = path.join(root, `media-202610${String(10 + i)}-010000.log`); fs.writeFileSync(log, 'x'); fs.utimesSync(log, 1e9 + i, 1e9 + i); }
  const gone = pruneCache(root, {protect: [path.join(root, 'hero-20261024-020000')]}).sort();
  assert.deepEqual(gone, ['hero-20261024-030000', 'hero-preview-20261024-010000', 'media-20261010-010000.log', 'media-20261011-010000.log',
    'modules-desktop-1111111111111111', 'set-20261021-010000']);
  assert.ok(['hero-r5-final', 'something-else', 'modules-desktop-e2e-4444444444444444'].every(name => fs.existsSync(path.join(root, name))), 'unknown names and a lone cache stay');
  assert.deepEqual(pruneCache(root, {keep: {hero: 0}}), ['hero-20261025-020000', 'hero-20261025-010000', 'hero-20261024-020000'], 'a count from the caller; unprotected now; the KEEP one stays');
  assert.deepEqual(pruneCache(path.join(root, 'none')), [], 'no cache yet');
  fs.rmSync(root, {recursive: true, force: true});
});

test('both media tools prune the cache before they write a new folder (tools/hero.sh, tools/media.sh)', () => {
  const read = file => fs.readFileSync(new URL(`../../tools/${file}`, import.meta.url), 'utf8');
  const hero = read('hero.sh'), media = read('media.sh');
  assert.ok(hero.indexOf('node ops/media/prune.mjs "$cache"') > 0 && hero.indexOf('node ops/media/prune.mjs "$cache"') < hero.indexOf('set_dir="$cache/hero-$(date'), 'hero.sh');
  assert.match(hero, /--keep "hero=\$\(\( \$\{HERO_KEEP:-3\} - 1 \)\)" --protect "\$\{words\[1\]:-\}"/);
  assert.ok(media.indexOf('ops/media/prune.mjs" "$cache"') > 0 && media.indexOf('ops/media/prune.mjs" "$cache"') < media.indexOf('out="$cache/set-$(date'), 'media.sh');
});

test('the prune runs from the command line with --keep and --protect', async () => {
  const {execFileSync} = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-prune-cli-'));
  for (const name of ['hero-20261024-010000', 'hero-20261024-020000', 'hero-20261024-030000']) fs.mkdirSync(path.join(root, name));
  execFileSync('node', [new URL('../../media/prune.mjs', import.meta.url).pathname, root, '--keep', 'hero=1', '--protect', path.join(root, 'hero-20261024-010000')], {stdio: 'pipe'});
  assert.deepEqual(fs.readdirSync(root).sort(), ['hero-20261024-010000', 'hero-20261024-030000']);
  execFileSync('node', [new URL('../../media/prune.mjs', import.meta.url).pathname, root, '--protect', ''], {stdio: 'pipe'});
  fs.rmSync(root, {recursive: true, force: true});
});

test('the newest are the last written, not the latest name: the clocks went back an hour on 25 Oct 2026 (media/prune.mjs)', async () => {
  const {pruneCache} = await import('../../media/prune.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-prune-dst-'));
  // written in this order: run 28 at 02:32 summer time, run 29 at 02:41 summer time, run 30 at 02:24 winter time (the newest)
  ['hero-20261025-023221', 'hero-20261025-024141', 'hero-20261025-022404'].forEach((name, i) => { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), 2e9 + i * 600, 2e9 + i * 600); });
  assert.deepEqual(pruneCache(root, {keep: {hero: 2}}), ['hero-20261025-023221'], 'run 28 goes; run 30, written last, stays');
  fs.rmSync(root, {recursive: true, force: true});
});

