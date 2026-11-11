// Why (2 Nov 2026, ab): release-ai-broker.yml held `: ` inside an unquoted one-line `run:` (since #282, 1 Nov). YAML read it as a second key, GitHub said "workflow file issue" and created a red push run on main for every push (108 runs) without anyone running the workflow. Nothing in CI parsed the workflow files; this does, all of them in one loop (the class, not the one file).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const DIR = join(new URL('../../', import.meta.url).pathname, '.github/workflows');
const files = readdirSync(DIR).filter(name => /\.ya?ml$/.test(name));

// Why (11 Nov 2026, #527 red): jobadabra's search-personas.yml gained a YAML anchor and alias (`&persona-steps` / `*persona-steps`, cr's 3/6); GitHub accepts them, but Ruby 3.2 on the runner (Psych 4) refuses aliases in
// YAML.load_file ("Alias parsing was not enabled"), so every web PR went red on a file that is valid. unsafe_load_file reads aliases (Psych 3.3.2+, incl. 4); an older Ruby (macOS 2.6) has load_file with aliases on.
const parse = file => execFileSync('ruby', ['-ryaml', '-e', 'YAML.respond_to?(:unsafe_load_file) ? YAML.unsafe_load_file(ARGV[0]) : YAML.load_file(ARGV[0])', file], {stdio: 'pipe'});   // ruby ships with ubuntu-24.04 and macOS; no npm or pip package in this repo parses YAML

test('a workflow with a YAML anchor and alias is valid (GitHub accepts them)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-alias-')), file = join(dir, 'aliased.yml');
  try {
    writeFileSync(file, 'jobs:\n  one:\n    steps: &shared\n      - run: echo hi\n  two:\n    steps: *shared\n');
    assert.doesNotThrow(() => parse(file));
    writeFileSync(file, 'jobs:\n  one:\n    steps:\n      - run: echo: hi\n');   // a real mistake stays refused
    assert.throws(() => parse(file));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('there are workflow files to check', () => assert.ok(files.length > 0));

for (const name of files) {
  test(`${name} is valid YAML (GitHub refuses the whole file otherwise)`, () => {
    try {
      parse(join(DIR, name));
    } catch (error) {
      assert.fail(`${name} does not parse: ${String(error.stderr).split('\n').find(line => /Syntax|mapping|did not find|could not find/.test(line)) || error.message}`);
    }
  });
}
