// A web PR's required check "All checks passed" must not end cancelled beside a green run of the same commit (owner, 6 Nov 2026: "red" on web #459).
// Cause: a push and the description edit ship makes a second later started two runs of tests.yml in ONE concurrency group; one cancelled the other and its cancelled check stayed on the commit.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/tests.yml', root), 'utf8');
const block = workflow.match(/^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: (.*)$/m);
assert.ok(block, 'tests.yml has a concurrency block');

// Runs the workflow's own `${{ … }}` text: GitHub's && and || return their operands like JavaScript's, and every operand here is a string or a boolean.
const evaluate = (template, github) => {
  const expression = template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, e) => `\${${e}}`);
  const format = (f, ...a) => f.replace(/\{(\d)\}/g, (_, i) => a[i]);
  return new Function('github', 'format', `return \`${expression}\``)(github, format);
};
const pr = (action, runId, {sha = 'abc', ref = 'topic'} = {}) => ({event_name: 'pull_request', event: {action}, head_ref: ref, sha, run_id: runId});
const group = github => evaluate(block[1], github);
// GitHub cancels the older run when a new run lands in the same group.
const cancels = (a, b) => group(a) === group(b);

test('the owner\'s scenario: a push, then the description edit a second later, on one commit: neither cancels the other', () => {
  assert.equal(cancels(pr('synchronize', 1), pr('edited', 2)), false);
  assert.equal(cancels(pr('edited', 2), pr('synchronize', 1)), false);
});

test('two edits, or a reopen beside an open run, on one commit never cancel each other', () => {
  assert.equal(cancels(pr('edited', 2), pr('edited', 3)), false);
  assert.equal(cancels(pr('synchronize', 1), pr('reopened', 2)), false);
});

test('a new push of the same branch still replaces the older run', () => {
  assert.equal(cancels(pr('synchronize', 1, {sha: 'a'}), pr('synchronize', 2, {sha: 'b'})), true);
  assert.match(block[2], /github\.event_name == 'pull_request'/, 'only a pull request cancels');
});

test('another branch is never touched; main keeps one group per commit', () => {
  assert.equal(cancels(pr('synchronize', 1, {ref: 'a'}), pr('synchronize', 2, {ref: 'b'})), false);
  const push = sha => ({event_name: 'push', event: {}, head_ref: '', sha, run_id: 9});
  assert.equal(cancels(push('a'), push('b')), false);
});
