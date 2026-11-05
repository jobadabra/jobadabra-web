// The GTM readiness collector's pure part (tools/ci-intel/jobs/gtm-readiness-rows.mjs): the registry -> journeys, a run's steps.json -> Tier 1 rows (cut names matched by prefix, a cut-off only against an earlier green run),
// integration results -> Tier 2 tallies, the merge. Numbers are a hand count on a fixed fixture; the last test reads the real registry.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadJourneys} from '../../../desktop/e2e/lib/critical-journeys.mjs';
import {cleanSnapshot} from '../../../admin/gtm-intel.js';
import {expectedSeen, registryParts, runRows, runTests, sameStep, snapshotOf, storedFrom, tally} from '../../../tools/ci-intel/jobs/gtm-readiness-rows.mjs';

const LONG = 'Profile Experience: an edited summary is saved with the Profile save bar, and is still there after a restart of the app, with the other cards untouched';
const registry = {journeys: [{id: 'J1', name: 'Setup', tier: 1, steps: [{suite: 'wizard', step: 'a key is saved'}, {suite: 'wizard', step: 'a CV is read'}, {suite: 'wizard', step: LONG}]},
  {id: 'J5', name: 'Apply', tier: 1, steps: [{suite: 'apply', step: 'a form is filled'}, {suite: 'applyflows', step: 'a form is filled'}]},
  {id: 'J8', name: 'Tailor', tier: 2, steps: [{integration: 'desktop/integration/store/t.test.mjs', test: 'Tailor CV on a job: that job\'s form gets a CV that is made for it'}, {integration: 'desktop/integration/app/u.test.js', test: 'parts', parts: ['a', 'b']}]}],
kept: [{suite: 'apply', step: 'a kept step'}]};
const parts = registryParts(registry), run = {runId: 100, day: '2026-11-01', kind: 'beta'};
const view = (suite, os, ...results) => ({suite, os, results: results.map(([name, status]) => ({name, status}))});

test('the registry gives the journeys (kept steps are journey K), the Tier 1 steps and the Tier 2 tests', () => {
  assert.deepEqual(parts.journeys.map(item => `${item.id}:${item.tier}`), ['J1:1', 'J5:1', 'J8:2', 'K:1']);
  assert.deepEqual([parts.steps.length, parts.tests.length, parts.steps.at(-1).journey], [6, 2, 'K']);
});

test('a steps.json name cut short matches its registry step by prefix from 60 characters; a short name matches exactly', () => {
  const step = parts.steps.find(item => item.name === LONG);
  assert.ok(sameStep(step, LONG.slice(0, 100)));
  assert.ok(!sameStep(step, LONG.slice(0, 50)), 'under 60 characters is not a match');
  assert.ok(sameStep({name: 'a key is saved'}, 'a key is saved') && !sameStep({name: 'a key is saved'}, 'a key is saved later'));
});

test('a run: steps seen and failed per journey and OS; a journey with no suite in the run has no row', () => {
  const rows = runRows(run, parts.steps, [view('wizard', 'mac', ['a key is saved', 'passed'], ['a CV is read', 'failed'], [LONG.slice(0, 100), 'passed']), view('wizard', 'windows', ['a key is saved', 'passed'])], [], () => 0);
  assert.deepEqual(rows, [[100, '2026-11-01', 'beta', 'mac', 'J1', 3, 1, 0], [100, '2026-11-01', 'beta', 'windows', 'J1', 1, 0, 0]]);
});

test('shards: the same step name in apply and applyflows counts once for the journey, the shard suffix is dropped', () => {
  const rows = runRows(run, parts.steps, [view('apply-2of3', 'mac', ['a form is filled', 'passed']), view('applyflows-1of2', 'mac', ['a form is filled', 'passed'])], [], () => 0);
  assert.deepEqual(rows.filter(row => row[4] === 'J5'), [[100, '2026-11-01', 'beta', 'mac', 'J5', 1, 0, 0]], 'one distinct step name');
});

test('cut off: a red suite and fewer steps than an earlier green run is red; a step never seen before is no cut', () => {
  const red = [{suite: 'wizard-1of1', platform: 'mac'}];
  const prior = [[90, '2026-10-31', 'beta', 'mac', 'J1', 3, 0, 0]];
  const died = runRows(run, parts.steps, [view('wizard', 'mac', ['a key is saved', 'passed'])], red, (journey, os) => expectedSeen(prior, journey, os));
  assert.deepEqual(died.find(row => row[4] === 'J1'), [100, '2026-11-01', 'beta', 'mac', 'J1', 1, 0, 1]);
  const dieBeforeAnyStep = runRows(run, parts.steps, [], red, (journey, os) => expectedSeen(prior, journey, os));
  assert.deepEqual(dieBeforeAnyStep, [[100, '2026-11-01', 'beta', 'mac', 'J1', 0, 0, 1]], 'a suite that never reached a step is still red');
  const newStep = runRows(run, parts.steps, [view('wizard', 'mac', ['a key is saved', 'passed'])], red, () => 1);
  assert.equal(newStep.find(row => row[4] === 'J1')[7], 0, 'it showed 1 step before: nothing was cut');
  assert.equal(expectedSeen([[90, 'd', 'beta', 'mac', 'J1', 3, 1, 0], [91, 'd', 'beta', 'mac', 'J1', 2, 0, 1]], 'J1', 'mac'), 0, 'a red or cut run does not set what is normal');
});

