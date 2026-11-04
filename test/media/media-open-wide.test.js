// Guards the hero's general camera rule (owner, 25 Oct 2026: "Let the user understand where is that zoomed part placed in the app. Basically how to
// get there. Like the context/surroundings"): every new screen opens on the whole window, then glides in; and no frame edge cuts words at its top or
// bottom (run 25: Set up's Back and Continue), nor a click zoom at its sides.
import assert from 'node:assert/strict';
import test from 'node:test';

const viewport = {w: 1800, h: 1125};
const text = (x, y, w, label) => ({k: 'text', x, y, w, h: 16, text: label});

test('every hero clip\'s first look and cut looks open wide, holding longer by the wide time and the glide (hold.mjs openWide)', async () => {
  const {VIDEOS, partsOf} = await import('../../media/scenes.mjs');
  const {openWide, opensWide, OPEN_WIDE, GLIDE_IN} = await import('../../media/hold.mjs');
  let checked = 0;
  for (const name of ['hero-onboarding', 'hero', 'hero-fill', 'hero-track']) for (const part of partsOf(name)) {
    const piece = VIDEOS[part];
    if (piece.camera !== 'steady') continue;
    const opened = openWide(piece);
    piece.steps.forEach((step, i) => {
      if (!step.hold) return;
      const wide = Boolean(step.look && step.zoom !== 1 && (step.cut || !piece.steps.slice(0, i).some(prev => prev.hold)));
      assert.equal(opensWide(piece.steps, i), wide, `${part} step ${i}`);
      assert.equal(Boolean(opened.steps[i].opensWide), wide, `${part} step ${i}`);
      assert.equal(opened.steps[i].hold, wide ? Number((step.hold + (OPEN_WIDE + GLIDE_IN) * (piece.speed || 1)).toFixed(3)) : step.hold, `${part} step ${i}`);
      if (wide) checked++;
    });
  }
  assert.ok(checked >= 12, `${checked} looks open wide`);
  assert.deepEqual(openWide({camera: 'follow', steps: [{hold: 1, look: '#a'}]}).steps[0], {hold: 1, look: '#a'}, 'a piece that is not steady is left alone');
});

test('a screen that opens wide shows the whole window from its cut, then glides slowly onto its look (camera.mjs)', async () => {
  const {cameraKeys, cameraAt, ZOOM_IN} = await import('../../media/camera.mjs');
  const {OPEN_WIDE, GLIDE_IN} = await import('../../media/hold.mjs');
  const box = {x: 1200, y: 600, width: 400, height: 200}, speed = 1.5;
  const events = [{t: 0, type: 'hold', box: {x: 100, y: 100, width: 600, height: 300}, s: 1, opensWide: true}, {t: 3, type: 'mark'},
    {t: 3.2, type: 'hold', box, s: 4, cut: true, opensWide: true}];
  const keys = cameraKeys({viewport, events, speed, steady: true});
  const whole = view => view.x === 0 && view.y === 0 && view.w === viewport.w && view.h === viewport.h;
  assert.ok(whole(cameraAt(keys, 0, viewport, speed)), 'the first screen opens on the whole window');
  assert.ok(!whole(cameraAt(keys, (OPEN_WIDE + GLIDE_IN) * speed + 0.01, viewport, speed)), '... and is on its look once the glide ends');
  assert.ok(whole(cameraAt(keys, 3.0001, viewport, speed)), 'a cut opens on the whole window');
  assert.ok(whole(cameraAt(keys, 3.2 + OPEN_WIDE * speed - 0.01, viewport, speed)), '... for OPEN_WIDE after the screen is there');
  const mid = cameraAt(keys, 3.2 + (OPEN_WIDE + GLIDE_IN / 2) * speed, viewport, speed), end = cameraAt(keys, 3.2 + (OPEN_WIDE + GLIDE_IN) * speed, viewport, speed);
  assert.ok(mid.w < viewport.w && mid.w > end.w, `half way in: ${mid.w} between ${viewport.w} and ${end.w}`);
  assert.ok(end.x <= box.x && end.x + end.w >= box.x + box.width, 'it ends on the look');
  assert.ok(GLIDE_IN > ZOOM_IN, 'the glide in is slower than a plain move');
  // a look with no opensWide (not steady, or zoom 1) cuts straight onto its frame, as before
  const plain = cameraKeys({viewport, events: events.map(({opensWide, ...event}) => event), speed, steady: true});
  assert.ok(!whole(cameraAt(plain, 3.0001, viewport, speed)));
});

