// Every site test sits in a kind folder and, for unit tests, a known area (TESTS.md).
// Guard: release — a test outside these folders brings back the flat layout the owner asked to end (5 Nov 2026).
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {test} from 'node:test';

const KINDS = /^(guards|integration|media|tooling)\/|^unit\/(admin|api|jobs|shared|website|workers\/(ai-broker|www))\//;
const tests = readdirSync(new URL('../', import.meta.url), {recursive: true}).map(file => file.replaceAll('\\', '/')).filter(file => file.endsWith('.test.js'));

test('every site test is in a folder TESTS.md names', () => {
  assert.ok(tests.includes('guards/test-folders.test.js'), 'positive control: the walk finds this file');
  assert.deepEqual(tests.filter(file => !KINDS.test(file)), []);
});
