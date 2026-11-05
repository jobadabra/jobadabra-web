// The desktop hero's depth gate (media/fits.mjs; owner, 25 Oct 2026: "zoom deeper, about 1.5x"): a look that ends below 1.5x stops the piece.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_ZOOM, shallowLooks, widestAt} from '../../media/fits.mjs';
import {wholeFrame} from '../../media/whole.mjs';
import {CLICK_FLOOR, DESKTOP_FLOOR, DESKTOP_SHIFT, cameraKeys} from '../../media/camera.mjs';
import {VIDEOS} from '../../media/scenes.mjs';

const viewport = {w: 1440, h: 900};
const logOf = (width, extra = {}) => ({viewport, frames: [{t: 0, file: 'a'}, {t: 3, file: 'b'}], events: [{t: 0, type: 'hold', look: 'x', s: 3, zoom: 2.2, box: {x: 20, y: 300, width, height: 120}, ...extra}]});

test('a look wider than 1.5x shows is named with the width that fits', () => {
  const [hit] = shallowLooks(logOf(1100));
  assert.equal(hit.look, 'x');
  assert.ok(hit.used < MIN_ZOOM && hit.fits === widestAt(MIN_ZOOM, viewport), `${hit.used} ${hit.fits}`);
});

test('a look that fits 1.5x, or says wide, passes', () => {
  assert.deepEqual(shallowLooks(logOf(widestAt(MIN_ZOOM, viewport) - 2)), []);
  assert.deepEqual(shallowLooks(logOf(1300, {wide: true})), []);
});

// The class: no desktop look in a scene asks below the bar unless it says wide (a look that asks 1.3 can never end deeper).
test('every hero look asks at least MIN_ZOOM, unless it is a whole-screen look', () => {
  for (const [name, piece] of Object.entries(VIDEOS)) {
    for (const step of piece.steps.filter(each => each.hold && each.look && each.zoom && each.zoom !== 1)) {
      assert.ok(step.zoom >= MIN_ZOOM || step.wide, `${name}: ${step.beat || JSON.stringify(step.look)} asks ${step.zoom}: ask ${MIN_ZOOM}+ or say wide: true`);
    }
  }
});

// The cause of 1.0-1.2x on narrow looks (run 3, 25 Oct 2026): the camera zoomed out until both frame edges fell in a gap, and a page of text has none.
test('a desktop frame never zooms out below the floor to find a clean edge, and picks the edges that cut least', () => {
  const edges = Array.from({length: 30}, (_, i) => ({k: 'text', x: 0, y: 20 * i, w: 1440, h: 14, text: `line ${i}`}));   // text across the whole page: no gap anywhere
  const look = {x: 600, y: 300, width: 200, height: 100}, frameAt = z => ({cx: 700, cy: 350, z});
  const args = {frameAt, z: 2.2, least: 1, look, edges, viewport, aspect: 1.6};
  assert.equal(wholeFrame(args).z, 1, 'without a floor the camera falls back to the whole page');
  assert.ok(Math.abs(wholeFrame({...args, floor: DESKTOP_FLOOR}).z - DESKTOP_FLOOR) < 1e-6, 'with the floor it stops at 1.5x');
  assert.equal(wholeFrame({...args, z: 1.2, floor: DESKTOP_FLOOR}).z, 1.2, 'a look asked below the floor keeps its own zoom');
});

// owner, 25 Oct 2026: the close zoom on Use Free AI came out near 1.5x, the edge search having backed it off (run 5)
test('a desktop click zoom keeps CLICK_FLOOR when no frame has clean edges', () => {
  const edges = Array.from({length: 40}, (_, i) => ({k: 'text', x: 0, y: 20 * i, w: 1440, h: 14, text: `line ${i}`}));
  const events = [{t: 0, type: 'hold', look: 'a', box: {x: 100, y: 100, width: 600, height: 200}, s: 1, edges}, {t: 1.1, type: 'click', box: {x: 1300, y: 800, width: 100, height: 40}, zoom: 3, edges},
    {t: 1.8, type: 'press', box: {x: 1300, y: 800, width: 100, height: 40}}];
  const keys = cameraKeys({viewport, events, steady: true});
  assert.ok(keys.at(-1).z >= CLICK_FLOOR - 1e-6, `the click zoom ends at ${keys.at(-1).z}`);
});

// owner, 25 Oct 2026: "when we zoom to the Find jobs card, right now it is not centered": a gap between words far from the look's centre pulled the frame sideways
test('a desktop frame stays centred on its look: a clean edge further away than DESKTOP_SHIFT is not worth it', () => {
  const look = {x: 560, y: 300, width: 320, height: 160}, frameAt = z => ({cx: 720, cy: 380, z});
  // words everywhere except a gap at x 100-130 (the left edge could sit there, 300 px off centre) and a gap in the middle that is too narrow for both edges
  const edges = Array.from({length: 40}, (_, i) => [{k: 'text', x: 0, y: 20 * i, w: 100, h: 14, text: 'a'}, {k: 'text', x: 130, y: 20 * i, w: 1310, h: 14, text: 'b'}]).flat();
  const args = {frameAt, z: 2, least: 1, look, edges, viewport, aspect: 1.6};
  const free = wholeFrame(args), held = wholeFrame({...args, floor: DESKTOP_FLOOR, shift: DESKTOP_SHIFT});
  assert.ok(Math.abs(held.cx - 720) <= DESKTOP_SHIFT + 1, `the frame's centre ${held.cx} stays near 720`);
  assert.ok(held.z >= DESKTOP_FLOOR - 1e-6, `and keeps ${held.z}`);
  assert.ok(free.cx !== undefined);
});
