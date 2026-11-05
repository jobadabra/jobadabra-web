// Picture in picture, swapped when the lead changes (owner, 24 Oct 2026: "I'd like picture in picture, but swapping them at some point": Apply's
// Applying card main, then Chrome main while it fills with the card in the inset, then the card main again). The pair is synced on one moment, each
// change of lead swaps them, and the caption is the main picture's. Loops over the scenes, so a new picture in picture is held to it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {VIDEOS} from '../../media/scenes.mjs';
import {fillSeconds, insetRect, PIP, pipPlan} from '../../media/pip.mjs';
import {untilEnd} from '../../media/camera.mjs';

test('every picture in picture names a recording that syncs with it, and both lead at some point', () => {
  const pips = Object.entries(VIDEOS).filter(([, piece]) => piece.pip);
  assert.ok(pips.length >= 1, 'Apply plays picture in picture');
  for (const [name, piece] of pips) {
    const other = VIDEOS[piece.pip];
    assert.ok(other?.part, `${name}: ${piece.pip} is a part (recorded for it, not a clip of its own)`);
    for (const [who, steps] of [[name, piece.steps], [piece.pip, other.steps]]) {
      assert.equal(steps.filter(step => step.sync).length, 1, `${who}: one sync step (where the two recordings meet)`);
      assert.ok(steps.some(step => step.lead), `${who}: leads at some point (a swap)`);
    }
    assert.ok(!piece.after || piece.after !== piece.pip, `${name}: ${piece.pip} plays inside it, not after it`);
    const review = other.steps.find(step => step.review);
    if (review) assert.ok(review.sync, `${piece.pip}: its live card starts at the sync, so it follows the fill`);
  }
});

const viewport = {w: 1800, h: 1125}, box = {x: 200, y: 200, width: 700, height: 300};
const frames = prefix => Array.from({length: 61}, (_, i) => ({t: Number((i / 10).toFixed(1)), file: `${prefix}${i}.jpg`}));
const a = {name: 'card', dir: '/a', scale: 1.6, log: {viewport, frames: frames('a'), events: [
  {t: 0, type: 'hold', box, s: 3, lead: true, say: 'The card waits', tag: 'Applying'}, {t: 3.2, type: 'sync'}, {t: 5, type: 'hold', box, s: 1, lead: true, say: 'Ready to submit'}]}};
const b = {name: 'chrome', dir: '/b', scale: 2, log: {viewport, frames: frames('b'), events: [
  {t: 0, type: 'hold', box, s: 3, say: 'The extension fills it', tag: 'Chrome'}, {t: 3, type: 'sync'}, {t: 3, type: 'lead'}, {t: 4.5, type: 'hold', box, s: 1.5}]}};
const W = 1600, H = 1000, plan = pipPlan({a, b, width: W, height: H, fps: 30});
const at = t => plan.frames[Math.round((t - plan.from) * 30)];   // the frame at composite time t (b's clock)

test('three stages: the card main, Chrome main while it fills, the card main again; the inset in the top right', () => {
  const inset = insetRect(W, H, PIP.inset), steady = [[1, '/a'], [4.4, '/b'], [5.95, '/a']];
  for (const [t, main] of steady) {
    const frame = at(t);
    assert.equal(frame.layers.length, 2, `${t} s: two pictures`);
    assert.equal(frame.layers[0].dir, main, `${t} s: ${main} is the main picture`);
    assert.deepEqual(frame.layers[0].rect, {x: 0, y: 0, w: W, h: H});
    assert.deepEqual(frame.layers[1].rect, inset, `${t} s: the other one in the inset`);
    assert.ok(frame.layers[1].framed, 'the inset is framed');
  }
  assert.ok(inset.x + inset.w < W && inset.y > 0 && Math.abs(inset.w / inset.h - W / H) < 0.01, 'the inset keeps the shape, inside the frame');
});

test('a swap grows the new main out of the inset, then settles the old one into the corner', () => {
  const inset = insetRect(W, H, PIP.inset), widths = [3.05, 3.2, 3.4].map(t => at(t).layers.find((layer, k) => k > 0 && layer.dir === '/b').rect.w);
  assert.ok(widths[0] >= inset.w - 1 && widths[0] < widths[1] && widths[1] < widths[2], `Chrome grows: ${widths.map(Math.round)}`);
  assert.equal(at(3.05).layers[0].dir, '/a', 'the old main stays full behind while it grows');
  const settling = at(3.5).layers.at(-1);
  assert.equal(settling.dir, '/a'); assert.ok(settling.alpha > 0 && settling.alpha < 1, 'the card fades into the corner');
});

test('both recordings meet at their sync: the card\'s frame at Chrome\'s fill start is its own sync moment', () => {
  const frame = at(3), card = frame.layers.find(layer => layer.dir === '/a');
  assert.equal(card.file, 'a32.jpg', 'the card (sync at 3.2) shows its 3.2 s frame when Chrome (sync at 3.0) starts filling');
});

