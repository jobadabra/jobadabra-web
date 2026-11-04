// Guards the stray-frame check run on the render plan before any render (media/prestray.mjs; run 27 found its false alarms only at minute 25).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('a planned frame\'s thumbnail is the view\'s area of the small grey frame (prestray.mjs thumbOf)', async () => {
  const {thumbOf} = await import('../../media/prestray.mjs');
  const {THUMB} = await import('../../media/cuts.mjs');
  const w = 480, h = 300, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < w / 2 ? 0 : 200;   // dark left half, light right half
  const scale = w / 1800;
  assert.ok(thumbOf({w, h, data}, {x: 0, y: 0, w: 900, h: 562}, scale).every(v => v === 0), 'the left half alone: dark');
  const whole = thumbOf({w, h, data}, {x: 0, y: 0, w: 1800, h: 1125}, scale);
  assert.equal(whole[0], 0);
  assert.equal(whole[THUMB.w - 1], 200);
});

test('the plan check finds an old page lingering after a cut and passes a clean one, the wide opening included (prestray.mjs planStrays)', async () => {
  const {planStrays} = await import('../../media/prestray.mjs');
  const box = {x: 100, y: 100, width: 600, height: 300}, viewport = {w: 1800, h: 1125};
  const frames = Array.from({length: 60}, (_, i) => ({t: i * 0.1, file: i * 0.1 < 1.6 ? 'old' : 'new'}));
  const events = [{t: 0, type: 'hold', look: 'a', box, s: 1.5}, {t: 1.6, type: 'mark'}, {t: 1.6, type: 'hold', look: 'b', box, s: 4, cut: true, opensWide: true}];
  const grey = level => ({w: 480, h: 300, data: new Uint8Array(480 * 300).fill(level)});
  const pages = {old: grey(40), new: grey(150)};
  assert.deepEqual(planStrays({log: {viewport, frames, events}, speed: 1.5, small: file => pages[file]}), [], 'clean');
  const late = frames.map(frame => (frame.t >= 1.6 && frame.t < 1.9 ? {...frame, file: 'old'} : frame));
  assert.equal(planStrays({log: {viewport, frames: late, events}, speed: 1.5, small: file => pages[file]})[0]?.side, 'after', 'the old page after the cut');
});

test('every recorded frame is read once, in order, by one ffmpeg call (prestray.mjs smallFrames)', async t => {
  try { execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); } catch (error) { if (process.env.CI) throw error; t.skip('no ffmpeg'); return; }   // CI installs it (tests.yml): never skipped there
  const {smallFrames, SMALL_W} = await import('../../media/prestray.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prestray-test-'));
  const levels = [20, 120, 230];
  levels.forEach((v, i) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${v.toString(16).padStart(2, '0').repeat(3)}:s=360x225:d=0.04`, '-frames:v', '1', '-q:v', '2', path.join(dir, `f${i}.jpg`)]));
  const log = {viewport: {w: 1800, h: 1125}, frames: levels.map((_, i) => ({t: i, file: `f${i}.jpg`}))};
  const small = smallFrames(dir, log);
  levels.forEach((v, i) => {
    const frame = small(`f${i}.jpg`), mean = frame.data.reduce((a, b) => a + b, 0) / frame.data.length;
    assert.equal(frame.w, SMALL_W);
    assert.ok(Math.abs(mean - v) < 12, `frame ${i}: ${mean} vs ${v}`);
  });
  fs.rmSync(dir, {recursive: true, force: true});
});

test('the plan check runs before any render, on both takes (media.mjs recordClip)', () => {
  const source = fs.readFileSync(new URL('../../media/media.mjs', import.meta.url), 'utf8');
  const check = source.indexOf('planStrays({log: take.log'), render = source.indexOf('return async () => {', check);
  assert.ok(check > 0 && render > check, 'planStrays before the render is returned');
  assert.match(source, /\[\[main, null\], \.\.\.\(phone \? \[\[narrow \|\| main, phone\]\] : \[\]\)\]/, 'the desktop take and the phone take');
});
