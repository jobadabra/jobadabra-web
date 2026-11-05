// A script run as `node <file>` knows it is the entry by comparing file URLs made by node:url, never `file://${process.argv[1]}`: on Windows argv[1] is
// "D:\a\_temp\…", which never equals import.meta.url ("file:///D:/a/_temp/…"), so main() never ran and the script exited silently.
// 26 Oct 2026: the public repo's Windows e2e suites start jobs/persona-search/free-ai-local.mjs (the Free AI relay); it printed only Node's SQLite warning and
// never "listening" (run 40266023547). This test walks every tracked script, so a new one is held to it too.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
// This repo's own folders (as test/guards/brand-wording.test.js): CI runs these tests in the tree joined with the public repo, whose scripts are its own to keep.
const OWN = /^(web|admin|api|shared|workers|jobs|media|preview|db)\//;
const SCRIPTS = execFileSync('git', ['ls-files', '*.mjs', '*.js'], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(file => OWN.test(file));

test('no script finds out it is the entry with a hand-made file:// URL (never true on Windows)', () => {
  const wrong = SCRIPTS.filter(file => /file:\/\/\$\{process\.argv\[1\]\}/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
  assert.deepEqual(wrong, [], 'compare with pathToFileURL(process.argv[1] || \'\').href (node:url)');
});

test('the URL node:url makes from a Windows path is the one import.meta.url holds there', () => {
  assert.equal(pathToFileURL('/home/runner/x.mjs').href, 'file:///home/runner/x.mjs');
  if (process.platform === 'win32') assert.equal(pathToFileURL('D:\\a\\_temp\\x.mjs').href, 'file:///D:/a/_temp/x.mjs');
  assert.notEqual(`file://${'D:\\a\\_temp\\x.mjs'}`, 'file:///D:/a/_temp/x.mjs');   // the old guard's comparison, as it ran on Windows
});

test('the relay still starts when run as a script', () => {
  const relay = fs.readFileSync(path.join(ROOT, 'jobs/persona-search/free-ai-local.mjs'), 'utf8');
  assert.match(relay, /import\.meta\.url === pathToFileURL\(process\.argv\[1\] \|\| ''\)\.href\) await main\(\)/);
});
