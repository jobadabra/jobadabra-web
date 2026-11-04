// The product media's manifest (media/manifest.mjs), the shape the site redesign reads, and the scenes it describes: every
// piece the site places has its words and sizes; captions stay short and in the manifest, never in the video.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {manifest, stillEntry, VERSION, videoEntry} from '../../media/manifest.mjs';
import {SNIPS, STILLS, VIDEOS} from '../../media/scenes.mjs';

test('a video entry carries the agreed fields; a partial run keeps the other entries', () => {
  const hero = videoEntry({name: 'hero', piece: VIDEOS.hero, files: {mp4: 'hero.mp4', poster: 'hero-poster.jpg', phone: 'hero-720.mp4'}, bytes: {mp4: 1}, seconds: 14.44});
  assert.deepEqual(Object.keys(hero), ['name', 'kind', 'theme', 'shows', 'caption', 'alt', 'files', 'width', 'height', 'duration_s', 'bytes']);
  assert.equal(hero.duration_s, 14.4);
  assert.equal(hero.theme, 'dark');
  const still = stillEntry({name: 'jobs', kind: 'still', file: 'still-jobs.webp', bytes: 9, width: 1600, height: 1000, shows: 'Jobs'});
  const first = manifest({entries: [hero, still], made: {sha: 'abc', at: 'now', persona: 'demo'}});
  assert.equal(first.version, VERSION);
  const again = manifest({entries: [{...hero, caption: 'New'}], previous: first, made: {sha: 'def', at: 'later', persona: 'demo'}});
  assert.equal(again.items.length, 2, 'the still is kept');
  assert.equal(again.items.find(item => item.name === 'hero').caption, 'New');
  assert.equal(again.made_from, 'def');
});

test('every piece has the words the site needs; video captions are 6 words at most; the hero clips fit 2.5 MB and have phone copies', () => {
  for (const [name, piece] of Object.entries(VIDEOS)) {
    if (piece.part) { assert.ok(piece.shows && piece.steps.length, name); continue; }   // played inside the piece that names it `before` (Apply, round 3)
    for (const key of ['shows', 'caption', 'alt']) assert.ok(piece[key], `${name}.${key}`);
    assert.ok(piece.caption.split(/\s+/).length <= 6, `${name}: caption over 6 words`);
    assert.equal(piece.width / piece.height, 1.6, `${name}: 16:10`);
    assert.ok(piece.budget > 0 && piece.steps.length, name);
  }
  const slides = Object.values(VIDEOS).filter(piece => piece.slide);
  assert.ok(slides.reduce((sum, piece) => sum + piece.budget, 0) <= 9.8e6, 'the four hero clips together fit 9.8 MB at most (25 Oct 2026: Find +0.5 for the drawer tabs, Track +0.4 for the click zooms) (round 8: the sharper grade, +41%; round 9: room for CRF 22, owner: "low resolution"; run 27: Track\'s wide openings left its WebM, the copy Chrome plays, over 2.2 MB at the lowest quality; run 29: 2.63 MB at VP9 CRF 50, bigger than its H.264 copy (2.25 MB))');
  assert.ok(slides.every(piece => piece.phone?.width === 1080 && piece.phone.budget) && slides.reduce((sum, piece) => sum + piece.phone.budget, 0) <= 6.3e6, 'phone copies 1080 wide, 6.3 MB together at most (round 9: "low resolution")');
  for (const [name, item] of [...Object.entries(STILLS), ...Object.entries(SNIPS)]) assert.ok(item.shows && item.steps.length, name);
});
