// The encoder finds the sharpest quality that fits a clip's budget in a few encodes (owner, 24 Oct 2026: "why it takes you so much time?": Track's
// WebM walked 8 slow encodes one by one). Same answer as the walk, at most 4 tries on a 9-step ladder.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {crfLadder, sharpestFit} from '../../media/encode.mjs';

test('the sharpest fitting quality, the same as walking the ladder, in at most 4 encodes', async () => {
  const ladder = crfLadder(34, 50);
  assert.equal(ladder.length, 9);
  for (const first of [...ladder, 99]) {   // every place the budget can start to fit, and never
    const fits = crf => crf >= first, walked = ladder.find(fits) ?? null, found = await sharpestFit(ladder, fits);
    assert.equal(found ? found.crf : null, walked, `fits from ${first}`);
    if (found) assert.ok(found.tries.length <= 4, `fits from ${first}: ${found.tries.length} encodes (${found.tries.join(', ')})`);
  }
});

test('when nothing fits, the last encode tried is the smallest file, so the error names its real size', async () => {
  const tried = [];
  assert.equal(await sharpestFit(crfLadder(24, 34), crf => { tried.push(crf); return false; }), null);
  assert.equal(tried.at(-1), 34);
});

test('each budgeted copy logs its quality and bytes, and flags the last step before it fails (Track, run 40154540314)', async () => {
  const {budgetLine} = await import('../../media/encode.mjs');
  const ladder = crfLadder(22, 34);
  assert.equal(budgetLine('hero.mp4', 26, 1.65e6, 1.9e6, ladder), 'media: hero.mp4: CRF 26 (22-34), 1.65 of 1.90 MB');
  assert.match(budgetLine('hero-track.mp4', 34, 2.7e6, 2.8e6, ladder), /LOWEST QUALITY, raise its budget/);
});
