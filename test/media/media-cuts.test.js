// Guards the cuts around a phone take's scroll and the stray-frame check's references (run 24: 3 of 4 phone copies stopped on stray frames).
import assert from 'node:assert/strict';
import test from 'node:test';

test('a cut look the phone take scrolled into view: cut where the page changed, the scroll never plays (cuts.mjs scrolledCut)', async () => {
  const {frameCuts, cutTime, THUMB} = await import('../../media/cuts.mjs');
  const prevBox = {x: 0, y: 100, width: 700, height: 200}, newBox = {x: 0, y: 200, width: 700, height: 200};
  // the old look's box sees the new page as soon as it paints; the new look's box (measured after the scroll) sees it only once scrolled
  const levels = {old: [40, 40], unscrolled: [200, 40], scrolling: [150, 110], scrolled: [120, 200]};
  const thumb = (file, box) => new Uint8Array(THUMB.w * THUMB.h).fill(levels[file][box === prevBox ? 0 : 1]);
  const frames = [[0, 'old'], [0.5, 'old'], [1, 'old'], [1.5, 'old'], [1.9, 'unscrolled'], [2.0, 'unscrolled'], [2.1, 'scrolling'], [2.4, 'scrolling'],
    [2.7, 'scrolled'], [2.9, 'scrolled'], [3.5, 'scrolled']].map(([t, file]) => ({t, file}));
  // Set up's strategy look (run 24): painted at 1.9, 'ready' noticed late (2.6), scrolled 2.05-2.8, the hold logged after the scroll
  const log = {frames, events: [{type: 'hold', t: 0, s: 1, box: prevBox}, {type: 'scroll', t: 2.05}, {type: 'ready', t: 2.6}, {type: 'scrolled', t: 2.8},
    {type: 'hold', t: 2.85, s: 1, box: newBox, cut: true}]};
  const fixed = frameCuts({log, thumb});
  const cut = cutTime(fixed, fixed.events.findIndex(event => event.cut));
  assert.equal(cut, 1.899, 'cut at the first frame of the new page, found in the old look\'s box');
  assert.deepEqual(fixed.frames.filter(frame => frame.t >= cut).map(frame => frame.file).filter((file, i, all) => all.indexOf(file) === i), ['scrolled'],
    `after the cut only the scrolled page: ${fixed.frames.map(frame => `${frame.t}:${frame.file}`).join(' ')}`);
  assert.ok(fixed.frames.filter(frame => frame.t < cut).every(frame => frame.file === 'old'), 'before the cut only the old page');
  // painted mid-way through the old hold (run 25: Set up's proposal at 0.5 s of a 1-s hold, its 90% beat already the new page)
  const mid = [[0, 'old'], [0.2, 'old'], [0.5, 'unscrolled'], [1, 'unscrolled'], [1.5, 'unscrolled'], [2.1, 'scrolling'], [2.7, 'scrolled'], [3.5, 'scrolled']].map(([t, file]) => ({t, file}));
  const early = frameCuts({log: {frames: mid, events: log.events}, thumb});
  const at0 = cutTime(early, early.events.findIndex(event => event.cut));
  assert.equal(at0, 0.499, 'cut where it painted, inside the old hold');
  assert.ok(early.frames.filter(frame => frame.t >= at0).every(frame => frame.file === 'scrolled'), `${early.frames.map(frame => `${frame.t}:${frame.file}`).join(' ')}`);
  // a click caused the change: the cut stays at the click, the scroll is still cut out
  const clicked = frameCuts({log: {frames, events: [{type: 'hold', t: 0, s: 1, box: prevBox}, {type: 'press', t: 1.88}, ...log.events.slice(1)]}, thumb});
  const at = cutTime(clicked, clicked.events.findIndex(event => event.cut));
  assert.equal(at, 1.88);
  assert.ok(clicked.frames.filter(frame => frame.t > at).every(frame => frame.file === 'scrolled'));
  // the same take without the scroll logged (the recorders before run 24): the new look's box misses the change, the unscrolled page plays
  const blind = frameCuts({log: {frames, events: log.events.filter(event => !/^scroll/.test(event.type))}, thumb});
  const late = cutTime(blind, blind.events.findIndex(event => event.cut));
  assert.ok(blind.frames.some(frame => frame.t < late && frame.file === 'unscrolled'), 'the bug the scroll events fix');
});

test('both recorders log the phone take\'s scroll as its start and end (hold.mjs scrollLookIn)', async () => {
  const fs = await import('node:fs');
  const {scrollLookIn} = await import('../../media/hold.mjs');
  const {stepLog} = await import('../../media/screencast.mjs');
  let now = 1;
  const pageWith = scrolls => ({waitForTimeout: async ms => { now += ms / 1000; }, locator: () => ({first: () => ({evaluate: async () => scrolls})})});
  const log = stepLog(() => now);
  assert.equal(await scrollLookIn(pageWith(true), '#look', {y: 600, height: 100}, {w: 704, h: 528}, log), true);
  assert.deepEqual(log.events.map(event => `${event.type}@${event.t}`), ['scroll@1', 'scrolled@1.6']);
  const none = stepLog(() => now);
  assert.equal(await scrollLookIn(pageWith(false), '#look', {y: 600, height: 100}, {w: 704, h: 528}, none), false);
  assert.deepEqual(none.events, [], 'no scroll, no events');
  for (const file of ['record-app.mjs', 'record-extension.mjs']) {
    const source = fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
    assert.match(source, /await scrollLookIn\(page, item\.look, box, view, log\)/, `${file} passes its log`);
  }
});