test('no frame edge runs through words at its top or bottom; a card may run on below (whole.mjs edgeItemsY, edges.mjs cutsIn)', async () => {
  const {edgeItemsY, wholeFrame} = await import('../../media/whole.mjs');
  const {cutsIn} = await import('../../media/edges.mjs');
  const buttons = [text(635, 811, 40, 'Back'), text(1332, 811, 70, 'Continue')], card = {k: 'card', x: 620, y: 290, w: 784, h: 900, text: '.form'};
  assert.deepEqual(edgeItemsY(825, 'bottom', [...buttons, card], 538, 1486, 1125, 1125).map(item => item.text), ['Back', 'Continue'], 'run 25: Set up\'s buttons');
  assert.deepEqual(edgeItemsY(840, 'bottom', [...buttons, card], 538, 1486, 1125, 1125), [], 'below the buttons: the card running on is fine');
  assert.deepEqual(edgeItemsY(1125, 'bottom', buttons, 0, 1800, 1125, 1125), [], 'the page\'s own bottom cuts nothing');
  assert.deepEqual(cutsIn({x: 538, y: 233, w: 948, h: 592}, buttons, 1800, 1800, 1125, 1125).map(cut => `${cut.side}:${cut.text}`), ['bottom:Back', 'bottom:Continue']);
  assert.deepEqual(cutsIn({x: 538, y: 233, w: 948, h: 592}, buttons, 1800, 1800), [], 'without the page height: left and right only, as before');
  // the camera moves or zooms out so the bottom edge clears the buttons
  const look = {x: 580, y: 250, width: 864, height: 552}, aspect = 1.6;
  const frameAt = z => { const w = viewport.w / z, h = w / aspect; return {cx: look.x + look.width / 2, cy: look.y + Math.min(look.height, h) / 2, z}; };
  const got = wholeFrame({frameAt, z: 1.9, least: 1, look, edges: buttons, viewport, aspect}), w = viewport.w / got.z, h = w / aspect;
  const top = Math.min(Math.max(got.cy - h / 2, 0), viewport.h - h);
  assert.deepEqual(edgeItemsY(top + h, 'bottom', buttons, got.cx - w / 2, got.cx + w / 2, 1125, 1125), [], `bottom at ${top + h}`);
});

test('a steady click zoom is framed whole by the page\'s last edges (camera.mjs)', async () => {
  const {cameraKeys, cameraAt} = await import('../../media/camera.mjs');
  const {cutsIn} = await import('../../media/edges.mjs');
  const line = text(980, 500, 700, 'Job preferences: what a job must have, and what ranks it higher');
  const events = [{t: 0, type: 'hold', box: {x: 100, y: 100, width: 1600, height: 900}, s: 1, edges: [line]},
    {t: 2, type: 'click', box: {x: 1600, y: 980, width: 160, height: 40}, zoom: 2.4}, {t: 2.7, type: 'press', box: {x: 1600, y: 980, width: 160, height: 40}}];
  const keys = cameraKeys({viewport, events, speed: 1.5, steady: true});
  const view = cameraAt(keys, 2.8, viewport, 1.5);
  assert.deepEqual(cutsIn(view, [line], 1800, 1800), [], `the zoom onto the button cuts no line: ${JSON.stringify(view)}`);
});

