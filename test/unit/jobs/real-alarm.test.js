// The real installs' search alarm (jobs/persona-search/real-alarm.mjs): 3+ installs with 0 relevant jobs files the field × country's issue, none closes it,
// 1-2 stay quiet (k >= 3); the issue is the search robot's (search-alarm.mjs), with counts only. The workflow runs it after the draw's alarm.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {caseOf} from '../../../jobs/persona-search/real-alarm.mjs';
import {body, fingerprint, labels, title} from '../../../jobs/persona-search/search-alarm.mjs';

const group = more => ({family: 'aviation_transport', name: 'Aviation & transport', country: 'DE', installs: 4, zero: 3, in_places: 900, ...more});

test('3 of 4 installs with 0 relevant jobs file one medium issue per field × country, counts only', () => {
  const {verdict, case: c} = caseOf(group(), '2026-10-26');
  assert.equal(verdict, 'file');
  assert.equal(title(c), '[auto-search] Aviation & transport · DE · real installs, latest search: 0 relevant jobs');
  assert.equal(fingerprint(c), 'search-aviation-transport-de-real');
  assert.deepEqual(labels(c).slice(0, 4), ['auto-search', 'kind:search-gap', 'source:real-installs', 'severity:medium']);
  for (const row of ['| Installs (k ≥ 3) | 4 |', '| With 0 relevant jobs | 3 |', '| Jobs in the places (median) | 900 |', 'k ≥ 3']) assert.ok(body(c).includes(row), row);
  assert.equal(caseOf(group({installs: 3}), '2026-10-26').case.severity, 'high', 'every install empty: high');
});

test('none empty passes (closes an open issue); 1-2 empty say nothing', () => {
  assert.equal(caseOf(group({zero: 0}), '2026-10-26').verdict, 'pass');
  assert.equal(caseOf(group({zero: 2}), '2026-10-26').verdict, 'quiet');
});

test('the daily draw runs it after its own alarm, with the same token and the pipe failing the step', () => {
  const yml = readFileSync(new URL('../../../.github/workflows/random-draw.yml', import.meta.url), 'utf8');
  const step = yml.slice(yml.indexOf("- name: Alarm when real installs'"), yml.indexOf('- name: Keep the numbers'));
  assert.ok(yml.indexOf('- name: Alarm when the search came back thin') < yml.indexOf("- name: Alarm when real installs'"));
  assert.match(step, /GH_TOKEN: \$\{\{ steps\.alarm_token\.outputs\.token \}\}/);
  assert.match(step, /set -o pipefail/);
  assert.match(step, /real-alarm\.mjs --run "\$RUN_URL" --dry/);
});

test('both alarms run after a failed search but never without the laid tree (their scripts live in it)', () => {
  const yml = readFileSync(new URL('../../../.github/workflows/random-draw.yml', import.meta.url), 'utf8');
  assert.match(yml, /- name: Lay the public repo's tree under this one\n\s+id: tree/);
  const alarms = yml.split('      - name: ').filter(step => step.startsWith('Alarm when'));
  assert.equal(alarms.length, 2);
  for (const step of alarms) assert.match(step, /if: always\(\) && steps\.tree\.outcome == 'success'/, step.split('\n')[0]);
});
