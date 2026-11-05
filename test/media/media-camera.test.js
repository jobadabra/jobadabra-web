// The product videos' camera (media/camera.mjs): zooms frame each hold's box, clicks pull back so the cursor's trip shows,
// the view never leaves the page, every output frame maps to a recorded frame.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cameraAt, cameraKeys, clipTo, cursorAt, frameAt, MAX_ZOOM, PHONE_GAIN, PHONE_MAX, PHONE_SCALE, posterTime, renderPlan, beatTimes, LOOK_MARGIN, FIT_WARN, FIRST_LAG, fromFirstLook} from '../../media/camera.mjs';

const viewport = {w: 1800, h: 1125};
const box = {x: 250, y: 500, width: 1200, height: 540};
const log = {viewport, frames: [0, 0.5, 1, 2, 3, 4, 5].map((t, i) => ({t, file: `f${i}.jpg`})),
  events: [{t: 0.2, type: 'hold', box}, {t: 2.5, type: 'click', box: {x: 10, y: 100, width: 100, height: 30}}, {t: 3.2, type: 'press', box: {x: 10, y: 100, width: 100, height: 30}}]};

test('a hold zooms onto its box; a click zooms onto its target and the camera never pulls back to the whole screen between steps', () => {
  const keys = cameraKeys(log);
  assert.ok(keys.some(key => key.z > 1 && key.z <= MAX_ZOOM), 'zoomed, within the cap');
  assert.equal(cameraAt(keys, 0, viewport).w, viewport.w, 'the whole screen first, for context');
  assert.ok(cameraAt(keys, 2, viewport).w < viewport.w, 'zoomed during the hold');
  const click = {x: 10, y: 100, width: 100, height: 30};
  const view = cameraAt(keys, 3.2, viewport);
  assert.ok(view.w < viewport.w && view.x === 0 && click.x >= view.x && click.x + click.width <= view.x + view.w, 'zoomed on the click, in the left corner');
  for (let t = 0.8; t < 5; t += 0.1) assert.ok(cameraAt(keys, t, viewport).w < viewport.w, `no full screen at ${t.toFixed(1)} s`);
});

test('a click in a corner puts the camera in that corner; a later hold glides to its own box after the click was seen', () => {
  const events = [{t: 1, type: 'click', box: {x: 1700, y: 1050, width: 80, height: 40}}, {t: 1.7, type: 'press', box: {x: 1700, y: 1050, width: 80, height: 40}},
    {t: 2, type: 'hold', box: {x: 50, y: 100, width: 400, height: 300}, zoom: 2}];
  const keys = cameraKeys({viewport, events});
  const atClick = cameraAt(keys, 1.7, viewport);
  assert.ok(atClick.x + atClick.w === viewport.w && atClick.y + atClick.h === viewport.h, 'bottom-right corner');
  const later = cameraAt(keys, 4, viewport);
  assert.ok(later.x === 0 && later.y < 200, 'then the top-left box');
  assert.ok(cameraAt(keys, 1.8, viewport).x >= viewport.w / 2, 'still on the click just after the press');
});

test('a box wider than the zoomed view is framed from its left edge, with the margin', () => {
  const wide = {x: 200, y: 600, width: 1500, height: 60};
  const view = cameraAt(cameraKeys({viewport, events: [{t: 0, type: 'hold', box: wide, zoom: 1.5}]}), 3, viewport);
  assert.ok(Math.abs(view.x - (wide.x - LOOK_MARGIN)) < 1, `the view starts a margin left of the box's left edge (${view.x})`);
});

test('a sped-up clip stretches camera moves in recorded time, so on screen they last as long', () => {
  const slow = cameraKeys({viewport, events: [{t: 5, type: 'hold', box}]}).at(-1).t, fast = cameraKeys({viewport, events: [{t: 5, type: 'hold', box}], speed: 3}).at(-1).t;
  assert.ok(fast > slow);
});

test('the view stays inside the page at every moment, and a hold may carry its own zoom (the director\'s plan)', () => {
  const keys = cameraKeys({viewport, events: [{t: 0, type: 'hold', box: {x: 1700, y: 1000, width: 90, height: 90}}]});
  for (let t = 0; t < 3; t += 0.05) {
    const view = cameraAt(keys, t, viewport);
    assert.ok(view.x >= 0 && view.y >= 0 && view.x + view.w <= viewport.w + 1e-9 && view.y + view.h <= viewport.h + 1e-9, `t=${t.toFixed(2)}`);
  }
  const own = cameraKeys({viewport, events: [{t: 0, type: 'hold', box, zoom: 1.2}]});
  assert.equal(own.at(-1).z, 1.2);
  const none = cameraKeys({viewport, events: [{t: 1, type: 'hold', box, zoom: 1}]});
  assert.equal(none.at(-1).z, 1, 'zoom 1 keeps the whole screen');
});

