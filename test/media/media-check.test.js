// The product media's checks (media/check.mjs): an address that may be real, a real key in a persona folder, a light window or a
// form the extension did not fill each stop the run.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captureGaps, missingFills, pieceProblems, realEmails, realSecrets} from '../../media/check.mjs';
import {missingEncoders} from '../../media/encode.mjs';

test('only e-mail addresses on reserved test domains pass', () => {
  assert.deepEqual(realEmails('alex.morgan@example.com · ada@tester.example · x@y.test · hr@northwind.example.org'), []);
  assert.deepEqual(realEmails('write to someone@gmail.com or jobs@acme.ch'), ['someone@gmail.com', 'jobs@acme.ch']);
});

test('a persona folder with a real-looking key is refused; the demo placeholders pass', () => {
  assert.deepEqual(realSecrets({ANTHROPIC_API_KEY: 'demo-key-not-real-0000000000', NOTION_TOKEN: 'demo'}), []);
  assert.deepEqual(realSecrets({NOTION_TOKEN: 'ntn_5f8a2c9d1e3b4a6f7c8d9e0a1b2c3d4e'}), ['NOTION_TOKEN']);
});

test('the clip must show the extension filling the required fields and the questions', () => {
  assert.deepEqual(missingFills(['first_name', 'last_name', 'email', 'resume', 'permit', 'privacy', 'notice']), []);
  assert.deepEqual(missingFills(['first_name', 'last_name', 'email', 'resume', 'privacy']), ['permit']);
});

test('a piece is refused for a light window, a stalled capture or a real address', () => {
  const frames = Array.from({length: 100}, (_, i) => ({t: i / 10}));
  assert.deepEqual(pieceProblems({name: 'hero', source: 'app', log: {frames, text: 'Alex Morgan'}, posterBrightness: 0.12}), []);
  const problems = pieceProblems({name: 'hero', source: 'app', log: {frames: frames.slice(0, 3).concat([{t: 10}]), text: 'me@gmail.com'}, posterBrightness: 0.8});
  assert.equal(problems.length, 3);
});

test('a run stops before recording when ffmpeg lacks an encoder the pieces need', () => {
  const list = ' V..... libx264  H.264\n V..... libvpx-vp9  VP9\n V..... libwebp  WebP\n';
  assert.deepEqual(missingEncoders(list), []);
  assert.deepEqual(missingEncoders(list.replace('libwebp', 'png')), ['libwebp']);
  assert.deepEqual(missingEncoders(list.replace(' libwebp ', ' libwebp_anim ')), ['libwebp'], 'the animated-only encoder is not enough');
});

test('every piece in scenes.mjs is checked for a light picture, whatever it records', async () => {
  const {VIDEOS} = await import('../../media/scenes.mjs');
  const frames = Array.from({length: 100}, (_, i) => ({t: i / 10}));
  for (const [name, piece] of Object.entries(VIDEOS)) {
    const log = {frames, text: '', filled: ['first_name', 'last_name', 'email', 'resume', 'permit', 'privacy']};
    assert.deepEqual(pieceProblems({name, source: piece.source, log, posterBrightness: 0.1}), [], name);
    assert.match(pieceProblems({name, source: piece.source, log, posterBrightness: 0.8}).join(), /not dark/, `${name}: a light picture passed`);
  }
});

test('the fictional form and its recorder are dark', async () => {
  const fs = await import('node:fs');
  const read = file => fs.readFileSync(new URL(`../../media/${file}`, import.meta.url), 'utf8');
  assert.match(read('form.html'), /prefers-color-scheme: dark/);
  assert.match(read('record-extension.mjs'), /emulateMedia\(\{colorScheme: 'dark'/);
});

// Round 2: a still page sends no frames (a gap-after-a-click check failed a good Set up); each look forces a repaint, so a look with no frame after it is a stall.
test('a look with no frame right after its forced repaint is a stall; a still page between looks is not', () => {
  const frames = [0, 0.5, 1, 6, 6.5].map(t => ({t}));
  assert.deepEqual(captureGaps({frames, events: [{t: 0.45, type: 'hold', look: 'a'}, {t: 3, type: 'click'}, {t: 5.9, type: 'hold', look: 'b'}]}), [], 'frames at each look; the still page between is fine');
  assert.deepEqual(captureGaps({frames, events: [{t: 3, type: 'hold', look: 'b'}]}), [{look: 'b', t: 3}]);
  assert.deepEqual(captureGaps({frames, events: [{t: 3, type: 'hold'}]}), [], 'a hold with no look shows nothing new');
  const problems = pieceProblems({name: 'hero', source: 'app', log: {frames, events: [{t: 3, type: 'hold', look: 'b'}], text: ''}, posterBrightness: 0.1, quiet: true});
  assert.ok(problems.some(line => /capture stalled/.test(line)), problems.join(' / '));
});

test('the take loop records again on every stall the final gate refuses, the frame rate too (run 28: Find, 117 frames in 31.8 s)', async () => {
  const fs = await import('node:fs');
  const {stallsOf} = await import('../../media/check.mjs');
  // a raw take: the app starting (busy, 20 fps) for 15 s, then the clip from its first look at 15 s, starved to 3 fps for 30 s
  const frames = [...Array.from({length: 300}, (_, i) => ({t: i / 20})), ...Array.from({length: 90}, (_, i) => ({t: 15 + i / 3}))];
  const events = [{t: 15, type: 'hold', look: 'a'}, {t: 30, type: 'hold', look: 'b'}];
  assert.match(stallsOf({frames, events}).join(), /only 91 frames in 29\.7 s/, 'counted from the first look: the busy start hides nothing');
  assert.deepEqual(stallsOf({frames: frames.filter(f => f.t < 15).concat(Array.from({length: 200}, (_, i) => ({t: 15 + i * 0.15}))), events}), []);
  assert.deepEqual(stallsOf({frames: [{t: 15}, {t: 30.2}], events}, true), [], 'a quiet piece needs a frame at each look only');
  const media = fs.readFileSync(new URL('../../media/media.mjs', import.meta.url), 'utf8');
  assert.match(media, /const stalls = stallsOf\(recorded, piece\.quiet\)/, 'the loop asks the same function as the gate');
  assert.match(fs.readFileSync(new URL('../../media/check.mjs', import.meta.url), 'utf8'), /for \(const stall of stallsOf\(log, quiet\)\)/);
});
