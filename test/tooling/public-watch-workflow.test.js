// Guard for public-watch.yml: its records leave main (owner, 2 Nov 2026: the same ruleset on every org repo; a ruleset on main refuses the direct push this workflow made).
// Why (2 Nov 2026, go): the old step ended `git commit ... && git push -q || true` on main. Under the org ruleset that push is refused and `|| true` hides it, so the deploy records
// would silently stop and every 6 h run would redeploy. The records live under the tag public-watch-state (owner, 2 Nov 2026: "let's use tags not branches for storing things. Otherwise, they keep
// popping up like that": a pushed branch made GitHub offer "Compare & pull request"); tools/state-tag.sh moves it with a compare-and-swap, and a failed push fails the job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const flow = readFileSync(join(ROOT, '.github/workflows/public-watch.yml'), 'utf8');

test('the workflow records through tools/state-tag.sh: no push of its own, no branch, no swallowed error', () => {
  assert.ok(!/git push/.test(flow.replace(/^#.*$/gm, '')), 'a push is state-tag.sh\'s job (lease on the tag), never a line of the workflow');
  assert.ok(/tools\/state-tag\.sh write public-watch-state /.test(flow), 'the record goes through the script, to the tag');
  assert.ok(!/refs\/heads|HEAD:public-watch-state|ref: public-watch-state/.test(flow.replace(/^#.*$/gm, '')), 'the state is never a branch');
  assert.ok(!/(commit|push|state-tag)[^\n]*\|\|\s*true/.test(flow), 'a failed record fails the job');
});

test('the records are read from the tag, checked out next to the private repo', () => {
  assert.ok(/ref: refs\/tags\/public-watch-state/.test(flow), 'the tag is checked out');
  assert.ok(/PUBLIC_WATCH_STATE:\s*\$\{\{\s*github\.workspace\s*\}\}\/\.state/.test(flow), 'tools/public-watch.sh is told where the records are');
});

test('the record files are no longer tracked on main', () => {
  const tracked = execFileSync('git', ['ls-files', '.public-site', '.public-ready'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(tracked.trim(), '', 'main holds no deploy record: the ruleset refuses a direct push there');
});

test('public-watch.sh writes its record into PUBLIC_WATCH_STATE and says changed, then same', () => {
  const tree = mkdtempSync(join(tmpdir(), 'pw-tree-'));
  const state = mkdtempSync(join(tmpdir(), 'pw-state-'));
  const git = (...args) => execFileSync('git', ['-C', tree, ...args], {encoding: 'utf8'});
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(join(tree, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '-q', '-m', 'one');
  const run = () => execFileSync('bash', [join(ROOT, 'tools/public-watch.sh'), tree, 'site', 'a.txt'], {encoding: 'utf8', env: {...process.env, PUBLIC_WATCH_STATE: state}}).trim();
  const inRepo = () => (existsSync(join(ROOT, '.public-site')) ? readFileSync(join(ROOT, '.public-site'), 'utf8') : null);
  const before = inRepo();
  assert.equal(run(), 'changed');
  assert.ok(existsSync(join(state, '.public-site')), 'the record is in the state folder');
  assert.equal(inRepo(), before, 'nothing is written into this repo');
  assert.equal(run(), 'same');
});