test('the cursor glides to the click target and reaches it at the press; the ring starts at the press', () => {
  const before = cursorAt(log.events, 2.4, viewport), at = cursorAt(log.events, 3.2, viewport), after = cursorAt(log.events, 3.5, viewport);
  assert.equal(before.press, null);
  assert.ok(Math.abs(at.x - 60) < 1 && Math.abs(at.y - 115) < 1, `at the target (${at.x}, ${at.y})`);
  assert.ok(Math.abs(after.press - 0.3) < 1e-9);
});

test('every output frame names a recorded frame at or before its time, at the given rate', () => {
  assert.equal(frameAt(log.frames, 0.75), 1);
  assert.equal(frameAt(log.frames, 99), log.frames.length - 1);
  const plan = renderPlan(log, 10);
  assert.equal(plan.length, 51);
  assert.equal(plan[0].file, 'f0.jpg');
  assert.equal(plan[25].file, 'f3.jpg');
  assert.ok(plan.every(frame => frame.cursor === true));
  assert.equal(renderPlan({...log, events: [{t: 0, type: 'hold', box}]}, 10)[0].cursor, false, 'no clicks: no cursor');
});

test('a close-up\'s crop stays inside the window; one fully outside gives none', () => {
  assert.deepEqual(clipTo({x: -12, y: 900, width: 2000, height: 300}, {w: 1800, h: 1125}), {x: 0, y: 900, width: 1800, height: 225});
  assert.equal(clipTo({x: 1900, y: 0, width: 50, height: 50}, {w: 1800, h: 1125}), null);
});

test('the poster is the end of the hold marked poster (the filled form), else the first frame', () => {
  const events = [{type: 'hold', t: 1, s: 1.2}, {type: 'mark', t: 2.3}, {type: 'hold', t: 3, s: 5, poster: true}, {type: 'hold', t: 8, s: 3.2}];
  assert.equal(posterTime(events), 7.5);
  assert.equal(posterTime(events.map(({poster, ...event}) => event)), 0);
});

// The hero's camera (owner, 24 Oct 2026: "fewer, more deliberate zooms"): steady pieces never zoom on a click and open already framed;
// a page change cuts; the phone copy has its own, tighter camera.
test('a steady piece opens on its first look and never moves for a click; the next look is the one deliberate move', () => {
  const click = {x: 1600, y: 1000, width: 120, height: 40};
  const events = [{t: 0.2, type: 'hold', box, zoom: 1.5}, {t: 2, type: 'click', box: click}, {t: 2.7, type: 'press', box: click}, {t: 3, type: 'hold', box: {x: 900, y: 200, width: 500, height: 300}, zoom: 2.2}];
  const keys = cameraKeys({viewport, events, steady: true});
  assert.ok(cameraAt(keys, 0, viewport).w < viewport.w, 'framed from the first frame, no whole-screen opening');
  assert.deepEqual(cameraAt(keys, 2.9, viewport), cameraAt(keys, 1, viewport), 'the click moved nothing');
  assert.ok(Math.abs(cameraAt(keys, 5, viewport).w - viewport.w / 2.2) < 1e-6, 'then zoomed toward the result');
  assert.equal(keys.length, 2, 'one framing, one move');
});

test('a look marked cut switches at the page change, not with a glide', () => {
  const events = [{t: 0, type: 'hold', box, zoom: 2}, {t: 2, type: 'mark'}, {t: 3, type: 'hold', box: {x: 1300, y: 100, width: 300, height: 200}, zoom: 2, cut: true}];
  const keys = cameraKeys({viewport, events, steady: true});
  const before = cameraAt(keys, 1.99, viewport), after = cameraAt(keys, 2.001, viewport);
  assert.ok(before.x < 600 && after.x >= 899, `jumped at the mark (${before.x} -> ${after.x})`);
});

