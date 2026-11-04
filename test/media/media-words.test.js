// A words-only redo redraws the kept recording with the scenes' current words (owner, 24 Oct 2026: "you should have rerecord just one 1/4 clips"):
// each hold takes its step's caption, tag and card; a changed look or step count refuses, so a real change is recorded again.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rewordLog} from '../../media/words.mjs';

const log = {viewport: {w: 10, h: 10}, frames: [{t: 0, file: 'a.jpg'}], events: [
  {t: 0, type: 'hold', look: '#a', s: 2, say: 'She opens it', tag: 'Her job'},
  {t: 2, type: 'mark'},
  {t: 2.1, type: 'hold', look: ['#b', '#c'], s: 2, cut: true, into: 'card', say: 'She checks', tag: 'Actions', card: {tag: 'Actions', text: 'She opens Jobadabra'}},
]};
const piece = {steps: [{go: 'x'}, {hold: 2, look: '#a', say: 'One job opens', tag: 'The job'}, {tap: '#t'}, {hold: 2, look: ['#b', '#c'], cut: true, into: 'card', card: 'Jobadabra checks the mail', tag: 'Actions', say: 'Check Gmail'}]};

test('each hold takes its step\'s caption, tag and card; times, looks and the rest stay as recorded', () => {
  const out = rewordLog(log, piece);
  assert.deepEqual(out.events.map(event => event.say), ['One job opens', undefined, 'Check Gmail']);
  assert.equal(out.events[0].tag, 'The job');
  assert.deepEqual(out.events[2].card, {tag: 'Actions', text: 'Jobadabra checks the mail'});
  assert.deepEqual(out.events.map(event => event.t), [0, 2, 2.1]);
  assert.equal(out.frames, log.frames);
});

test('a step that lost its caption loses it in the log too', () => {
  const out = rewordLog(log, {steps: [{hold: 2, look: '#a'}, piece.steps[3]]});
  assert.equal(out.events[0].say, undefined);
  assert.equal(out.events[0].tag, undefined);
});

test('a changed look or a new hold is not a words-only change: record again', () => {
  assert.throws(() => rewordLog(log, {steps: [{hold: 2, look: '#z'}, piece.steps[3]]}, 'hero'), /hero: hold 1 looks at "#z" now.*record it again/);
  assert.throws(() => rewordLog(log, {steps: [...piece.steps, {hold: 1, look: '#d'}]}, 'hero'), /3 holds in scenes.mjs, 2 in the kept recording/);
});
