// tools/site-run.sh refuses to run from another worktree of the same repo (it would run its own checkout's files, not the edited ones: a new test "passed"
// without running, 26 Oct 2026; again 27 Oct). Runs a copy of the script in a throwaway repo with stub overlay.sh / overlay-busy.sh: refused from a 2nd worktree, runs from its own.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../../tools/site-run.sh', import.meta.url));
const git = (cwd, ...args) => spawnSync('git', args, {cwd, encoding: 'utf8'});

test('site-run.sh runs from its own checkout and refuses from another worktree of the same repo', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'site-run-'));
  const main = path.join(base, 'main'), other = path.join(base, 'other');
  mkdirSync(path.join(main, 'tools'), {recursive: true});
  copyFileSync(script, path.join(main, 'tools', 'site-run.sh'));
  writeFileSync(path.join(main, 'tools', 'overlay.sh'), '#!/usr/bin/env bash\nfor arg; do tree=$arg; done; mkdir -p "$tree"\n');   // the tree is the last argument (also after --sync)
  writeFileSync(path.join(main, 'tools', 'overlay-busy.sh'), '#!/usr/bin/env bash\nexit 1\n');   // no hero/media run uses it
  for (const name of ['site-run.sh', 'overlay.sh', 'overlay-busy.sh']) chmodSync(path.join(main, 'tools', name), 0o755);
  git(main, 'init', '-q');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start');
  assert.equal(git(main, 'worktree', 'add', '-q', '--detach', other).status, 0);
  const run = (cwd, env = {}) => spawnSync('bash', [path.join(main, 'tools', 'site-run.sh'), 'true'], {cwd, encoding: 'utf8', env: {...process.env, SITE_OVERLAY_FRESH: '', ...env}});
  { const own = run(main); assert.equal(own.status, 0, `its own checkout runs (positive control): ${own.stderr}`); }
  const refused = run(other);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /Run this worktree's own: tools\/site-run\.sh true/);
  assert.equal(run(other, {SITE_RUN_OTHER: '1'}).status, 0, 'the escape still runs');
  assert.equal(run(base).status, 0, 'outside any checkout: unchanged');
});