test('the phone copy: its own aspect, a tighter zoom (gain or its own), capped, inside the page', () => {
  const phone = {aspect: 4 / 3};
  const events = [{t: 0, type: 'hold', box: {x: 860, y: 360, width: 300, height: 130}, zoom: 2.2}, {t: 3, type: 'hold', box: {x: 260, y: 750, width: 400, height: 60}, zoom: 2, phoneZoom: 3.2}];
  const keys = cameraKeys({viewport, events, steady: true, phone});
  assert.equal(keys[0].z, Math.min(PHONE_MAX, 2.2 * PHONE_GAIN));
  assert.ok(Math.abs(keys.at(-1).z - 3.2 * PHONE_SCALE) < 1e-9, 'a step may set its own phone zoom, shown at PHONE_SCALE of it');
  for (let t = 0; t < 6; t += 0.1) {
    const view = cameraAt(keys, t, viewport, 1, phone);
    assert.ok(Math.abs(view.w / view.h - 4 / 3) < 1e-6, 'a 4:3 view');
    assert.ok(view.x >= 0 && view.y >= -1e-9 && view.x + view.w <= viewport.w + 1e-9 && view.y + view.h <= viewport.h + 1e-9, `inside the page at ${t.toFixed(1)}`);
  }
  const whole = cameraKeys({viewport, events: [{t: 0, type: 'hold', box, zoom: 1}], phone});
  assert.ok(cameraAt(whole, 1, viewport, 1, phone).h <= viewport.h + 1e-9, 'even "the whole screen" fits the page height at 4:3');
});

// Round 2 (owner, 24 Oct 2026: the steps were missing and nobody saw it before shipping): every look's beat gets a moment in the played clip, so the
// side-by-side and the beats sheet show each step, not only the result.
test('each look with a beat gets its moment in the played clip: near its hold\'s end, divided by the speed', () => {
  const steps = [{go: 'jobs'}, {hold: 2, look: '#a', beat: 'First'}, {click: '#x'}, {hold: 1}, {hold: 3, look: '#b', beat: 'Second'}];
  const events = [{t: 0.5, type: 'mark'}, {t: 1, type: 'hold', look: '#a', s: 2}, {t: 3.2, type: 'click'}, {t: 3.9, type: 'press'}, {t: 4, type: 'hold', s: 1}, {t: 5, type: 'hold', look: '#b', s: 3}];
  assert.deepEqual(beatTimes(events, steps, 2), [{t: 1.4, beat: 'First'}, {t: 3.85, beat: 'Second'}]);
  assert.deepEqual(beatTimes(events, [{hold: 2, look: '#a'}], 1), [], 'no beat, no moment');
  assert.deepEqual(beatTimes([{type: 'hold', t: 1, s: 2, look: '#a'}, {type: 'hold', t: 4, s: 2, look: null}], [{hold: 2, look: '#a'}, {review: {}}, {hold: 2, beat: 'Ready'}], 1),
    [{t: 5.8, beat: 'Ready'}], 'a hold without a look keeps its beat, paired in order');
});

// Round 2 (owner, 24 Oct 2026: "wrong cropping"): in the hero (steady) every look is shown WHOLE across: a card wider than its zoomed view used to lose
// its right side (Set up's note card lost its Build button). Loops over widths, so no zoom/width pair cuts a look.
test('a hero look is never cut left or right: its zoom is lowered to fit the box, and a much lower zoom is reported', () => {
  for (const width of [300, 700, 900, 1200, 1500, 1750]) {
    for (const zoom of [1.5, 2, 2.4]) {
      const look = {x: 1800 - width - 20 > 0 ? 20 : 0, y: 300, width, height: 120};
      const heard = [];
      const keys = cameraKeys({viewport, events: [{t: 0, type: 'hold', look: 'x', box: look, zoom}], steady: true, onFit: (event, asked, used) => heard.push(used / asked)});
      const view = cameraAt(keys, 1, viewport);
      assert.ok(view.x <= look.x + 0.5 && view.x + view.w >= look.x + look.width - 0.5, `width ${width} at zoom ${zoom}: the view ${view.x.toFixed(0)}+${view.w.toFixed(0)} holds the box`);
      if (look.width + 2 * LOOK_MARGIN > viewport.w / zoom) assert.equal(heard.length, 1, `width ${width} at zoom ${zoom}: the lowered zoom is reported`);
      else assert.deepEqual(heard, [], 'a box that fits keeps its zoom');
    }
  }
  assert.ok(FIT_WARN < 1);
});

