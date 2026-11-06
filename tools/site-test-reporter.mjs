// node:test reporter for the Site tests and the guards step: a progress line every ~15 s, each failure in full, the 5 slowest files and one summary; nothing for a test that passed.
// Why (6 Nov 2026, owner: "it's too verbose. I want only the summary", then on web#461: "I get no live updates, no live summary"): #458 printed nothing until node's stream ended, so a 2-minute step looked hung.
// Design: states: running (a line `62 of 195 files · 540 passed · 0 failed · 40 s` each 15 s, the only output of a green file), failed (the moment a file ends red its assertions and stack print in full if node has handed them over, otherwise a `red:` line names the file at once
// (node hands a file's details over only when the files streamed before it have ended) and they follow in full), finished (the files that crashed or failed, 5 slowest files, the one summary line).
// This file owns all of that output. The total comes from the stream's own `test:enqueue` of each file, not from a count passed in. A failure keeps what the spec reporter showed: the test's full name, its file,
// the assertion with its diff and stack; a file with a failure also prints what it wrote to stdout/stderr (a crash before any test has its cause only there). Skip reasons and t.diagnostic notes are kept:
// a walk that skipped for want of a browser, and a route the Worker has that public does not list (site-routes.test.js), must not look like a plain pass. The exit code is node's own: this changes only what is printed.
// Env: SITE_TEST_PROGRESS_MS (default 15000) is the progress interval, SITE_TEST_SLOWEST (default 5) the number of slowest files listed.
import os from 'node:os';
import path from 'node:path';
import {inspect} from 'node:util';

const ANSI = /\u001b\[[0-9;]*m/g;
const seconds = ms => (ms / 1000).toFixed(1);
const TICK = Symbol('tick');

export default async function* siteTestReporter(source) {
  const started = Date.now();
  const every = Number(process.env.SITE_TEST_PROGRESS_MS) || 15000, slowest = Number(process.env.SITE_TEST_SLOWEST) || 40;
  const count = {pass: 0, fail: 0, skipped: 0, todo: 0};
  const names = new Map(), output = new Map(), notes = [], filesTimed = [], printedOutput = new Set(), failedFiles = new Set();
  let total = 0, ended = 0;
  const here = file => path.relative(process.cwd(), file || '') || file || '';
  const progress = () => `${ended} of ${total || '?'} files · ${count.pass} passed · ${count.fail} failed · ${Math.round((Date.now() - started) / 1000)} s\n`;
  const fileOutput = function* (file) {
    const text = (output.get(file) || '').replace(ANSI, '').trim();
    if (failedFiles.has(file) && text && !printedOutput.has(file)) { printedOutput.add(file); yield `\n--- output of ${here(file)} ---\n${text}\n`; }
  };

  const events = source[Symbol.asyncIterator]();
  let pending = events.next(), nextTick = Date.now() + every;
  for (;;) {
    let timer;
    const got = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, nextTick - Date.now()), TICK); })]);
    clearTimeout(timer);
    if (got === TICK) { yield progress(); nextTick = Date.now() + every; continue; }
    if (got.done) break;
    pending = events.next();
    const {type, data} = got.value;
    const isFile = data.file && data.nesting === 0 && path.resolve(data.name || '') === data.file;   // a file's own test, not a top-level test inside it
    if (type === 'test:enqueue' && isFile) total++;
    else if (type === 'test:complete' && isFile) {   // the one event node sends while the file runs in parallel with others, in the order files end
      ended++;
      if (typeof data.details?.duration_ms === 'number') filesTimed.push({file: data.file, ms: data.details.duration_ms});
      if ((data.details?.passed === false || data.details?.error) && !failedFiles.has(data.file)) yield `red: ${here(data.file)} (${seconds(data.details.duration_ms || 0)} s; its assertions print once the files before it have ended)\n`;
    } else if (type === 'test:start') {
      const stack = names.get(data.file) || [];
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      names.set(data.file, stack);
    } else if (type === 'test:stdout' || type === 'test:stderr') {
      output.set(data.file, (output.get(data.file) || '') + data.message);
    } else if (type === 'test:summary' && data.file) {
      yield* fileOutput(data.file);   // a failed file's last event: everything it wrote is here
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
        failedFiles.add(data.file);
        const stack = (names.get(data.file) || []).slice(0, data.nesting);
        yield `\n✖ ${[...stack, data.name].join(' › ')}\n  ${data.file || ''}\n${inspect(error?.cause ?? error ?? 'failed with no error').replace(ANSI, '').replace(/^/gm, '  ')}\n`;
      } else if (skipped) {
        count.skipped++;
        notes.push(`skipped ${path.basename(data.file || '')} › ${data.name}${typeof data.skip === 'string' ? `: ${data.skip}` : ''}`);
      } else count.pass++;
    }
    if (Date.now() >= nextTick) { yield progress(); nextTick = Date.now() + every; }   // a busy stream must not starve the timer
  }
  for (const file of failedFiles) yield* fileOutput(file);   // a file whose summary never came
  if (notes.length) yield `\n${notes.join('\n')}\n`;
  if (filesTimed.length) {
    const top = filesTimed.sort((a, b) => b.ms - a.ms).slice(0, slowest);
    yield `\nslowest files (${Math.max(1, os.availableParallelism() - 1)} run at once):\n${top.map(({file, ms}) => `  ${seconds(ms).padStart(6)} s  ${here(file)}`).join('\n')}\n`;
  }
  const skipped = count.skipped ? `, ${count.skipped} skipped` : '', todo = count.todo ? `, ${count.todo} todo` : '';
  yield `\nsite-tests: ${count.pass} passed, ${count.fail} failed${skipped}${todo} in ${ended} files, ${seconds(Date.now() - started)} s\n`;
}
