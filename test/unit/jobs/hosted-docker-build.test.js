// A failing hosted image build prints docker's last lines (jobs/hosted-e2e/docker-build.mjs). 12 Nov 2026: the build ran with -q and the pip error behind a red main (9-12 Nov) was not in the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dockerBuild} from '../../../jobs/hosted-e2e/docker-build.mjs';

test('a failed build prints the last 40 lines of docker output and throws', () => {
  const lines = Array.from({length: 100}, (_, i) => `line ${i + 1}`).concat('ERROR: No matching distribution found for playwright');
  const printed = [];
  const original = console.error;
  console.error = text => printed.push(text);
  try {
    assert.throws(() => dockerBuild('img', '/root', () => ({status: 1, stdout: lines.join('\n'), stderr: ''})), /docker build/);
  } finally { console.error = original; }
  assert.match(printed.join('\n'), /No matching distribution found for playwright/);
  assert.match(printed.join('\n'), /line 62\n/);
  assert.doesNotMatch(printed.join('\n'), /line 61\n/);
});

test('a good build prints nothing and does not run quiet', () => {
  let seen;
  dockerBuild('img', '/root', (cmd, args) => { seen = args; return {status: 0, stdout: '', stderr: ''}; });
  assert.ok(!seen.includes('-q'));
  assert.ok(seen.includes('--progress=plain'));
});
