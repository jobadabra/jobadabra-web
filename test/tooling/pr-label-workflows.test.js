// Guard for the PR labels workflow (owner, 2 Nov 2026: "same workflow on all repos"; web #299 showed a red ✗ from a cancelled Gitar-label run; owner, 13 Nov 2026: "One shared workflow").
// pr-labels.yml is the org's one caller (jobadabra templates/org-repo/pr-labels.yml). The checkout of the scripts, the concurrency groups and the Gitar check trigger's filter live once in
// jobadabra's pr-labels-shared.yml, with their cases in that repo's tests; this repo only says which events start it and calls it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const labels = readFileSync(new URL('../../.github/workflows/pr-labels.yml', import.meta.url), 'utf8');
const on = labels.split('\non:\n')[1].split('\n\n')[0];

test('the workflow only calls the shared one from jobadabra main: no copy of its logic, no PR code', () => {
  assert.ok(labels.includes('uses: jobadabra/jobadabra/.github/workflows/pr-labels-shared.yml@main'));
  assert.ok(!/actions\/checkout|head\.(sha|ref)|github\.head_ref/.test(labels), "a PR's code is never checked out here");
  assert.ok(labels.includes('pull-requests: write') && labels.includes('issues: write') && !labels.includes('contents: write'), 'its only writes are labels');
});

// Why (13 Nov 2026, jobadabra#4020; benchmarks #38 and jobadabra #4000): Gitar approves by only editing its comment, which starts nothing; its check ends 0-2 s later, so the check is a trigger.
test('the label runs on a push to main, a PR push, Gitar\'s review, a NEW comment and Gitar\'s check (an edit starts nothing)', () => {
  assert.ok(on.includes('push:\n    branches: [main]'));
  assert.ok(on.includes('pull_request_target:\n    types: [opened, synchronize, reopened]'));
  assert.ok(on.includes('pull_request_review:\n    types: [submitted, dismissed]'));
  assert.ok(on.includes('issue_comment:\n    types: [created]') && !on.includes('edited'));
  assert.ok(on.includes('check_run:\n    types: [created, completed]'));
});