// Round 8 (owner, 24 Oct 2026: "On mobile ... the content overflows a bit, the videos are not centered"): the phone copy zoomed PHONE_GAIN past
// each look and read a wide one from its left edge, so 18 of 24 phone shots lost 6-49% of their right side and showed the sidebar on the left.
// Now the phone copy, like the desktop one, shows every look whole and centred; a narrower phoneLook is how a phone shot gets tighter.
test('a phone look is never cut left or right either: centred, its zoom lowered to fit, the lowered zoom reported', () => {
  const phone = {aspect: 4 / 3};
  for (const width of [200, 450, 700, 900, 1200, 1400]) {   // up to the widest a 4:3 view of this page shows (1500 px, less the margins)
    for (const [zoom, phoneZoom] of [[1.5], [2], [2.4], [2, 3.2], [1.4, 4]]) {
      const look = {x: 1800 - width - 60 > 0 ? 60 : 0, y: 300, width, height: 120};
      for (const event of [{box: look, zoom, phoneZoom}, {box: {x: 0, y: 0, width: 1800, height: 900}, phoneBox: look, zoom, phoneZoom}]) {
        const heard = [];
        const keys = cameraKeys({viewport, events: [{t: 0, type: 'hold', look: 'x', ...event}], steady: true, phone, onFit: (e, asked, used) => heard.push(used / asked)});
        const view = cameraAt(keys, 1, viewport, 1, phone);
        const name = `width ${width} at zoom ${zoom}/${phoneZoom ?? 'gain'}${event.phoneBox ? ' (phoneLook)' : ''}`;
        assert.ok(view.x <= look.x + 0.5 && view.x + view.w >= look.x + look.width - 0.5, `${name}: the view ${view.x.toFixed(0)}+${view.w.toFixed(0)} holds the box`);
        const centre = look.x + look.width / 2, middle = view.x + view.w / 2;
        if (view.x > 0.5 && view.x + view.w < viewport.w - 0.5) assert.ok(Math.abs(middle - centre) < 1, `${name}: centred on the look (${middle.toFixed(0)} vs ${centre.toFixed(0)})`);
        const asked = Math.min(PHONE_MAX, phoneZoom != null ? phoneZoom * PHONE_SCALE : zoom * PHONE_GAIN);
        if (look.width + 2 * LOOK_MARGIN > viewport.w / asked) assert.equal(heard.length, 1, `${name}: the lowered zoom is reported`);
      }
    }
  }
});

// Round 2 (owner: Find "starts on the list already full"): the hero's clip begins at its first look, not at the app's launch.
test('a hero clip starts at its first look: earlier frames and events go, times move so the look starts at 0', () => {
  const raw = {viewport, frames: [0, 0.5, 1, 1.5, 2, 3].map((t, i) => ({t, file: `f${i}.jpg`})),
    events: [{t: 0.4, type: 'mark'}, {t: 1.2, type: 'hold', box, s: 2}, {t: 3.2, type: 'click', box}]};
  const log = fromFirstLook(raw);
  assert.deepEqual(log.frames.map(frame => frame.file), ['f3.jpg', 'f4.jpg', 'f5.jpg'], 'the frame on screen at the look (+ the repaint lag) is the first');
  assert.equal(log.frames[0].t, 0);
  assert.deepEqual(log.events.map(event => event.type), ['hold', 'click'], 'what happened before the look is gone');
  assert.equal(log.events[0].t, 0);
  assert.ok(Math.abs(log.events[1].t - (3.2 - 1.2 - FIRST_LAG)) < 1e-9);
  const none = {...raw, events: []};
  assert.equal(fromFirstLook(none), none, 'no look: unchanged');
});

test('a look may keep its left part on purpose (lookWidth), never wider than the box itself', async () => {
  const {holdEvent} = await import('../../media/hold.mjs');
  const wide = {x: 256, y: 100, width: 1512, height: 180};
  assert.equal(holdEvent({hold: 1, look: 'x', lookWidth: 760}, wide).box.width, 760);
  assert.equal(holdEvent({hold: 1, look: 'x', lookWidth: 2000}, wide).box.width, 1512);
  assert.deepEqual(holdEvent({hold: 1, look: 'x'}, wide).box, wide);
  assert.equal(holdEvent({hold: 1, look: 'x', phoneLookWidth: 560}, wide, wide).phoneBox.width, 560, 'the phone copy names its part too');
});

// Round 2: a hold's entry is stamped after its boxes are measured; its `s` is the time left on screen, so beat frames and posters fall inside the look.
test('a hold logs the seconds it has left after measuring, and the recorder waits exactly that', async () => {
  const {holdEvent, holdLeft} = await import('../../media/hold.mjs');
  assert.ok(Math.abs(holdLeft(2.2, 1000, 1700) - 1.5) < 1e-9);
  assert.equal(holdLeft(1, 1000, 3000), 0.5, 'a slow measure still leaves half the hold on screen');
  assert.equal(holdLeft(1.8, 1000, 2500), 0.9, 'run 28: Track\'s practise look kept 0.3 of 1.8 s on a loaded Mac');
  assert.equal(holdEvent({hold: 2.2, look: 'x'}, {x: 0, y: 0, width: 10, height: 10}, null, 1.5).s, 1.5);
});

