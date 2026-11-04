// tools/tree.sh: a short sha cannot be fetched from GitHub (26 Oct 2026: a draw pinned to "944a661" died on "couldn't find remote ref" with no hint);
// it now says to pass the full sha. Run against a local repo, so no network.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

test('a short sha fails with a line that says to pass the full one', () => {
  const origin = mkdtempSync(path.join(tmpdir(), 'tree-origin-')), work = mkdtempSync(path.join(tmpdir(), 'tree-work-'));
  const git = (...args) => execFileSync('git', ['-C', origin, ...args], {encoding: 'utf8'}).trim();
  git('init', '-q'); writeFileSync(path.join(origin, 'a.txt'), 'a');
  git('add', 'a.txt'); git('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'a');
  const short = git('rev-parse', '--short=7', 'HEAD');
  const run = spawnSync('bash', [new URL('../../tools/tree.sh', import.meta.url).pathname, '--ref', short], {encoding: 'utf8',
    env: {...process.env, GITHUB_WORKSPACE: work, PUBLIC_REPO_URL: origin}});
  assert.equal(run.status, 128);
  assert.match(run.stderr, new RegExp(`'${short}' is a short sha: pass the full 40-character sha`));
});