test('the edge check reads a hold only once its camera has arrived: the wide opening and the glide are not cuts (edges.mjs edgeCuts)', async () => {
  const {cameraKeys} = await import('../../media/camera.mjs');
  const {edgeCuts} = await import('../../media/edges.mjs');
  const edges = [text(150, 300, 1500, 'A line as wide as the window')];
  const log = {viewport, frames: [{t: 0, file: 'a'}], events: [{t: 0, type: 'hold', box: {x: 100, y: 100, width: 300, height: 100}, s: 0.4},
    {t: 1, type: 'mark'}, {t: 1.1, type: 'hold', look: '#a', box: {x: 1300, y: 900, width: 300, height: 100}, s: 4, cut: true, opensWide: true, edges}]};
  const keys = cameraKeys({...log, speed: 1.5, steady: true});
  const hits = edgeCuts(log, 1.5, {steady: true, keys});
  assert.equal(hits.length, 0, `the look itself is whole once arrived: ${JSON.stringify(hits)}`);
});

test('a look that opened wide always rests REST after its glide, even when its hold is short (run 26: the phone take\'s scroll used the time)', async () => {
  const {cameraKeys, REST} = await import('../../media/camera.mjs');
  const speed = 1.5;
  for (const s of [0.5, 1, 1.5, 2.5, 4]) {
    const events = [{t: 0, type: 'hold', box: {x: 100, y: 100, width: 600, height: 300}, s: 1}, {t: 3, type: 'mark'},
      {t: 3.4, type: 'hold', box: {x: 1200, y: 600, width: 400, height: 200}, s, cut: true, opensWide: true}];
    const keys = cameraKeys({viewport, events, speed, steady: true}), arrived = keys.at(-1).t;
    assert.ok(arrived <= 3.4 + s - REST * speed + 1e-6 || arrived - 3.4 <= 0.05 + 1e-6, `hold ${s}: arrives at ${arrived}, the hold ends at ${3.4 + s}`);
    assert.ok(keys.at(-1).glide > 0);
  }
});

test('the edge check stops reading a hold where the next screen cuts in, even inside it (run 26: Set up\'s proposal painted mid-hold)', async () => {
  const {cameraKeys} = await import('../../media/camera.mjs');
  const {edgeCuts} = await import('../../media/edges.mjs');
  const side = {k: 'card', x: 12, y: 238, w: 199, h: 46, text: '.current'};
  const log = {viewport, frames: [{t: 0, file: 'a'}], events: [{t: 0, type: 'hold', box: {x: 0, y: 0, width: 1800, height: 1125}, s: 0.5},
    {t: 1, type: 'mark'}, {t: 1.1, type: 'hold', look: '#loading', box: {x: 0, y: 0, width: 1800, height: 1125}, s: 6, cut: true, opensWide: true, edges: [side]},
    {t: 4, type: 'ready'}, {t: 7.2, type: 'hold', look: '#next', box: {x: 900, y: 300, width: 500, height: 300}, s: 3, cut: true, opensWide: true}]};
  const keys = cameraKeys({...log, speed: 1.5, steady: true});
  assert.deepEqual(edgeCuts(log, 1.5, {steady: true, keys}), [], 'the glide into the next look is not this look\'s cut');
});

test('both recorders wait for a hold\'s look to become visible before stopping on "nothing to look at" (runs 26-27, a loaded Mac)', async () => {
  const fs = await import('node:fs');
  const {SHOW_WAIT} = await import('../../media/hold.mjs');
  assert.ok(SHOW_WAIT >= 5000);
  for (const file of ['record-app.mjs', 'record-extension.mjs']) {
    const source = fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
    const wait = source.indexOf("waitFor({state: 'visible', timeout: SHOW_WAIT})"), stop = source.indexOf('nothing to look at at ${item.look}');
    assert.ok(wait > 0 && wait < stop, `${file}: the wait comes before the stop`);
  }
});