// Owner, 24 Oct 2026: "a small glitch in the first clip (showing something about Sonnet)": 0.6 s of the CV step's framing over the next page.
test('a cut look starts when its content is on screen: no frame from between the page change and it, on either side of the cut', async () => {
  const {changeSpans, dropChanges, readyAtFrames} = await import('../../media/cuts.mjs');
  const looks = [{x: 100, y: 100, width: 600, height: 300}, {x: 900, y: 600, width: 600, height: 300}, {x: 100, y: 600, width: 600, height: 300}];
  const frames = Array.from({length: 120}, (_, i) => ({t: i / 10, file: `r${i}.jpg`}));   // a frame every 0.1 s, its name its recorded time
  // look 1; a page change (mark), the look on screen (ready), a second action (mark), look 2; a click (press) and look 3 with no 'ready' (falls back);
  // look 4 after no action: the page changed by itself (ready during look 3's hold)
  const events = [{t: 0, type: 'hold', box: looks[0], s: 1.5}, {t: 1.6, type: 'mark'}, {t: 1.9, type: 'ready'}, {t: 2.5, type: 'mark'}, {t: 3.4, type: 'hold', box: looks[1], cut: true, s: 2},
    {t: 5.5, type: 'click', box: looks[0]}, {t: 6.2, type: 'press', box: looks[0]}, {t: 7.0, type: 'hold', box: looks[2], cut: true, s: 2},
    {t: 8.4, type: 'ready'}, {t: 9.2, type: 'hold', box: looks[0], cut: true, s: 2}];
  const raw = {viewport, frames, events};
  const spans = changeSpans(readyAtFrames(raw));
  assert.deepEqual(spans.map(span => [span.from, Number(span.to.toFixed(3))]), [[1.6, 2.0], [6.2, 7.0 + FIRST_LAG]], 'from the FIRST change to the first frame after the look showed');
  const log = dropChanges(raw);
  const recordedAt = file => Number(file.slice(1, -4)) / 10;
  const keys = cameraKeys({...log, steady: true});
  const framing = box => cameraAt(cameraKeys({viewport, events: [{t: 0, type: 'hold', box}], steady: true}), 0, viewport).x;
  // which look's page a recorded moment shows: look 1 until the first change, look 2 from the frame after its ready (1.9 -> 2.0), look 3 from its
  // fallback, look 4 from the frame after its ready (8.4 -> 8.5): a frame recorded at the 'ready' moment itself still shows the old page
  const pageOf = at => (at <= 1.6 ? 0 : at >= 8.5 ? 3 : at >= 7.3 ? 2 : at >= 2.0 && at <= 6.2 ? 1 : -1);   // a frame at the change itself still shows the old page
  const plan = renderPlan(log, 30, 1, {steady: true});
  for (const [i, frame] of plan.entries()) {
    const t = i / 30, at = recordedAt(frame.file), page = pageOf(at);
    assert.notEqual(page, -1, `frame ${i} (${t.toFixed(2)} s) shows a recorded moment that was cut (${at} s)`);
    if (at === 0.0 && t > 0) continue;
    assert.ok(Math.abs(cameraAt(keys, t, viewport).x - framing(looks[page === 3 ? 0 : page])) < 1, `frame ${i} (${t.toFixed(2)} s): the camera frames look ${page + 1}, whose page it shows (recorded ${at} s)`);
  }
  assert.ok(log.frames.at(-1).t < raw.frames.at(-1).t - 0.9, 'the clip is shorter by what was cut');
  const click = log.events.findIndex(event => event.type === 'click');
  assert.equal(log.events[click + 1]?.type, 'press', 'a click keeps its press');
});

test('every hero step before a cut look watches for it (hold.mjs nextCut), and every cut look has a page change to cut at', async () => {
  const {nextCut} = await import('../../media/hold.mjs');
  const {VIDEOS: pieces} = await import('../../media/scenes.mjs');
  const changes = step => step.go || step.js || step.click || step.press || (step.tap && step.then);
  for (const [name, piece] of Object.entries(pieces).filter(([, piece]) => piece.camera === 'steady')) {
    piece.steps.forEach((step, i) => {
      if (!(step.hold && step.look && step.cut)) return;
      const prevLook = piece.steps.slice(0, i).findLastIndex(prev => prev.hold && prev.look);
      const between = piece.steps.slice(prevLook + 1, i);
      // no step between: the page changes by itself during the previous hold, which then watches for the look
      assert.ok(between.some(changes) || piece.steps[i - 1]?.hold, `${name}: cut look ${JSON.stringify(step.look)} has a step that changes the page before it`);
      if (!between.length) assert.deepEqual(nextCut(piece.steps, i - 1), {look: step.look}, `${name}: the hold before ${JSON.stringify(step.look)} watches for it`);
      between.forEach((_, j) => assert.deepEqual(nextCut(piece.steps, prevLook + 1 + j), {look: step.look}, `${name}: step ${prevLook + 1 + j} watches for ${JSON.stringify(step.look)}`));
    });
  }
});

