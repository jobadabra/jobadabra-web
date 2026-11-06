// Guard: the Site tests log is a progress line every few seconds, each failure in full, the slowest files and the summary, no line per passing test (owner, 6 Nov 2026: "it's too verbose. I want only the summary, not every test detail";
// "I get no live updates, no live summary"). Runs tools/site-test-reporter.mjs over scratch passing, failing, crashing and slow files, the way tools/site-tests.sh does.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const reporter = new URL('../../tools/site-test-reporter.mjs', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-reporter-'));
test.after(() => fs.rmSync(dir, {recursive: true, force: true}));
fs.writeFileSync(path.join(dir, 'good.test.js'), "import {test} from 'node:test';\ntest('a quiet passing test', () => {});\ntest('a skipped one', {skip: 'no browser'}, () => {});\ntest('a told one', t => { t.diagnostic('route ahead of the list'); });\ntest('a todo that fails', {todo: true}, () => { throw new Error('not yet'); });\n");
fs.writeFileSync(path.join(dir, 'bad.test.js'), "import assert from 'node:assert/strict';\nimport {test} from 'node:test';\n"
  + "test('outer', async t => { await t.test('inner breaks', () => { assert.equal(1 + 1, 3, 'the sum is wrong'); }); });\n");
fs.writeFileSync(path.join(dir, 'crash.test.js'), "console.error('cannot load the thing');\nthrow new Error('crashed before any test');\n");
fs.writeFileSync(path.join(dir, 'slow.test.js'), "import {test} from 'node:test';\ntest('takes a while', async () => { await new Promise(resolve => setTimeout(resolve, 4000)); });\n");
const env = {...process.env};
delete env.NODE_TEST_CONTEXT;   // this test runs under node --test: a child that inherits it reports to its parent instead of running as the top-level run
const run = (...files) => spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files.map(file => path.join(dir, file))], {encoding: 'utf8', env});

test('a green run prints the summary, the skip reason and the told note, and no passing test name', () => {
  const run1 = run('good.test.js');
  assert.equal(run1.status, 0);
  assert.match(run1.stdout, /site-tests: 2 passed, 0 failed, 1 skipped, 1 todo in 1 files, [\d.]+ s/, 'a failing todo is not a failure (node exits 0)');
  assert.ok(run1.stdout.includes('skipped good.test.js › a skipped one: no browser'), run1.stdout);
  assert.ok(run1.stdout.includes('good.test.js: route ahead of the list'), run1.stdout);
  assert.ok(!run1.stdout.includes('quiet passing') && !run1.stdout.includes('not yet'));
  assert.match(run1.stdout, /slowest files \(\d+ run at once\):\n +[\d.]+ s  .*good\.test\.js/);
  assert.equal(run1.stdout.trim().split('\n').length, 7, 'the notes block, the slowest block (a header and one file) and one summary line');
});

test('a failure prints its full name, file, assertion and stack, once; the exit code stays red', () => {
  const out = run('good.test.js', 'bad.test.js');
  assert.notEqual(out.status, 0);
  assert.match(out.stdout, /✖ outer › inner breaks/);
  assert.ok(out.stdout.includes('bad.test.js') && out.stdout.includes('the sum is wrong') && out.stdout.includes('2 !== 3'), out.stdout);
  assert.match(out.stdout, /at .*bad\.test\.js:\d+/, 'the stack points into the test');
  assert.equal(out.stdout.match(/✖/g).length, 1, 'the parent of a failed subtest is not a second failure');
  assert.match(out.stdout, /site-tests: 2 passed, 1 failed, 1 skipped, 1 todo in 2 files/);
  assert.ok(!out.stdout.includes('quiet passing'));
});

test('a file that crashes before any test prints what it wrote, the only place its cause is', () => {
  const out = run('crash.test.js');
  assert.notEqual(out.status, 0);
  assert.match(out.stdout, /crash\.test\.js/);
  assert.ok(out.stdout.includes('cannot load the thing') || out.stdout.includes('crashed before any test'), out.stdout);
  assert.match(out.stdout, /1 failed/);
});

const runLive = (progressMs, ...files) => new Promise(resolve => {
  const child = spawn(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files.map(file => path.join(dir, file))], {env: {...env, SITE_TEST_PROGRESS_MS: String(progressMs)}});
  const began = Date.now(), chunks = [];
  child.stdout.on('data', data => chunks.push({at: Date.now() - began, text: String(data)}));
  child.on('close', status => resolve({status, chunks, ms: Date.now() - began, text: chunks.map(chunk => chunk.text).join('')}));
});

test('a slow run shows life before it ends: a progress line with the real total, and a failed file named when it ends', async () => {
  const out = await runLive(400, 'slow.test.js', 'bad.test.js', 'good.test.js');
  assert.notEqual(out.status, 0);
  const firstProgress = out.chunks.find(chunk => /\d+ of 3 files · \d+ passed · \d+ failed · \d+ s/.test(chunk.text));
  assert.ok(firstProgress, out.text);
  assert.ok(firstProgress.at < out.ms - 1500, `the first progress line came at ${firstProgress.at} ms of ${out.ms} ms: the log was silent until the end`);
  const red = out.chunks.find(chunk => /bad\.test\.js/.test(chunk.text));
  assert.ok(red && red.at < out.ms - 1500, `the failed file was named at ${red?.at} ms of ${out.ms} ms: a failure waited for the slow file`);
  assert.match(out.text, /3 of 3 files|in 3 files/);
  assert.match(out.text, /slowest files[^\n]*\n +4\.\d s  \S*slow\.test\.js/, 'the slowest file leads the list with its seconds');
  assert.ok(out.text.includes('the sum is wrong'), 'the assertion is printed in full');
});

test('a green run prints no progress line when it ends before the interval', () => {
  assert.ok(!/ of \d+ files · /.test(run('good.test.js').stdout));
});
