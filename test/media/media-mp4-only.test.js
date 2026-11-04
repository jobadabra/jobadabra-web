// Site videos are MP4 only (owner, 25 Oct 2026, "MP4 for all"): no page, encoder, placer or runner brings a WebM copy back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');

test('no site page plays a WebM, and no WebM copy sits in web/public/media', () => {
  for (const page of fs.readdirSync(new URL('web/public/', root)).filter(name => name.endsWith('.html'))) {
    assert.doesNotMatch(read(`web/public/${page}`), /\.webm\b|video\/webm/, `web/public/${page} names a WebM`);
  }
  assert.deepEqual(fs.readdirSync(new URL('web/public/media/', root)).filter(name => name.endsWith('.webm')), []);
});

test('the encoder, the placer and the runner make or copy no WebM', () => {
  assert.doesNotMatch(read('media/encode.mjs'), /'libvpx-vp9'|\.webm`/);
  assert.doesNotMatch(read('tools/hero.sh'), /\{mp4,webm|"\.webm"/);
  assert.doesNotMatch(read('.github/workflows/hero-render.yml'), /\.webm/);
  assert.doesNotMatch(read('tools/media.sh'), /libvpx-vp9/);
});