test('the played clip is checked for a frame of another page on either side of each cut (cuts.mjs strayFrames)', async () => {
  const {strayFrames, THUMB} = await import('../../media/cuts.mjs');
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level);
  const look = {x: 100, y: 100, width: 600, height: 300};
  // look 1 (0-1.5 s), a change at 1.6, look 2 cut (from 1.6), played at 1x, 30 fps
  const log = {viewport, frames: [], events: [{t: 0, type: 'hold', box: look, s: 1.5, look: 'a'}, {t: 1.6, type: 'mark'}, {t: 1.6, type: 'hold', box: look, cut: true, s: 1.5, look: 'b'}]};
  const clip = Array.from({length: 96}, (_, j) => (j / 30 < 1.6 ? page(40) : page(90)));
  const thumb = j => clip[j];
  assert.deepEqual(strayFrames({log, thumb, frames: clip.length}), [], 'a clean cut passes');
  clip[47] = page(90);   // 1.567 s: the new page under the old framing (the "Sonnet" glitch)
  assert.equal(strayFrames({log, thumb, frames: clip.length})[0]?.side, 'before');
  clip[47] = page(40); clip[50] = page(40);   // 1.667 s: the old page under the new framing (the calendar, painted late)
  assert.equal(strayFrames({log, thumb, frames: clip.length})[0]?.side, 'after');
  clip[50] = page(91);   // a cursor or a progress bar: a small difference passes
  assert.deepEqual(strayFrames({log, thumb, frames: clip.length}), []);
  // a look that fills in by itself (the search card: 0 found, then 31): its first frames differ from its end, not from the frames just after the cut
  const filling = Array.from({length: 96}, (_, j) => (j / 30 < 1.6 ? page(40) : page(Math.min(90, 80 + Math.floor((j - 48) / 4)))));
  assert.deepEqual(strayFrames({log, thumb: j => filling[j], frames: filling.length}), [], 'a card filling in after its cut passes');
  filling.fill(page(40), 48, 64);   // ...but the old page lingering for half a second after the cut is still caught
  assert.equal(strayFrames({log, thumb: j => filling[j], frames: filling.length})[0]?.side, 'after');
});

test('each cut is checked against its frames: a page that changes by itself is cut at its first frame, a page painted late loses its old frames (cuts.mjs frameCuts)', async () => {
  const {frameCuts, cutTime, THUMB} = await import('../../media/cuts.mjs');
  const thumb = file => new Uint8Array(THUMB.w * THUMB.h).fill(file === 'old' ? 40 : 200);
  const framesFrom = paint => [0, 0.5, 1, 1.5, 1.9, 2.0, 2.05, 2.2, 2.6, 3].map(t => ({t, file: t >= paint ? 'new' : 'old'}));
  // no action between the looks: 'ready' came at 2.05, the new page painted at 1.9
  const self = {frames: framesFrom(1.9), events: [{type: 'hold', t: 0, s: 1, box: {}}, {type: 'ready', t: 2.05}, {type: 'hold', t: 2.1, s: 1, box: {}, cut: true}]};
  const fixed = frameCuts({log: self, thumb});
  assert.equal(cutTime(fixed, fixed.events.findIndex(e => e.cut)), 1.899, 'cut at the first frame of the new page');
  // a click before the cut look, the new page on screen from the cut: left alone
  const acted = {frames: framesFrom(1.9), events: [{type: 'hold', t: 0, s: 1, box: {}}, {type: 'press', t: 1.95}, {type: 'ready', t: 2.05}, {type: 'hold', t: 2.1, s: 1, box: {}, cut: true}]};
  assert.equal(frameCuts({log: acted, thumb}), acted);
  // the same click, the new page painted late (2.2): the old frames after the cut are cut out
  const late = frameCuts({log: {...acted, frames: framesFrom(2.2)}, thumb});
  assert.ok(late.frames.filter(f => f.t >= 1.95).every(f => f.file === 'new'), 'no old frame after the cut');
  assert.equal(late.frames.at(-1).t, 2.75, 'later frames move up by what was cut');
  // a quiet page (round 7, Track's Actions on a loaded Mac): no frame of the new page until its hold forces one, 2 s after the cut
  const quietFrames = [0, 0.5, 1, 1.5, 1.9, 2.0, 2.05].map(t => ({t, file: 'old'})).concat([4.0, 4.5].map(t => ({t, file: 'new'})));
  const quiet = frameCuts({log: {frames: quietFrames, events: [{type: 'hold', t: 0, s: 1, box: {}}, {type: 'press', t: 1.95}, {type: 'hold', t: 3.99, s: 1, box: {}, cut: true}]}, thumb});
  assert.ok(quiet.frames.filter(f => f.t >= 1.95).every(f => f.file === 'new'), 'the old page is cut up to the new one\'s first frame, however late');
  // a half-painted page at the cut (round 7, Track: closer to the new page than the old, still far from it) held 1.1 s by a quiet page: cut out
  // up to the settled page, by the same measure as the gate (strayFrames, STRAY_MAX)
  const shade = file => new Uint8Array(THUMB.w * THUMB.h).fill({old: 40, half: 150, new: 200}[file]);
  const halfFrames = [0, 0.5, 1, 1.5, 1.9].map(t => ({t, file: 'old'})).concat([{t: 1.96, file: 'half'}, {t: 4.0, file: 'new'}, {t: 4.5, file: 'new'}]);
  const half = frameCuts({log: {frames: halfFrames, events: [{type: 'hold', t: 0, s: 1, box: {}}, {type: 'press', t: 1.95}, {type: 'hold', t: 3.99, s: 1, box: {}, cut: true}]}, thumb: shade});
  assert.ok(half.frames.filter(f => f.t > 1.95).every(f => f.file === 'new'), `no half-painted frame after the cut: ${half.frames.map(f => `${f.t}:${f.file}`).join(' ')}`);
});

