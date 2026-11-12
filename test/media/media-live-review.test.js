// The live form states a hero `review` step sends: one more field each time, the last Ready to submit, in the shape the app's form card reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {liveStates} from '../../media/live-review.mjs';
import {VIDEOS} from '../../media/scenes.mjs';

test('each state fills one more field; only the last is ready', () => {
  const states = liveStates({id: 'd1', url: 'https://jobs.example/x', fields: ['First name', 'Last name', 'Email'], start: 1000, every: 200});
  assert.deepEqual(states.map(state => [state.total - state.left, state.ready]), [[1, false], [2, false], [3, true]]);
  assert.deepEqual(states[1].filled, [{label: 'First name', at: 1000}, {label: 'Last name', at: 1200}]);
  assert.deepEqual(states[1].pending, ['Email']);
  for (const state of states) for (const key of ['id', 'url', 'left', 'total', 'ready', 'filled', 'missing', 'pending', 'states', 'proposals', 'optional']) assert.ok(key in state, key);
});

test('a review step without a session or fields stops the recording', () => {
  assert.throws(() => liveStates({id: 'd1', fields: []}), /names its session id/);
  assert.throws(() => liveStates({fields: ['Email']}), /names its session id/);
});

test('every review step in the scenes names a session the persona has a form for', async () => {
  const fs = await import('node:fs');
  const review = JSON.parse(fs.readFileSync(new URL('../../media/personas/nurse-lyon/review.json', import.meta.url), 'utf8'));
  const steps = Object.values(VIDEOS).flatMap(piece => piece.steps || []).filter(step => step.review);
  for (const step of steps) {
    const form = review.find(state => state.id === step.review.id);
    assert.ok(form, `review step for ${step.review.id}: no form state in nurse-lyon/review.json`);
    assert.equal(step.review.fields.length, form.total, `review step for ${step.review.id}: fills ${step.review.fields.length} of the form's ${form.total} fields`);
  }
});

// 12 Nov 2026: the extension leaves the consent box to the person; the card replays the extension's own reports, so both sides count the same.
test('the card replays the extension\'s reports from the fill\'s start, with the demo session\'s id and url, the last state kept as sent', async () => {
  const {fromReports} = await import('../../media/live-review.mjs');
  const reports = [{t: 1.3, left: 6, total: 6, tab: 9, boot: 'b', job: 'j', session: 's'}, {t: 1.7, left: 6, total: 6}, {t: 3.0, left: 2, total: 6}, {t: 4.1, left: 1, total: 7, missing: ['I agree']}];
  const out = fromReports({id: 'd1', url: 'https://jobs.example/x', reports, sync: 2.5});
  assert.deepEqual(out.map(one => [one.at, one.state.left, one.state.total]), [[0, 6, 6], [0.5, 2, 6], [1.6, 1, 7]], 'the last report before the start opens it; later ones at their own times');
  assert.ok(out.every(one => one.state.id === 'd1' && one.state.url === 'https://jobs.example/x' && !('tab' in one.state) && !('t' in one.state)));
  assert.deepEqual(out.at(-1).state.missing, ['I agree'], 'the field left for the person stays on the card');
  assert.throws(() => fromReports({id: 'd1', reports: []}), /at least one report/);
});
