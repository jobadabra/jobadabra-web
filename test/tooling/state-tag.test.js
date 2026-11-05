// tools/state-tag.sh (owner, 2 Nov 2026: "let's use tags not branches for storing things. Otherwise, they keep popping up like that"): state lives under a tag, written with a compare-and-swap.
// Runs the real script against a local bare remote: a race of two writers must keep both rounds, and no branch may ever appear in the remote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/state-tag.sh', import.meta.url).pathname;
const env = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env, encoding: 'utf8'}).trim();
const tool = (cwd, ...args) => spawnSync('bash', [SCRIPT, ...args], {cwd, env, encoding: 'utf8'});

function world() {
  const root = mkdtempSync(join(tmpdir(), 'state-tag-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', remote);
  const seed = join(root, 'seed');
  git(root, 'init', '-q', seed);
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  writeFileSync(join(seed, 'start.txt'), 'seed\n');
  git(seed, 'add', '.'); git(seed, ...id, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', remote, 'HEAD:refs/tags/state');
  const clone = name => { const dir = join(root, name); git(root, 'clone', '-q', remote, dir); return dir; };
  const heads = () => git(root, '--git-dir', remote, 'for-each-ref', '--format=%(refname)', 'refs/heads');
  const tagFiles = () => git(root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'refs/tags/state').split('\n');
  return {root, clone, heads, tagFiles};
}

test('read checks the tag out and write moves the tag, never creating a branch', () => {
  const w = world();
  const repo = w.clone('a');
  assert.equal(tool(repo, 'read', 'state', join(repo, 'picks')).status, 0);
  mkdirSync(join(repo, 'picks/notes'), {recursive: true});
  writeFileSync(join(repo, 'picks/notes/one.json'), '{}\n');
  const done = tool(repo, 'write', 'state', join(repo, 'picks'), 'Note one', 'notes');
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(w.tagFiles(), ['notes/one.json', 'start.txt']);
  assert.equal(w.heads(), '', 'the remote has no branch: nothing for GitHub to offer a pull request for');
});

test('two writers that read the same tag keep both rounds (the loser is re-applied, not dropped)', () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  for (const repo of [a, b]) assert.equal(tool(repo, 'read', 'state', join(repo, 'picks')).status, 0);
  writeFileSync(join(a, 'picks/a.json'), '{"a":1}\n');
  writeFileSync(join(b, 'picks/b.json'), '{"b":1}\n');
  assert.equal(tool(a, 'write', 'state', join(a, 'picks'), 'Note a', 'a.json').status, 0);
  const second = tool(b, 'write', 'state', join(b, 'picks'), 'Note b', 'b.json');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /moved by another writer/, 'the lease rejected the stale write');
  assert.deepEqual(w.tagFiles(), ['a.json', 'b.json', 'start.txt']);
  assert.equal(w.heads(), '');
});

test('two writers that changed the SAME file fail loudly instead of one dropping the other', () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  for (const repo of [a, b]) assert.equal(tool(repo, 'read', 'state', join(repo, 'picks')).status, 0);
  writeFileSync(join(a, 'picks/start.txt'), 'from a\n');
  writeFileSync(join(b, 'picks/start.txt'), 'from b\n');
  assert.equal(tool(a, 'write', 'state', join(a, 'picks'), 'A', 'start.txt').status, 0);
  const lost = tool(b, 'write', 'state', join(b, 'picks'), 'B', 'start.txt');
  assert.notEqual(lost.status, 0);
  assert.match(lost.stderr, /same file/);
  assert.equal(git(w.root, '--git-dir', join(w.root, 'remote.git'), 'show', 'refs/tags/state:start.txt'), 'from a', "a's round is still there");
});

test('nothing new to record leaves the tag alone; a missing tag fails loudly', () => {
  const w = world();
  const repo = w.clone('a');
  assert.equal(tool(repo, 'read', 'state', join(repo, 'picks')).status, 0);
  const before = git(w.root, '--git-dir', join(w.root, 'remote.git'), 'rev-parse', 'refs/tags/state');
  assert.equal(tool(repo, 'write', 'state', join(repo, 'picks'), 'No change', 'start.txt').status, 0);
  assert.equal(git(w.root, '--git-dir', join(w.root, 'remote.git'), 'rev-parse', 'refs/tags/state'), before);
  assert.notEqual(tool(repo, 'read', 'no-such-tag', join(repo, 'picks2')).status, 0, 'a lost tag is an error, not a silent empty start');
});

// Gitar on #319: when the other writer already recorded the same content, the retry's cherry-pick is empty; that is "done", not a conflict.
test('a round the other writer already recorded identically counts as done', () => {
  const w = world();
  const a = w.clone('a'), b = w.clone('b');
  for (const repo of [a, b]) assert.equal(tool(repo, 'read', 'state', join(repo, 'picks')).status, 0);
  for (const repo of [a, b]) writeFileSync(join(repo, 'picks/same.json'), '{"sha":"abc"}\n');
  assert.equal(tool(a, 'write', 'state', join(a, 'picks'), 'A', 'same.json').status, 0);
  const second = tool(b, 'write', 'state', join(b, 'picks'), 'B', 'same.json');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr + second.stdout, /already holds this round/);
  assert.deepEqual(w.tagFiles(), ['same.json', 'start.txt']);
});

// Gitar on benchmarks#17: the tag is seeded from the old branch before the workflows switch; anything the old branch gets in between must not be dropped silently.
test('an old branch with state the tag lacks fails read and write loudly; once the tag has caught up it is ignored', () => {
  const w = world();
  const remote = join(w.root, 'remote.git');
  const remoteGit = (...args) => git(w.root, '--git-dir', remote, ...args);
  const tagHead = remoteGit('rev-parse', 'refs/tags/state');
  remoteGit('update-ref', 'refs/heads/state', tagHead);   // the old branch, level with the tag: fine
  const a = w.clone('a');
  assert.equal(tool(a, 'read', 'state', join(a, 'picks')).status, 0);
  // an old workflow pushes to the branch after the seed
  git(a, 'fetch', '-q', 'origin', 'refs/tags/state'); git(a, 'checkout', '-q', '--detach', 'FETCH_HEAD');
  writeFileSync(join(a, 'late.json'), '{}\n');
  git(a, 'add', 'late.json'); git(a, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'late');
  git(a, 'push', '-q', 'origin', 'HEAD:refs/heads/state');
  const branchHead = remoteGit('rev-parse', 'refs/heads/state');
  const b = w.clone('b');
  const read = tool(b, 'read', 'state', join(b, 'picks'));
  assert.notEqual(read.status, 0);
  assert.match(read.stderr, /old branch state .* has state the tag lacks/);
  git(b, 'fetch', '-q', 'origin', 'refs/tags/state'); git(b, 'checkout', '-q', '--detach', 'FETCH_HEAD');
  writeFileSync(join(b, 'x.json'), '{}\n');
  const write = tool(b, 'write', 'state', b, 'X', 'x.json');
  assert.notEqual(write.status, 0, 'write refuses too');
  assert.equal(remoteGit('rev-parse', 'refs/tags/state'), tagHead, 'the tag was not moved');
  remoteGit('update-ref', 'refs/tags/state', branchHead);   // the documented move: the tag catches up
  assert.equal(tool(b, 'read', 'state', join(b, 'picks2')).status, 0, 'a branch the tag has caught up with is ignored');
});