// Round 4 (owner, 24 Oct 2026: "we cropped too hard, let's leave a bit of space"): every look keeps LOOK_MARGIN on each side inside the view, unless the
// page itself ends there; the top of a tall look too.
test('a look keeps a margin on every side, the top of a tall look too', () => {
  assert.ok(LOOK_MARGIN >= 32, 'a margin that reads as space, not a crop');
  const looks = [{x: 600, y: 300, width: 400, height: 120}, {x: 200, y: 200, width: 1200, height: 160}, {x: 500, y: 150, width: 500, height: 900}];
  for (const box of looks) for (const zoom of [1.5, 2, 2.4]) {
    const view = cameraAt(cameraKeys({viewport, events: [{t: 0, type: 'hold', look: 'x', box, zoom}], steady: true}), 1, viewport);
    assert.ok(box.x - view.x >= LOOK_MARGIN - 0.5 && view.x + view.w - (box.x + box.width) >= LOOK_MARGIN - 0.5, `${JSON.stringify(box)} at ${zoom}: room left and right`);
    assert.ok(box.y - view.y >= LOOK_MARGIN - 0.5, `${JSON.stringify(box)} at ${zoom}: room above (${(box.y - view.y).toFixed(0)} px)`);
  }
});

// Round 4 (owner: "when clicking Apply, the screen changes too fast, let's wait half a second"): a press shown first changes nothing; the mark logged
// when its action runs is the page change the cut uses. Every press in a video waits (record-app.mjs pressShow).
test('a held press is not a page change: a cut look switches at the mark after it, PRESS_SHOW later', async () => {
  const {pageChange, PRESS_SHOW} = await import('../../media/hold.mjs');
  assert.equal(PRESS_SHOW, 0.5);
  assert.equal(pageChange({type: 'press', held: true}), false);
  assert.equal(pageChange({type: 'press'}), true);
  assert.equal(pageChange({type: 'mark'}), true);
  const events = [{t: 0, type: 'hold', look: 'a', box: {x: 100, y: 100, width: 300, height: 100}, zoom: 2},
    {t: 2, type: 'click', box: {x: 200, y: 150, width: 80, height: 30}}, {t: 2.7, type: 'press', held: true, box: {x: 200, y: 150, width: 80, height: 30}},
    {t: 3.45, type: 'mark'}, {t: 3.8, type: 'hold', look: 'b', box: {x: 900, y: 500, width: 300, height: 100}, zoom: 2, cut: true}];
  const keys = cameraKeys({viewport, events, steady: true, speed: 1.5});
  const before = cameraAt(keys, 3.4, viewport), after = cameraAt(keys, 3.46, viewport);
  assert.ok(before.x < 500, 'still on the first look while the press shows');
  assert.ok(after.x > 500, 'cut to the second look at the mark');
  const src = (await import('node:fs')).readFileSync(new URL('../../media/record-app.mjs', import.meta.url), 'utf8');
  for (const kind of ['item.tap', 'item.click']) assert.match(src, new RegExp(`selector: ${kind.replace('.', '\\.')}, box, \\.\\.\\.\\(`), `${kind}: its press is marked held when it waits`);
});