test('Tier 2: a journey is red in a run when any of its tests failed on any OS; tests are matched by file and name; the day tallies add up', () => {
  const store = {layer: 'store', platform: 'linux', ms: 1, tests: [{name: 'Tailor CV on a job: that job\'s form gets a CV that is made for it', file: 'desktop/integration/store/t.test.mjs', ok: true, ms: 1}]};
  const app = {layer: 'app', platform: 'windows', ms: 1, tests: [{name: 'a and b together', file: 'desktop/integration/app/u.test.js', ok: false, ms: 1}, {name: 'other', file: 'desktop/integration/app/u.test.js', ok: false, ms: 1}]};
  const first = runTests(parts.tests, [store, app]);
  assert.deepEqual(first, [{journey: 'J8', tests: 2, red: true}]);
  assert.deepEqual(runTests(parts.tests, [store]), [{journey: 'J8', tests: 1, red: false}]);
  assert.deepEqual(runTests(parts.tests, []), [], 'no result for the journey: no observation');
  let days = tally([], '2026-11-01', first);
  days = tally(days, '2026-11-01', runTests(parts.tests, [store]));
  assert.deepEqual(days, [{day: '2026-11-01', journey: 'J8', tests: 2, runs: 2, red: 1}]);
});

test('the snapshot: stored and new rows in run order, 28 days, the newest rows kept, read ids joined; the site accepts the rows', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const stored = {tier1: [[5, '2026-09-01', 'beta', 'mac', 'J1', 1, 0, 0], [7, '2026-10-31', 'beta', 'mac', 'J1', 1, 0, 0]], tier2: [{day: '2026-09-01', journey: 'J8', tests: 1, runs: 1, red: 0}], read: {e2e: [5, 7], integration: [1]}};
  const snapshot = snapshotOf({journeys: parts.journeys, stored, tier1: [[6, '2026-11-01', 'beta', 'mac', 'J1', 1, 0, 0]], tier2: [{day: '2026-11-01', journey: 'J8', tests: 2, runs: 1, red: 0}], read: {e2e: [6, 7], integration: [2]}}, now, 28, 2);
  assert.deepEqual(snapshot.tier1.map(row => row[0]), [6, 7], 'the 1 Sep row is out; the 2 newest by run id');
  assert.deepEqual([snapshot.read.e2e, snapshot.read.integration, snapshot.tier2.length], [[5, 7, 6], [1, 2], 1]);
  const accepted = cleanSnapshot(snapshotOf({journeys: parts.journeys, stored: {}, tier1: runRows(run, parts.steps, [view('wizard', 'mac', ['a key is saved', 'passed'])], [], () => 0), tier2: [], read: {}}, now), now);
  assert.equal(accepted.tier1.length, 1, 'rows built here pass admin/gtm-intel.js cleanSnapshot');
});

test('the real registry: every journey and the kept row are listed, each Tier 1 journey has steps in a suite, each Tier 2 journey has tests in a file', () => {
  const real = registryParts(loadJourneys());
  assert.ok(real.journeys.some(item => item.id === 'K') && real.journeys.some(item => item.id === 'J5' && item.tier === 1) && real.journeys.some(item => item.id === 'J8' && item.tier === 2));
  for (const item of real.journeys.filter(entry => entry.tier === 1)) assert.ok(real.steps.some(step => step.journey === item.id), `${item.id} has e2e steps`);
  for (const item of real.journeys.filter(entry => entry.tier === 2)) assert.ok(real.tests.some(test => test.journey === item.id), `${item.id} has integration tests`);
});

test('the stored snapshot: only a confirmed empty store starts from nothing; any other failed read stops the pass (Gitar #257: it would overwrite 28 days)', () => {
  assert.deepEqual(storedFrom(200, {tier1: [], tier2: []}), {stored: {tier1: [], tier2: []}});
  assert.deepEqual(storedFrom(404, {error: 'no snapshot yet'}), {stored: {}});
  for (const [status, body] of [[undefined, null], [503, {error: 'snapshot unreadable'}], [500, null], [404, null], [404, {error: 'other'}], [200, null], [200, {nope: 1}]]) assert.ok(storedFrom(status, body).stop, `${status} ${JSON.stringify(body)} stops`);
});
