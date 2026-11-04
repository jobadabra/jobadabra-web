// The hero shows the app's own wand cursor and glow (owner, 25 Oct 2026: "I added the correct magic wand cursor (and some glow effect over the wizard cards
// or Find jobs card) ... let's re-record the first 2 clips"). No scene says `wand`: the recorder reads what the app marks on the target (media/hold.mjs
// magicTarget) and moves the real pointer over a glow card (glideTo), so magic.js sees the pointer the drawn cursor follows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {glideTo, magicTarget} from '../../media/hold.mjs';

const el = (selectors, inMagic = false) => ({matches: selector => selector.split(',').some(part => selectors.includes(part.trim().replace(':not(:disabled)', ''))), closest: selector => (selector === '[data-magic]' && inMagic ? {} : null)});

test('a target is a wand target when the app marks it .magic-go or data-wand, a glow target inside data-magic', () => {
  assert.deepEqual(magicTarget(el(['.magic-go'])), {wand: true, glow: false});
  assert.deepEqual(magicTarget(el(['[data-wand]'], true)), {wand: true, glow: true});
  assert.deepEqual(magicTarget(el([], true)), {wand: false, glow: true});
  assert.deepEqual(magicTarget(el([])), {wand: false, glow: false});
});

test('the pointer glides in eased steps to the middle of the target and remembers where it ended', async () => {
  const moves = [], page = {mouse: {move: async (x, y) => moves.push([x, y])}, waitForTimeout: async () => {}};
  const log = {};
  await glideTo(page, {x: 100, y: 200, width: 60, height: 20}, log, 700);
  assert.equal(moves.length, 14);
  assert.deepEqual(moves.at(-1), [130, 210], 'ends on the target\'s middle');
  assert.deepEqual(log.pointer, {x: 130, y: 210});
  const step = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(step(moves[0], moves[1]) < step(moves[5], moves[6]), 'it starts slowly and speeds up');
  moves.length = 0;
  await glideTo(page, {x: 400, y: 300, width: 100, height: 40}, log, 700);
  assert.ok(Math.abs(moves[0][0] - 130) < 40, 'the next glide starts where the last one ended');
});
