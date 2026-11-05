// The phone hero (owner, 24 Oct 2026, mockup + table): no eyebrow, one short description, ONE neutral download button, a short note and a short
// stage label on phones; the desktop hero keeps its words. Words for phones sit in .m-only, the desktop's in .m-hide (home.css), so this loops over both.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const hero = read('index.html').match(/<header class="hero split"[\s\S]*?<\/header>/)[0];
const css = read('home.css');
const phone = css.match(/@media \(max-width: 720px\) \{\n  \.m-only[\s\S]*?\n\}\n/)[0];

test('on phones the hero has one download button, no eyebrow, no apple icon on it', () => {
  assert.match(css, /\.m-only, \.stage-cap \.stage-step \{ display: none; \}/, 'the phone-only words are hidden by default (desktop unchanged)');
  assert.match(phone, /\.m-hide \{ display: none !important; \}/, 'the desktop-only words go on phones');
  assert.match(hero, /<span class="eyebrow m-hide">/, 'the eyebrow is desktop-only');
  assert.match(hero, /<div class="downloads m-hide">/, 'the Mac and Windows pair is desktop-only');
  const buttons = hero.match(/<a class="btn btn-primary hero-get m-only"[^>]*>[^<]*<\/a>/g) || [];
  assert.equal(buttons.length, 1, 'exactly one phone button');
  assert.match(buttons[0], /href="\/download\?from=hero">Get the desktop app<\/a>/, 'it goes to the platform page; no icon inside');
  assert.match(hero, /Mac &amp; Windows · Free to start/);
});

test('every phone-only word in the hero has its desktop twin, and the stage caption is short and centred on phones', () => {
  for (const [, parent] of hero.matchAll(/<(p|span|b)[^>]*>(<span class="m-hide">[\s\S]*?<\/span><span class="m-only">[\s\S]*?<\/span>)/g)) assert.ok(parent);
  assert.match(hero, /<b class="stage-title"><span class="m-hide">[^<]+<\/span><span class="m-only">[^<]+<\/span><\/b><span class="stage-step"/);
  assert.match(phone, /\.stage-cap \.stage-sub \{ display: none; \}/);
  assert.match(phone, /\.stage-later \{ display: none; \}/);
  assert.match(read('hero-stage.js'), /stage-step'\)\.textContent = `0\$\{on \+ 1\} \/ /, 'the label follows the clip');
  for (const clip of hero.match(/<video class="slide[^>]*>/g)) assert.match(clip, /data-short="[^"]+"/, 'each clip has a short phone title');
});

// Owner, 25 Oct 2026: "impose a 1.5x speed for all the clips"; and on his phone the Set up clip stayed on its poster (a refused autoplay was swallowed).
test('every clip plays at 1.5x and a refused autoplay shows the play mark', () => {
  const js = read('hero-stage.js');
  assert.match(js, /const SPEED = 1\.5;/, 'one speed for the four clips');
  assert.match(js, /clips\.forEach\(clip => \{ clip\.defaultPlaybackRate = SPEED; clip\.playbackRate = SPEED; \}\);/, 'set on every clip, also the ones not loaded yet');
  assert.doesNotMatch(js, /\.play\(\)\.catch\(\(\) => \{\}\)/, 'no play() whose refusal is swallowed: start() shows the play mark');
  assert.match(js, /error\.name === 'NotAllowedError' && clip === clips\[on\] && seen\) setPaused\(true\)/, 'a refused clip pauses with the mark, so a tap starts it');
});

// Owner, 25 Oct 2026, iPhone: autoplay still failed and two play buttons showed. A play() below the fold is refused by iOS and was read as "the person paused" (mark + button);
// pause() on a clip waiting to autoplay cancels the browser's own start.
test('an early refused play() waits for the stage to be seen, and pause() never cancels a pending autoplay', () => {
  const js = read('hero-stage.js');
  assert.match(js, /&& seen\) setPaused\(true\)/, 'no paused mark before the observer has reported the stage');
  assert.match(js, /else if \(!clips\[on\]\.paused\) clips\[on\]\.pause\(\)/, 'pause() only a clip that is playing');
  assert.match(js, /seen = true; setPaused\(paused\)/, 'the observer retries the start once the stage shows');
});

test('phones show one play mark: the tab-row button is hidden, the picture toggles', () => {
  const css = read('home.css');
  assert.match(css, /@media \(max-width: 720px\) \{[^}]*\.stage-steps \.stage-pause \{ display: none; \}/, 'second play button hidden on phones');
});

// Owner, 25 Oct 2026, from iOS guidance ("autoplay muted playsinline" on an H.264 MP4): the first clip asks the browser to autoplay itself, not only the script.
test('the first hero clip carries autoplay, muted and playsinline; the others wait for the script', () => {
  const clips = [...read('index.html').matchAll(/<video class="slide[^>]*>/g)].map(match => match[0]);
  assert.equal(clips.length, 4);
  assert.match(clips[0], /autoplay muted playsinline/, 'the first clip starts by itself, muted and inline');
  for (const clip of clips) assert.match(clip, /muted playsinline/, 'every clip is muted and inline');
  for (const clip of clips.slice(1)) assert.doesNotMatch(clip, /autoplay/, 'only the first clip autoplays; the script plays the next ones in turn');
});
