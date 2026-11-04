// Nothing rebuilds an overlay tree a tools/hero.sh or tools/media.sh run is using (25 Oct 2026: a media test run with SITE_OVERLAY_FRESH=1 rebuilt
// the overlay under a hero render; the run's preview then lost playwright-core). Runs the real scripts in a scratch repo with a local "public" repo.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = rel => fs.readFileSync(new URL(rel, root), 'utf8');

// A scratch site repo holding the three scripts, a local public repo to clone, and a built overlay with a sentinel file. -> {dir, tree, env}.
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-in-use-')), pub = path.join(dir, 'public');
  fs.mkdirSync(path.join(dir, 'site', 'tools'), {recursive: true});
  for (const file of ['overlay.sh', 'overlay-busy.sh', 'site-run.sh', 'compat-app-core.sh', 'lay-private.sh', 'layout-map.txt', 'repos.sh']) {
    fs.copyFileSync(new URL(`tools/${file}`, root), path.join(dir, 'site', 'tools', file));
    fs.chmodSync(path.join(dir, 'site', 'tools', file), 0o755);
  }
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {cwd, stdio: 'ignore'});
  fs.mkdirSync(pub);
  git(pub, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(pub, 'README'), 'public');
  git(pub, 'add', '.');
  git(pub, 'commit', '-q', '-m', 'one');
  const env = {...process.env, PUBLIC_REPO_URL: pub, SITE_OVERLAY_FRESH: ''};
  const tree = path.join(dir, 'site', '.overlay');
  execFileSync(path.join(dir, 'site', 'tools', 'overlay.sh'), [tree], {env, stdio: 'ignore'});
  fs.writeFileSync(path.join(tree, 'sentinel'), 'kept');
  return {dir, tree, env};
}
const deadPid = () => { const child = spawnSync(process.execPath, ['-e', '0']); return child.pid; };

test('an overlay marked by a live run is never rebuilt; a dead run\'s mark frees it (overlay.sh, overlay-busy.sh)', () => {
  const {dir, tree, env} = scratch();
  try {
    fs.writeFileSync(path.join(tree, '.git', 'in-use'), String(process.pid));
    const refused = spawnSync(path.join(dir, 'site', 'tools', 'overlay.sh'), [tree], {env, encoding: 'utf8'});
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, new RegExp(`in use by pid ${process.pid}`));
    assert.ok(fs.existsSync(path.join(tree, 'sentinel')), 'the tree is untouched');
    const fresh = spawnSync(path.join(dir, 'site', 'tools', 'site-run.sh'), ['true'], {env: {...env, SITE_OVERLAY_FRESH: '1'}, encoding: 'utf8'});
    assert.notEqual(fresh.status, 0, 'SITE_OVERLAY_FRESH=1 is refused too');
    assert.ok(fs.existsSync(path.join(tree, 'sentinel')));
    fs.writeFileSync(path.join(tree, '.git', 'in-use'), String(deadPid()));
    execFileSync(path.join(dir, 'site', 'tools', 'overlay.sh'), [tree], {env, stdio: 'ignore'});
    assert.ok(!fs.existsSync(path.join(tree, 'sentinel')), 'rebuilt once the run is gone');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('site-run.sh runs in an hour-old overlay a live run uses, without rebuilding it', () => {
  const {dir, tree, env} = scratch();
  try {
    fs.writeFileSync(path.join(tree, '.git', 'in-use'), String(process.pid));
    const old = new Date(Date.now() - 2 * 3600e3);
    fs.utimesSync(tree, old, old);
    const run = spawnSync(path.join(dir, 'site', 'tools', 'site-run.sh'), ['cat', 'sentinel'], {env, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'kept');
    assert.match(run.stderr, /not rebuilt/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('hero.sh and media.sh mark the overlay right after building it and clear the mark on exit', () => {
  for (const [file, build] of [['tools/hero.sh', 'rsync -a tools/ .overlay/tools/'], ['tools/media.sh', 'tools/overlay.sh .overlay >&2']]) {
    const source = read(file), at = source.indexOf(build), mark = source.indexOf('echo $$ > .overlay/.git/in-use; trap ', at);
    assert.ok(at > 0 && mark > at && source.slice(at, mark).split('\n').length <= 2, `${file}: the mark follows the build`);
    assert.match(source.slice(mark), /^echo \$\$ > \.overlay\/\.git\/in-use; trap '[^']*in-use"?' EXIT/, `${file}: cleared on exit`);
  }
});

test('site-run.sh lays the worktree\'s current files over the tree on every run, but never under a live run (overlay.sh --sync)', () => {
  const {dir, tree, env} = scratch();
  try {
    const site = path.join(dir, 'site'), edited = path.join(site, 'edited.txt');
    fs.writeFileSync(edited, 'new');
    fs.writeFileSync(path.join(tree, '.git', 'in-use'), String(process.pid));
    const busy = spawnSync(path.join(site, 'tools', 'site-run.sh'), ['cat', 'edited.txt'], {env, encoding: 'utf8'});
    assert.notEqual(busy.stdout, 'new', 'a live run\'s tree is left as it is');
    fs.rmSync(path.join(tree, '.git', 'in-use'));
    const run = spawnSync(path.join(site, 'tools', 'site-run.sh'), ['cat', 'edited.txt'], {env, encoding: 'utf8'});
    assert.equal(run.stdout, 'new', run.stderr);
    assert.ok(fs.existsSync(path.join(tree, 'sentinel')), 'laid over, not rebuilt');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
