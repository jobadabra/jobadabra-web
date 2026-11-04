// Every video the media pipeline writes is encoded BT.709 with the sRGB transfer tag, so browsers draw the app's colours, not a bluer cast.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {COLOR_TAGS, videoFilter} from '../../media/encode.mjs';

const source = fs.readFileSync(new URL('../../media/encode.mjs', import.meta.url), 'utf8');

test('every video encode (H.264) uses the BT.709 filter and tags', () => {
  const calls = source.split('\n').filter(line => /'-c:v', 'libx264'/.test(line));
  assert.ok(calls.length >= 2, `expected the mp4 and phone encodes, found ${calls.length}`);
  for (const line of calls) {
    assert.match(line, /videoFilter\(/, `encode without the BT.709 matrix: ${line.trim()}`);
    assert.match(line, /\.\.\.COLOR_TAGS/, `encode without the BT.709 tags: ${line.trim()}`);
  }
});

test('the filter converts with the BT.709 matrix in TV range, then to yuv420p', () => {
  assert.equal(videoFilter('scale=1600:1000:flags=lanczos'), 'scale=1600:1000:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p');
  assert.deepEqual(COLOR_TAGS, ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']);
});