test('the caption is the main picture\'s, never popping in mid-way after a swap', () => {
  assert.equal(at(1).say, 'The card waits');
  assert.equal(at(3.5).say, 'The extension fills it');
  assert.ok(at(3.5).sayAge <= 0.51, 'its age counts from the swap');
  assert.equal(at(5.95).say, 'Ready to submit');
});

// The first take ticked all 10 fields in 0.1 s: the fill was timed to the panel's first paint, not to its done state.
test('the card is paced on the whole fill: its sync to the panel\'s done state, not the panel\'s first paint', () => {
  const events = [{t: 0, type: 'hold'}, {t: 3, type: 'sync'}, {t: 3, type: 'lead'}, {t: 3.1, type: 'mark'}, {t: 3.9, type: 'hold'}, {t: 7.4, type: 'filled'}];
  assert.equal(fillSeconds({events}), 4.4);
  assert.equal(fillSeconds({events: events.slice(0, 5)}), 0.1, 'without a done state: the next mark (the old, too short measure)');
  assert.equal(fillSeconds({events: [{t: 0, type: 'hold'}]}), null);
});

// Round 6: side by side, the card said "of 10" while the extension's panel said "of 6": the two pictures must count the same fields.
test('the live card ticks exactly the stand-in form\'s required fields, the ones the extension\'s panel counts', () => {
  const form = fs.readFileSync(new URL('../../media/form.html', import.meta.url), 'utf8');
  const required = [...form.matchAll(/<div class="field">([\s\S]*?)<\/div>/g)].map(match => match[1]).filter(field => /\brequired\b/.test(field))
    .map(field => field.replace(/<select[\s\S]*$/, '').replace(/<[^>]+>/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim());
  const review = Object.values(VIDEOS).flatMap(piece => piece.steps || []).find(step => step.review);
  assert.equal(required.length, 6, `the stand-in form's required fields: ${required.join(' | ')}`);
  assert.deepEqual(review.review.fields, required);
  const states = JSON.parse(fs.readFileSync(new URL('../../media/personas/nurse-lyon/review.json', import.meta.url), 'utf8'));
  assert.equal(states.find(state => state.id === review.review.id).total, required.length, 'the persona\'s open form counts them too');
});

// Take 4: the app part ended on the Applying card and the picture in picture opened on the same card, framed a few pixels apart: the fade between
// them made a ghost. Two joined parts never show the same place on both sides of the join; a part may end on its press instead (`end`).
test('a join never shows the same place on both sides; a part that ends on a press ends there', () => {
  const holds = steps => (steps || []).filter(step => step.hold && step.look);
  for (const [name, piece] of Object.entries(VIDEOS)) {
    for (const [first, then] of [[piece.before, name], [name, piece.after]].filter(([x, y]) => x && y)) {
      const shown = VIDEOS[then].pip ? VIDEOS[VIDEOS[then].pip] : VIDEOS[then];   // in picture in picture the partner's first lead opens it
      const ends = VIDEOS[first].steps.at(-1).end ? VIDEOS[first].steps.findLast(step => step.hold && step.look) : holds(VIDEOS[first].steps).at(-1);
      const opens = shown.steps.find(step => step.hold && step.look && (!VIDEOS[then].pip || step.lead));
      assert.notEqual(ends.tag, opens.tag, `${first} → ${then}: both sides show ${ends.tag} (a ghost in the join)`);
    }
    (piece.steps || []).forEach((step, k, all) => step.end && assert.equal(k, all.length - 1, `${name}: a step that ends the part is its last`));
  }
});

test('a part ending on a press drops every frame and event after it', () => {
  const log = {frames: [0, 0.5, 1, 1.5, 2].map(t => ({t, file: `f${t}.jpg`})), events: [{t: 0, type: 'hold'}, {t: 0.9, type: 'click'}, {t: 1.2, type: 'end'}, {t: 1.4, type: 'mark'}]};
  const out = untilEnd(log);
  assert.deepEqual(out.frames.map(frame => frame.t), [0, 0.5, 1, 1.2], 'the last frame held up to the end mark');
  const quiet = untilEnd({frames: [{t: 0, file: 'a.jpg'}, {t: 1.3, file: 'b.jpg'}], events: [{t: 0, type: 'hold'}, {t: 2.4, type: 'end'}]});
  assert.deepEqual(quiet.frames.map(frame => [frame.t, frame.file]), [[0, 'a.jpg'], [1.3, 'b.jpg'], [2.4, 'b.jpg']], 'a quiet page: the press is still played');
  assert.deepEqual(out.events.map(event => event.type), ['hold', 'click']);
  assert.equal(untilEnd({frames: log.frames, events: []}).frames.length, 5, 'no end: unchanged');
});
