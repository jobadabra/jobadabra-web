// The hero's before/after is video, side by side (owner, 24 Oct 2026: "the before/after should be on video clips, not screenshots ... the before
// we can take from the website/master branch"): the filter labels both, holds the shorter one, and every published hero clip has a before.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COMPARE, comparable, compareFilter, outputsOf} from '../../media/compare.mjs';

test('the two clips play side by side at one height, each labelled, the shorter one held on its last frame', () => {
  const filter = compareFilter([12.9, 9.2], {font: null});
  assert.match(filter, /\[0:v\]scale=-2:500,setsar=1,drawtext=text='Before · live site \(main\)'/, 'the before is main, labelled, not held (it is the longer)');
  assert.match(filter, /\[1:v\]scale=-2:500,setsar=1,tpad=stop_mode=clone:stop_duration=3\.7,drawtext=text='After · this branch'/);
  assert.match(filter, /\[b\]\[a\]hstack=inputs=2/);
  assert.match(compareFilter([5, 5], {height: COMPARE.phoneHeight, font: null}), /scale=-2:540,setsar=1,drawtext/, 'equal lengths: nothing held');
});

test('every hero clip of a set that main publishes gets its before, the phone copies too; stills and new clips do not', () => {
  const set = ['hero.mp4', 'hero.webm', 'hero-fill.mp4', 'hero-fill-720.mp4', 'hero-fill-poster.jpg', 'hero-new.mp4', 'sheets'];
  const main = ['hero.mp4', 'hero-fill.mp4', 'hero-fill-720.mp4', 'hero-fill-poster.jpg'];
  assert.deepEqual(comparable(set, main), ['hero', 'hero-fill', 'hero-fill-720']);
});

// The first PR with these clips was refused: the body check (tools/pr-screens.py) wants a | What changed | Before | After | row, the two sides apart.
test('each piece also gets a GIF per side for the PR\'s Before and After columns', () => {
  const files = outputsOf('hero-fill', '/out');
  assert.equal(files.before_gif, '/out/hero-fill-before.gif');
  assert.equal(files.after_gif, '/out/hero-fill-after.gif');
  assert.equal(files.compare_mp4, '/out/hero-fill-compare.mp4');
  assert.ok(COMPARE.sideWidth * 2 === COMPARE.gifWidth, 'a side is half the side-by-side');
});
