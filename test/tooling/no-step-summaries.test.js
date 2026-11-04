// No CI job writes a GitHub step summary (owner, 26 Oct 2026: "let's remove all the summaries"; a run page was a wall of summary boxes).
// What a person needs stays in the job log and ::error/::warning annotations. This loops over this repo's workflows, so a new summary anywhere fails here;
// the public repo keeps the same rule for its own files (tests/test_no_step_summaries.py). Guards: .github/workflows/*.yml.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
// This repo's workflows only: in the joined tree the public repo's own workflows sit beside them, and only ours name `.private` (as test/tooling/ci-apt.test.js).
const flows = readdirSync(new URL('.github/workflows/', root)).filter(name => name.endsWith('.yml') && readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8').includes('.private'));

test('the rule sees this repo\'s workflows', () => assert.ok(flows.includes('random-draw.yml'), 'random-draw.yml is one of them'));

test('no workflow writes a step summary: print to the log or an annotation instead', () => {
  const bad = flows.flatMap(name => readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8').split('\n')
    .map((line, index) => (/GITHUB_STEP_SUMMARY|\bcore\.summary\b/.test(line) ? `${name}:${index + 1}: ${line.trim().slice(0, 100)}` : ''))).filter(Boolean);
  assert.deepEqual(bad, []);
});