test('before a cut, a page that changes a little late in the old hold is not another page; the new page there still is (cuts.mjs strayFrames)', async () => {
  const {strayFrames, THUMB} = await import('../../media/cuts.mjs');
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level);
  const box = {x: 100, y: 100, width: 600, height: 300};
  // look 1 (0-1.5 s), a page change at 1.6, look 2 cut from 1.6; the status line hides at 1.4 (beat at 1.35): Track's "Last refresh" (run 24)
  const log = {frames: [], events: [{t: 0, type: 'hold', box, s: 1.5, look: 'a'}, {t: 1.6, type: 'mark'}, {t: 1.6, type: 'hold', box, cut: true, s: 1.5, look: 'b'}]};
  const clip = Array.from({length: 96}, (_, j) => page(j / 30 < 1.4 ? 40 : j / 30 < 1.6 ? 46 : 120));
  assert.deepEqual(strayFrames({log, thumb: j => clip[j], frames: clip.length}), [], 'the old page, a line shorter, passes');
  clip.fill(page(120), 44, 48);   // the new page in the hold's last frames and before the cut: caught
  assert.equal(strayFrames({log, thumb: j => clip[j], frames: clip.length})[0]?.side, 'before');
});

test('after a cut, a look that fills in by itself counts as the new page when it is closer to it than to the old one (cuts.mjs strayFrames)', async () => {
  const {strayFrames, THUMB} = await import('../../media/cuts.mjs');
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level);
  const box = {x: 100, y: 100, width: 600, height: 300};
  const log = {frames: [], events: [{t: 0, type: 'hold', box, s: 1.5, look: 'a'}, {t: 1.6, type: 'mark'}, {t: 1.6, type: 'hold', box, cut: true, s: 3, look: 'b'}]};
  // Find's phone copy (run 24): one card before and after the cut (40), the search starting (57-58), its end with jobs found (70): 1.5x closer only
  const clip = Array.from({length: 150}, (_, j) => page(j < 48 ? 40 : j < 56 ? 57 : j < 120 ? 58 : 70));
  assert.deepEqual(strayFrames({log, thumb: j => clip[j], frames: clip.length}), [], 'the search card filling in passes');
  clip.fill(page(41), 48, 64);   // the old page lingering after the cut: still caught
  assert.equal(strayFrames({log, thumb: j => clip[j], frames: clip.length})[0]?.side, 'after');
});

test('after a cut that opens wide, the whole new page is the reference until the glide starts; an old page lingering is still caught (run 27)', async () => {
  const {strayFrames, THUMB} = await import('../../media/cuts.mjs');
  const {cameraKeys, wideOpening} = await import('../../media/camera.mjs');
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level);
  const box = {x: 100, y: 100, width: 600, height: 300}, speed = 1.5;
  const log = {viewport: {w: 1800, h: 1125}, frames: [], events: [{t: 0, type: 'hold', box, s: 1.5, look: 'a'}, {t: 1.6, type: 'mark'},
    {t: 1.6, type: 'hold', box, cut: true, s: 4, look: 'b', opensWide: true}]};
  const wide = wideOpening(log.events, 2, speed);
  const keys = cameraKeys({...log, speed, steady: true});
  assert.ok(keys.some(key => Math.abs(key.t - (wide.from + wide.open)) < 1e-6), `the camera leaves the whole window at ${wide.from + wide.open}`);
  // the played copy (20 frames per recorded second): the old look zoomed (40), the new page whole (90), the glide (90 -> 150), the look (150)
  const at = t => Math.round(t / speed * 30), glideFrom = at(wide.from + wide.open), glideTo = at(wide.from + wide.open + wide.glide);
  const clip = Array.from({length: 120}, (_, j) => page(j < 32 ? 40 : j < glideFrom ? 90 : j < glideTo ? 90 + 60 * (j - glideFrom) / (glideTo - glideFrom) : 150));
  assert.deepEqual(strayFrames({log, thumb: j => clip[j], frames: clip.length, speed}), [], 'Set up and Find (run 27): the wide opening is the new page');
  clip.fill(page(40), 32, 38);   // the old look lingering after the cut: caught
  assert.equal(strayFrames({log, thumb: j => clip[j], frames: clip.length, speed})[0]?.side, 'after');
});

test('before a cut, the old page seen through a close zoom on the press is not another page; the new page there still is (cuts.mjs strayFrames)', async () => {
  const {strayFrames, THUMB} = await import('../../media/cuts.mjs');
  const size = THUMB.w * THUMB.h, page = level => new Uint8Array(size).fill(level);
  const box = {x: 100, y: 100, width: 600, height: 300};
  // Set up's Use Free AI (owner, 25 Oct 2026): look a to 1.0 s, the camera glides onto the button (1.1-1.8 s), rests there through the press until the page changes at 2.4
  const log = {frames: [], events: [{t: 0, type: 'hold', box, s: 1, look: 'a'}, {t: 1.1, type: 'click', zoom: 3}, {t: 1.8, type: 'press', held: true}, {t: 2.4, type: 'mark'},
    {t: 2.4, type: 'hold', box, cut: true, s: 1.5, look: 'b'}]};
  const clip = Array.from({length: 120}, (_, j) => page(j / 30 < 1.1 ? 40 : j / 30 < 1.8 ? 60 + j : j / 30 < 2.4 ? 90 : 150));
  assert.deepEqual(strayFrames({log, thumb: j => clip[j], frames: clip.length}), [], 'the zoomed old page passes');
  clip.fill(page(150), 68, 71);   // the new page painted before the cut: caught
  assert.equal(strayFrames({log, thumb: j => clip[j], frames: clip.length})[0]?.side, 'before');
});
