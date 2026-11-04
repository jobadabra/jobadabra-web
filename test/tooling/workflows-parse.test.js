// Why (2 Nov 2026, ab): release-ai-broker.yml held `: ` inside an unquoted one-line `run:` (since #282, 1 Nov). YAML read it as a second key, GitHub said "workflow file issue" and created a red push run on main for every push (108 runs) without anyone running the workflow. Nothing in CI parsed the workflow files; this does, all of them in one loop (the class, not the one file).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';

const DIR = join(new URL('../../', import.meta.url).pathname, '.github/workflows');
const files = readdirSync(DIR).filter(name => /\.ya?ml$/.test(name));

test('there are workflow files to check', () => assert.ok(files.length > 0));

for (const name of files) {
  test(`${name} is valid YAML (GitHub refuses the whole file otherwise)`, () => {
    try {
      execFileSync('ruby', ['-ryaml', '-e', 'YAML.load_file(ARGV[0])', join(DIR, name)], {stdio: 'pipe'});   // ruby ships with ubuntu-24.04 and macOS; no npm or pip package in this repo parses YAML
    } catch (error) {
      assert.fail(`${name} does not parse: ${String(error.stderr).split('\n').find(line => /Syntax|mapping|did not find|could not find/.test(line)) || error.message}`);
    }
  });
}
