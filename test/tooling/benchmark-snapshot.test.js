// Public benchmark aggregates preserve scores, sample sizes and missing observations without publishing source content.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {searchSnapshot, formSnapshot} from '../../tools/benchmark-snapshot.mjs';

test('search keeps role, strict place, remote and their intersection distinct', () => {
  const row = (tool, role, place) => ({tool, role, place, title: 'DO NOT PUBLISH', company: 'PRIVATE'});
  const snapshot = searchSnapshot([
    {persona: {title: 'Developer', city: 'Paris', country: 'France'}, judged_jobs: 3,
      rows: [row('ours', 'yes', 'remote'), row('ours', 'no', 'yes'), row('jobspy', 'yes', 'yes')]},
    {persona: {title: 'Chef', city: 'Rome', country: 'Italy'}, judged_jobs: 1,
      rows: [row('jobspy', 'no', 'unknown')]},
  ]);
  assert.equal(snapshot.judgedJobs, 4);
  assert.equal(snapshot.returnedRows, 4);
  const ours = snapshot.tools.find(t => t.key === 'ours');
  assert.deepEqual([ours.found, ours.role, ours.place, ours.remote, ours.relevant, ours.observedPersonas], [2, 1, 1, 1, 0, 1]);
  assert.equal(snapshot.personas[1].tools.ours, undefined, 'absence is not a measured zero');
  assert.doesNotMatch(JSON.stringify(snapshot), /DO NOT PUBLISH|PRIVATE/);
});

test('form scores use saved count splits, rank every contestant, and omit a one-repeat spread', () => {
  const run = {right: 8, wrong: 0, emptyAnswerable: 1, notReached: 1, forms: 6};
  const data = formSnapshot({extension: {runs: [run]}, 'browser-use': {runs: [{...run, right: 9, emptyAnswerable: 0}]}});
  assert.deepEqual(data.tools.map(t => [t.key, t.score]), [['browser-use', 90], ['extension', 80]]);
  assert.equal(data.tools[0].spread, null);
  assert.equal(data.tools[0].repeats, 1);
  assert.equal(data.tools[1].empty, 1);
  assert.equal(data.tools[1].notReached, 1);
});

test('incomplete or invalid judged inputs fail closed', () => {
  assert.throws(() => searchSnapshot([{persona: {}, judged_jobs: 1, rows: [{tool: 'ours', role: 'maybe', place: 'yes'}]}]), /verdict/);
  assert.throws(() => formSnapshot({extension: {runs: []}}), /runs/);
  assert.throws(() => formSnapshot({extension: {runs: [{right: -1}]}}), /count/);
});
