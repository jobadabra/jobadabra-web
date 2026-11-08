// The step yield of the nightly Search check (owner, 8 Nov 2026: "Can I get in Admin these stats as well?"): each verdict row may carry `step_yield`, the per-step seconds, jobs, local jobs and local fit 70+ of the Find jobs run.
// Guard for admin/search-night-yield.js, the field in clean() (whole numbers or null, never made-up zeros, no free text), and the card in the tab: drawn from the newest night's rows, nothing when no row has the list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {cleanStepYield, stepYieldSection, summarise} from '../../../../admin/search-night-yield.js';
import {nightSection} from '../../../../admin/search-night-page.js';

const step = (name, seconds, jobs, local, localFit70) => ({step: name, seconds, jobs, local, scored: local, fit70: localFit70, local_fit70: localFit70});
const verdict = rows => ({state: 'success', head: 'measured 2 of 2', rows: rows.map((stepYield, index) => ({persona: index + 1, label: `p${index + 1} Role, City`, kind: 'measured', local: 3, found: 9, seconds: 90, ...(stepYield ? {step_yield: stepYield} : {})}))});
const NIGHT = '2026-11-20', NOW = new Date('2026-11-21T00:00:00Z');   // a fixed clock: clean() refuses a night in the future

test('clean() keeps the step yield as whole numbers or null: free text, negative numbers and an odd step name never reach the store', () => {
  const kept = cleanStepYield([step('employer_sites', 41.26, 12, 9, 3), {step: 'job_boards', seconds: null, jobs: '7', local: -1, scored: 2.5, fit70: 1, local_fit70: 0, company: 'Acme'}, {step: '<b>x</b>', jobs: 1}, null, 'text']);
  assert.deepEqual(kept, [{step: 'employer_sites', seconds: 41.3, jobs: 12, local: 9, scored: 9, fit70: 3, localFit70: 3},
    {step: 'job_boards', seconds: null, jobs: null, local: null, scored: null, fit70: 1, localFit70: 0}]);
  assert.equal(cleanStepYield(undefined), null, 'no list: nothing is claimed, no zeros');
  assert.equal(cleanStepYield(Array.from({length: 20}, (_, i) => step(`step_${'abcdefghijklmnopqrst'[i]}`, 1, 1, 1, 1))).length, 8);
  const stored = clean(verdict([[step('scoring', 30, 50, 12, 5)], null]), {night: NIGHT}, NOW);
  assert.equal(stored.rows[0].stepYield[0].localFit70, 5);
  assert.equal(stored.rows[1].stepYield, null);
});

test('summarise: jobs, local and fit added up over the candidates; the rate is total local over total TIMED seconds; a step nobody timed has no rate, never 0', () => {
  const rows = [{label: 'p1', stepYield: cleanStepYield([step('employer_sites', 60, 20, 12, 4), step('job_boards', null, 5, 2, 1)])},
    {label: 'p2', stepYield: cleanStepYield([step('employer_sites', 30, 10, 3, 1), step('job_boards', null, 7, 4, 0)])}, {label: 'p3', stepYield: null}];
  const [sites, boards] = summarise(rows);
  assert.deepEqual([sites.step, sites.personas, sites.seconds, sites.jobs, sites.local, sites.localFit70, sites.perMinute], ['employer_sites', 2, 45, 30, 15, 5, 10]);
  assert.deepEqual([boards.personas, boards.seconds, boards.jobs, boards.local, boards.perMinute], [2, null, 12, 6, null]);
});

test('the card: a summary per step, every candidate under a toggle, escaped; nothing at all when no row carries a step yield', () => {
  const rows = [{label: 'p1 <i>Nurse</i>, Lyon', stepYield: cleanStepYield([step('free_job_apis', 12, 8, 6, 2)])}];
  const html = stepYieldSection(rows, NIGHT);
  assert.match(html, /What each step brought, night 2026-11-20/);
  assert.match(html, /Free job APIs/);
  assert.match(html, /30\/min/, '6 local jobs in 12 s = 30 per minute');
  assert.match(html, /<details><summary>Every candidate/);
  assert.equal((html.match(/<table class="wide">/g) || []).length, 2, 'both tables take the shared .wide rule: on a phone they keep their width and scroll sideways inside the card (owner, 8 Nov 2026: "Yes, fix the phone width first")');
  assert.ok(!html.includes('<i>Nurse</i>'), 'a label is escaped');
  assert.equal(stepYieldSection([{label: 'p1', stepYield: null}, {label: 'p2'}], NIGHT), '');
  assert.match(stepYieldSection([{label: 'p1', stepYield: cleanStepYield([step('job_boards', null, 5, 2, 1)])}], NIGHT), /not timed yet/);
});

test('a step timed at 0 s is timed: its seconds count in the median and its rate is a dash, never "not timed yet" beside "0 s" (Gitar, #497)', () => {
  const rows = [{label: 'p1', stepYield: cleanStepYield([step('free_job_apis', 0, 4, 2, 1)])}, {label: 'p2', stepYield: cleanStepYield([step('free_job_apis', 10, 4, 2, 1)])}];
  const [apis] = summarise(rows);
  assert.deepEqual([apis.seconds, apis.perMinute], [5, 24], 'median of 0 and 10 s; the rate is all local jobs over all timed seconds: 4 local in 10 s');
  const alone = stepYieldSection([rows[0]], NIGHT);
  assert.match(alone, /0 s/);
  assert.ok(!alone.includes('not timed yet'), 'a timed step is never "not timed yet"');
});

test('the tab shows the card under the candidates for the newest night, and an older night without the list changes nothing', () => {
  const withYield = {...clean(verdict([[step('employer_sites', 40, 10, 5, 2)], [step('employer_sites', 20, 6, 3, 1)]]), {night: NIGHT}, NOW), at: `${NIGHT}T04:00:00.000Z`};
  const older = {...clean(verdict([null, null]), {night: '2026-11-19'}, NOW), at: '2026-11-19T04:00:00.000Z'};
  const html = nightSection(judgeAll([withYield, older]));
  assert.ok(html.indexOf('What each step brought') > html.indexOf('candidates, night'), 'under the candidates card');
  assert.equal((html.match(/What each step brought/g) || []).length, 1);
  assert.ok(!nightSection(judgeAll([older])).includes('What each step brought'));
});
