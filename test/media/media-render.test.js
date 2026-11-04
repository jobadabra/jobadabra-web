// A render that ends short never passes as done (round 9, 24 Oct 2026: the phone copy's renderer quit 17 frames in with exit 0 on a Mac low on
// memory; the clip came out 0.4 s long and only a missing poster stopped the run): runRender counts the frames it got and renders again once.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
const ELECTRON = process.env.ELECTRON_BIN || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', '.bin', 'electron');
// The binary itself, not the npm shim: the site CI installs with ELECTRON_SKIP_BINARY_DOWNLOAD=1, so .bin/electron is there and runs nothing (#100 red).
const HAS_ELECTRON = process.env.ELECTRON_BIN ? fs.existsSync(process.env.ELECTRON_BIN) : fs.existsSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'node_modules', 'electron', 'path.txt'));

test('runRender checks the frame count of what it made against the job, renders once more, then stops the piece', () => {
  const media = read('media.mjs');
  assert.match(media, /const made = fs\.existsSync\(job\.out\) \? framesIn\(job\.out\) : 0;\n\s+if \(made === job\.frames\.length\) return job\.out;/);
  assert.match(media, /if \(attempt >= tries\) throw new Error\(`media: \$\{name\}: \$\{path\.basename\(job\.out\)\} has \$\{made\} of/);
});

test('a renderer that is gone fails the render instead of ending it', () => {
  assert.match(read('render.cjs'), /win\.webContents\.on\('render-process-gone', [^\n]*app\.exit\(1\)/);
});

test('framesIn counts a video\'s frames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-in-')), file = path.join(dir, 'clip.mp4');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=30:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    const {framesIn} = await import('../../media/encode.mjs');
    assert.equal(framesIn(file), 12);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Speed (round 9, owner: "Is there anyway we can speed up the recording process? ... can we parallelize it more?"): renders were ~80% of a redo,
// one copy at a time on one core. Every take is recorded and checked first, then every copy renders, a few at once.
test('the render queue runs at most n jobs at once and every job ends', async () => {
  const {limiter} = await import('../../media/renders.mjs');
  const run = limiter(3);
  let now = 0, most = 0;
  const job = ms => run(async () => { now++; most = Math.max(most, now); await new Promise(resolve => setTimeout(resolve, ms)); now--; return ms; });
  const done = await Promise.all([30, 10, 20, 5, 15, 25, 10, 5].map(job));
  assert.deepEqual(done, [30, 10, 20, 5, 15, 25, 10, 5]);
  assert.equal(most, 3);
  await assert.rejects(run(async () => { throw new Error('bad'); }), /bad/);
  assert.equal(await job(1), 1, 'a failed job frees its slot');
});

test('every check runs before any render: a clip and picture in picture return a finish(), main renders all pieces after all takes', () => {
  const media = read('media.mjs');
  const clip = media.slice(media.indexOf('async function recordClip'), media.indexOf('function edgesOk'));
  const checks = clip.indexOf('checked();'), plan = clip.indexOf('planStrays(', checks), finish = clip.indexOf('// -> finish()', plan);
  assert.ok(checks > 0 && plan > checks && finish > plan && finish < clip.indexOf('await Promise.all([render(main'), 'recordClip: checks, the plan\'s stray frames (prestray.mjs), then renders');
  const pip = media.slice(media.indexOf('async function recordPip'), media.indexOf('function joined'));
  assert.ok(pip.indexOf('edgesOk(rec.name') < pip.indexOf('await Promise.all([compose('), 'recordPip: checks, then renders');
  assert.match(media, /const finishes = await settled\(options\.pieces[^\n]*makeVideo\(/);
  assert.match(media, /entries\.push\(\.\.\.await settled\(finishes\.map\(finish => finish\(\)\)\)\)/);
  assert.match(media, /return renderQueue\(async \(\) => \{ for \(let attempt = 1; ; attempt\+\+\) \{\n\s+const run = await runChild\(/, 'every render goes through the queue');
});

test('Electron is started once, alone, before renders run side by side (run 30: four first starts at once on a fresh copy collided)', () => {
  const media = read('media.mjs');
  const fn = media.slice(media.indexOf('async function runRender'), media.indexOf('// Words only'));
  assert.ok(fn.indexOf('await electronOnce();') > 0 && fn.indexOf('await electronOnce();') < fn.indexOf('renderQueue('), 'runRender waits for the one start before queueing');
  assert.match(media, /electronReady \?\?= runChild\(ELECTRON, \['--version'\]/, 'one shared start, memoised');
});

test('a copy renders in pieces of at least MIN_CHUNK frames, covering every frame once, in order (renders.mjs chunksOf)', async () => {
  const {chunksOf, MIN_CHUNK} = await import('../../media/renders.mjs');
  for (const count of [1, 89, 90, 179, 180, 572, 726, 2000]) {
    const pieces = chunksOf(count, 4);
    assert.equal(pieces[0][0], 0, `${count}`);
    assert.equal(pieces.at(-1)[1], count, `${count}`);
    pieces.forEach(([from, to], i) => { if (i) assert.equal(from, pieces[i - 1][1]); assert.ok(to > from); });
    assert.ok(pieces.length <= 4 && (pieces.length === 1 || pieces.every(([from, to]) => to - from >= MIN_CHUNK)), `${count}: ${JSON.stringify(pieces)}`);
  }
  assert.equal(chunksOf(726, 4).length, 4);
  assert.equal(chunksOf(100, 4).length, 1, 'a short copy stays whole');
});

test('the master uses the Mac\'s video chip where ffmpeg has it, x264 elsewhere or with HERO_HW=0 (renders.mjs masterEncoder)', async () => {
  const {masterEncoder, VIDEOTOOLBOX, X264} = await import('../../media/renders.mjs');
  assert.deepEqual(masterEncoder({}, () => true), VIDEOTOOLBOX);
  assert.deepEqual(masterEncoder({}, () => false), X264, 'the CI runner');
  assert.deepEqual(masterEncoder({HERO_HW: '0'}, () => true), X264);
  assert.match(read('render.cjs'), /\.\.\.\(job\.encoder \|\| \['-c:v', 'libx264'/, 'the renderer takes the job\'s encoder');
  const media = read('media.mjs');
  assert.match(media, /const encoder = masterEncoder\(\), pieces = chunksOf\(job\.frames\.length\);/, 'every render goes through the pieces and the encoder');
  assert.match(media, /'-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', job\.out/, 'pieces joined without encoding again');
  assert.match(media, /joined \$\{made\} of \$\{job\.frames\.length\} frames/, 'a join that lost frames stops the piece');
  assert.match(media, /'-map', '\[v\]', \.\.\.masterEncoder\(\), '-pix_fmt'/, 'joined parts use the same encoder');
});

test('pieces of a render draw the same frames as the whole render, joined (render.cjs + the concat join)', {skip: !HAS_ELECTRON && !process.env.CI && 'no Electron binary here (a fresh overlay installs without it); CI installs it (tests.yml), or ELECTRON_BIN=<path>'}, async () => {
  assert.ok(HAS_ELECTRON, 'CI must install the Electron binary for this test (tests.yml: "Electron and a display")');
  const {chunksOf} = await import('../../media/renders.mjs');
  const {framesIn} = await import('../../media/encode.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-')), frames = path.join(dir, 'frames');
  fs.mkdirSync(frames);
  for (const [i, colour] of ['red', 'green', 'blue'].entries()) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=${colour}:s=320x200`, '-frames:v', '1', path.join(frames, `f${i}.jpg`)]);
  const all = Array.from({length: 200}, (_, j) => ({file: `f${Math.floor(j / 70)}.jpg`, x: 0, y: 0, w: 320, h: 200, cx: 10, cy: 10, cursor: false}));
  const job = {framesDir: frames, scale: 1, width: 320, height: 200, fps: 30, ring: 0.5, captionSize: 20, sayFade: 0.25, ffmpeg: 'ffmpeg', gradeSvg: '<svg xmlns="http://www.w3.org/2000/svg"><filter id="grade"><feComponentTransfer/></filter></svg>'};
  const electron = ELECTRON, render = new URL('../../media/render.cjs', import.meta.url).pathname;
  const outs = chunksOf(all.length, 4, 50).map(([from, to], i) => {
    const out = path.join(dir, `part${i}.mp4`), file = path.join(dir, `part${i}.json`);
    fs.writeFileSync(file, JSON.stringify({...job, frames: all.slice(from, to), out}));
    execFileSync(electron, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), render, file], {stdio: 'pipe'});   // Linux CI: no setuid sandbox; stderr kept for the error
    return out;
  });
  const list = path.join(dir, 'parts.txt'), joined = path.join(dir, 'joined.mp4');
  fs.writeFileSync(list, outs.map(out => `file '${out}'`).join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  assert.equal(framesIn(joined), all.length);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('the MP4 and phone ladders of a clip run side by side (encode.mjs encodeVideo)', () => {
  const encode = read('encode.mjs');
  assert.match(encode, /export async function encodeVideo\(/);
  assert.match(encode, /await Promise\.all\(jobs\);/);
  const body = encode.slice(encode.indexOf('export async function encodeVideo('));
  assert.doesNotMatch(body.slice(0, body.indexOf('\n}\n')), /\bff\('-/, 'no encode inside it blocks the others');
  assert.match(read('media.mjs'), /const \{files, bytes\} = await encodeVideo\(/);
});
