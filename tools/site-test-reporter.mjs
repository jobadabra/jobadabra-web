// node:test reporter for the Site tests and the guards step: one summary (counts, duration), each failure in full, nothing for a test that passed.
// Why (6 Nov 2026, owner: "it's too verbose. I want only the summary, not every test detail"): the spec reporter printed a line per test, ~950 on a PR; a red run was hard to find in them.
// Usage: node --test --test-reporter=tools/site-test-reporter.mjs <files>. A failure keeps what the spec reporter showed: the test's full name, its file, the assertion with its diff and stack;
// a file with a failure also prints what it wrote to stdout/stderr (a crash before any test has its cause only there). Skip reasons and t.diagnostic notes are kept: a walk that skipped for want of a browser,
// and a route the Worker has that public does not list (site-routes.test.js), must not look like a plain pass. The exit code is node's own: this changes only what is printed.
import path from 'node:path';
import {inspect} from 'node:util';

const ANSI = /\u001b\[[0-9;]*m/g;
const seconds = ms => (ms / 1000).toFixed(1);

export default async function* siteTestReporter(source) {
  const started = Date.now();
  const count = {pass: 0, fail: 0, skipped: 0, todo: 0};
  const names = new Map(), output = new Map(), failures = [], notes = [];
  for await (const {type, data} of source) {
    if (type === 'test:start') {
      const stack = names.get(data.file) || [];
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      names.set(data.file, stack);
    } else if (type === 'test:stdout' || type === 'test:stderr') {
      output.set(data.file, (output.get(data.file) || '') + data.message);
    } else if (type === 'test:diagnostic') {
      if (data.file) notes.push(`${path.basename(data.file)}: ${data.message}`);   // node's own totals carry no file
    } else if (type === 'test:pass' || type === 'test:fail') {
      const error = data.details?.error;
      if (error?.failureType === 'subtestsFailed') continue;   // the parent of a failed subtest: the subtest is the failure
      if (data.details?.type === 'suite' && type === 'test:pass') continue;   // a suite that failed on its own (a hook that threw) still counts below
      const todo = data.todo !== undefined && data.todo !== false, skipped = data.skip !== undefined && data.skip !== false;
      if (todo) count.todo++;   // node's exit code ignores a failing todo
      else if (type === 'test:fail') {
        count.fail++;
        const stack = (names.get(data.file) || []).slice(0, data.nesting);
        failures.push({file: data.file, name: [...stack, data.name].join(' › '), error});
      } else if (skipped) {
        count.skipped++;
        notes.push(`skipped ${path.basename(data.file || '')} › ${data.name}${typeof data.skip === 'string' ? `: ${data.skip}` : ''}`);
      } else count.pass++;
    }
  }
  const failedFiles = new Set();
  for (const {file, name, error} of failures) {
    failedFiles.add(file);
    yield `\n✖ ${name}\n  ${file || ''}\n${inspect(error?.cause ?? error ?? 'failed with no error').replace(ANSI, '').replace(/^/gm, '  ')}\n`;
  }
  for (const file of failedFiles) {
    const text = (output.get(file) || '').replace(ANSI, '').trim();
    if (text) yield `\n--- output of ${file} ---\n${text}\n`;
  }
  if (notes.length) yield `\n${notes.join('\n')}\n`;
  const skipped = count.skipped ? `, ${count.skipped} skipped` : '', todo = count.todo ? `, ${count.todo} todo` : '';
  yield `\nsite-tests: ${count.pass} passed, ${count.fail} failed${skipped}${todo} in ${seconds(Date.now() - started)} s\n`;
}
