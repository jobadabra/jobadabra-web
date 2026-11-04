// Every click or tap in the hero zooms in (owner, 25 Oct 2026: "we should zoom not just when clicking on Build my strategy, that was an example, we should zoom
// enough always when we do a click, so that the user sees and understands where we clicked"). The recorder gives a click or tap without its own zoom the
// default (media/hold.mjs clickZoom); the one way out is `zoom: false`, allowed only for the job drawer's tabs, which stay at the drawer's one zoom (owner, 25 Oct
// 2026: "we just click on every tab with the same zoom"). This loops over every step of every piece, so a new button is covered without a line here.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CLICK_FLOOR} from '../../media/camera.mjs';
import {clickZoom, CLICK_ZOOM} from '../../media/hold.mjs';
import {SNIPS, TAP_ZOOM, VIDEOS} from '../../media/scenes.mjs';

const pieces = {...VIDEOS, ...SNIPS};
const clicks = Object.entries(pieces).flatMap(([name, piece]) => (piece.steps || []).filter(step => step.click || step.tap).map(step => ({name, step})));

test('the default click zoom is the scene file\'s TAP_ZOOM and is deeper than the click floor', () => {
  assert.equal(CLICK_ZOOM, TAP_ZOOM);
  assert.ok(CLICK_ZOOM >= CLICK_FLOOR);
  assert.equal(clickZoom({click: 'x'}), CLICK_ZOOM, 'a step with no zoom gets the default');
  assert.equal(clickZoom({click: 'x', zoom: 2.5}), 2.5, 'its own zoom wins');
  assert.equal(clickZoom({click: 'x', zoom: false}), 0, 'false is no zoom');
});

test('every click and tap in every piece zooms, except the job drawer\'s tabs', () => {
  assert.ok(clicks.length > 10, 'the loop sees the pieces\' clicks');
  for (const {name, step} of clicks) {
    const selector = step.click || step.tap;
    if (clickZoom(step)) continue;
    assert.match(selector, /\.jd-tabs/, `${name}: the click on ${selector} says zoom: false; only the drawer's tabs may`);
  }
});