// Round 4: lookWidth keeps a look's left part, ending in a gap between columns; an edge that cuts through a line of words stops the recording.
test('lookWidth never cuts through a line of words (hold.mjs wordsCut), and the empty Find jobs card is framed on its centred words', async () => {
  const {wordsCut} = await import('../../media/hold.mjs');
  const card = {x: 100, y: 100, width: 1500, height: 400};   // kept part ends at 1140
  assert.equal(wordsCut(card, 1040, [{x: 120, y: 120, width: 900, height: 20}, {x: 1200, y: 120, width: 80, height: 20}]), 0, 'a column right of the gap: left out on purpose');
  assert.equal(wordsCut(card, 1040, [{x: 715, y: 200, width: 470, height: 20}]), 45, 'a centred line crossing the edge is cut');
  assert.equal(wordsCut(card, 1040, [{x: 700, y: 200, width: 440, height: 20}]), 0, 'a line ending at the edge');
  assert.equal(wordsCut(card, null, [{x: 715, y: 200, width: 470, height: 20}]), 0, 'no lookWidth: nothing to check');
  const {VIDEOS: pieces} = await import('../../media/scenes.mjs');
  const first = pieces.hero.steps.find(step => step.hold && step.look);
  assert.ok(!first.lookWidth, 'the empty card is full width with its words centred: no left part');
});

test('a look mostly off screen stops the recording; a few px of padding past the edge does not', async () => {
  const {offScreen, OFF_MAX} = await import('../../media/hold.mjs');
  const view = {w: 1800, h: 1125};
  assert.equal(offScreen({x: 552, y: -308, width: 760, height: 190}, view), 1, 'round 5: her job header wholly above the window');
  assert.ok(offScreen({x: 1700, y: 10, width: 200, height: 20}, view) > OFF_MAX, 'half past the right edge');
  assert.ok(offScreen({x: 400, y: 30, width: 900, height: 1112}, view) < OFF_MAX, 'the Chrome form: 17 px of bottom padding below the window');
  assert.equal(offScreen({x: 565, y: 359, width: 760, height: 78}, view), 0);
  assert.equal(offScreen(null, view), 0, 'no look, nothing to check');
});

test('both recorders check every look is on screen before framing it', async () => {
  const fs = await import('node:fs');
  for (const file of ['record-app.mjs', 'record-extension.mjs']) {
    const source = fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
    assert.match(source, /offScreen\(box, view\)/, `${file}: measures looks without the off-screen check`);
  }
});

test('a clip ending on a still page keeps its last hold whole, so the poster and beats fall inside the video (run 40156280319)', async () => {
  const {toLastHold, posterTime: poster} = await import('../../media/camera.mjs');
  const log = {frames: [{t: 0, file: 'a.jpg'}, {t: 38.9, file: 'b.jpg'}], events: [{type: 'hold', t: 37.9, s: 1.2, poster: true}]};
  const held = toLastHold(log);
  assert.deepEqual(held.frames.at(-1), {t: 39.1, file: 'b.jpg', held: true}, 'the last frame is held to the hold\'s end');
  const {stallsOf} = await import('../../media/check.mjs');
  const steady = {frames: Array.from({length: 11}, (_, i) => ({t: i * 0.1, file: `${i}.jpg`})), events: [{type: 'hold', t: 0.5, s: 3}]};
  assert.deepEqual(stallsOf(toLastHold(steady)), [], 'the held tail is not counted as a stalled capture');
  assert.ok(poster(held.events) <= held.frames.at(-1).t, 'the poster is inside the clip');
  const early = {...log, events: [{type: 'hold', t: 30, s: 1}]};
  assert.equal(toLastHold(early), early, 'a hold that ends before the last frame changes nothing');
});

// owner, 25 Oct 2026: "During wizard, or when clicking on Find jobs ... instead of default cursor, can we have a magic wand?"
test('the magic wand is the cursor from a step that says wand until the next one that does not', async () => {
  const {wandAt} = await import('../../media/camera.mjs');
  const events = [{t: 0, type: 'hold', wand: true}, {t: 1, type: 'click', wand: true}, {t: 1.7, type: 'press'}, {t: 3, type: 'hold', wand: true}, {t: 6, type: 'hold'}, {t: 7, type: 'click'}];
  assert.deepEqual([0.5, 1.8, 4, 6.5, 8].map(t => wandAt(events, t)), [true, true, true, false, false]);
  // owner, 25 Oct 2026 (later): "Remove the magic wand for now. I don't like it how it looks": the drawing stays in render.cjs, no scene asks for it
  const {VIDEOS} = await import('../../media/scenes.mjs');
  for (const [name, piece] of Object.entries(VIDEOS)) assert.ok(!piece.wand && !piece.steps.some(step => step.wand), `${name} draws the arrow`);
});
