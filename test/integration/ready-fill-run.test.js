// The container's POST /run body (hosted/ready-fill/run-request.mjs, used by main.mjs): the task the Worker names reaches runNight, a body without one is the fill it always was, and nothing but a known task starts a browser.
// Cloud runner 2/4 (8 Nov 2026). The real /run is proved in the built image by hosted/ready-fill/image-check.mjs; this loads the parser without Playwright.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const {parseRun} = await import(new URL('../../hosted/ready-fill/run-request.mjs', import.meta.url));
const TASKS = ['fill', 'readiness'];

test('a body without a task is a fill night, as every night before the cloud runner', () => {
  assert.deepEqual(parseRun({site: 'https://x', token: 't'}, TASKS), {site: 'https://x', token: 't', task: 'fill'});
  assert.deepEqual(parseRun({}, TASKS), {site: '', token: '', task: 'fill'});
});

test('readiness and fill pass; auto, a typo and a non-string are refused before anything opens', () => {
  assert.equal(parseRun({site: 's', token: 't', task: 'readiness'}, TASKS).task, 'readiness');
  assert.equal(parseRun({task: 'fill'}, TASKS).task, 'fill');
  for (const task of ['auto', 'Fill', 'read', '', null, 7, ['fill'], {}]) assert.match(parseRun({task}, TASKS).error, /^unknown night task/, JSON.stringify(task));
  assert.ok(parseRun({task: 'x'.repeat(500)}, TASKS).error.length < 60, 'a long word is cut');
});

test('main.mjs answers 400 for a refused task and hands the task to runNight', () => {
  // Why (8 Nov 2026, cloud runner 2/4): the parser is proved above, so this keeps main.mjs from dropping its result (the task was ignored before: a readiness night would have filled).
  const main = readFileSync(new URL('../../hosted/ready-fill/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /parseRun\(given, TASKS\)/);
  assert.match(main, /if \(run\.error\) return json\(response, 400/);
  assert.match(main, /runNight\(\{chromium, site: run\.site, token, task: run\.task,/);
});
