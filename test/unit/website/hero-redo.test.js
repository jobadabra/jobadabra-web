// The hero's redo mechanism stays whole (owner, 24 Oct 2026: "the feedback mechanism permanently available"): every clip on the stage (a scene with
// `slide` in media/scenes.mjs) is recorded by tools/hero.sh, shown by index.html with all its files placed, named in the skill, and has no
// leftover AI-director plan overriding its framing. Loops over the scenes, so a fifth phase added later is checked too.
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {VIDEOS} from '../../../media/scenes.mjs';

const root = new URL('../../../', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');
const slides = Object.entries(VIDEOS).filter(([, piece]) => piece.slide).sort(([, a], [, b]) => a.slide - b.slide).map(([name]) => name);
// The joined trees leave .claude/ out: the skill is in this repo's checkout (CI: .private/; locally .overlay sits inside the repo, so ../).
const SKILL = '.claude/skills/redo-site-hero-video/SKILL.md';
const skill = [SKILL, `.private/${SKILL}`, `../${SKILL}`].map(rel => new URL(rel, root)).find(url => existsSync(url));

test('the stage shows every slide scene, in order, and every file it names is placed', () => {
  const html = read('web/public/index.html');
  const stage = (html.match(/<div class="hero-stage"[\s\S]*?<div class="stage-steps"/) || [''])[0];
  const shown = [...stage.matchAll(/<source src="\/media\/([\w-]+)\.mp4" type="video\/mp4">/g)].map(match => match[1]);   // the desktop copy (the phone's has media=)
  assert.deepEqual(shown, slides, 'index.html plays the slide scenes in their slide order');
  for (const file of new Set([...stage.matchAll(/"\/media\/([\w.-]+)"/g)].map(match => match[1]))) {
    assert.ok(existsSync(new URL(`web/public/media/${file}`, root)), `web/public/media/${file} is placed (tools/hero.sh --place)`);
  }
  for (const name of slides) {
    const width = VIDEOS[name].phone?.width;
    assert.ok(width && stage.includes(`/media/${name}-${width}.mp4`) && stage.includes(`/media/${name}-${width}-poster.jpg`), `${name}: its ${width}-wide phone copy and poster`);
    assert.ok(stage.includes(`data-captions="/media/${name}.vtt"`), `${name}: the captions its phone copy leaves out (round 9)`);
  }
});

test('tools/hero.sh records exactly the slide scenes, and no plan overrides them', () => {
  const list = (read('tools/hero.sh').match(/^HERO=\(([^)]*)\)/m) || ['', ''])[1].trim().split(/\s+/);
  assert.deepEqual(list, slides);
  for (const name of slides) assert.ok(!existsSync(new URL(`media/plans/${name}.json`, root)), `media/plans/${name}.json would override the scene`);
});

test('the skill names every slide scene and every file it points to exists', () => {
  assert.ok(skill, `${SKILL} is in this repo's checkout`);
  const text = readFileSync(skill, 'utf8');
  for (const name of slides) assert.ok(text.includes(`\`${name}\``), `the skill names ${name}`);
  // Why (2 Nov 2026, #314): the skill names paths as they are in this repo (website/public/...); the test runs in the joined tree, where tools/layout-map.txt puts website/ at web/.
  for (const [rel, inTree = rel] of [['tools/hero.sh'], ['tools/hero-preview.mjs'], ['ops/media/scenes.mjs', 'media/scenes.mjs'], ['ops/media/camera.mjs', 'media/camera.mjs'], ['website/public/hero-stage.js', 'web/public/hero-stage.js'], ['ops/media/personas/nurse-lyon/moments/later.json', 'media/personas/nurse-lyon/moments/later.json']]) {
    assert.ok(text.includes(rel), `the skill points to ${rel}`);
    assert.ok(existsSync(new URL(inTree, root)), `${inTree} exists`);
  }
});

// Round 2 (owner, 24 Oct 2026: phases "not showing all the steps", "wrong cropping"): the owner's side-by-side and the contact sheets show EVERY beat
// of each clip (manifest `beats`), never one result frame per phase, and the skill says so.
test('the side-by-side and the contact sheets are built from each clip\'s beats', () => {
  assert.match(read('tools/hero-preview.mjs'), /\.beats\b/, 'hero-preview reads the manifest beats');
  assert.match(read('tools/hero.sh'), /beats/, 'hero.sh takes one sheet frame per beat');
  assert.match(read('media/manifest.mjs'), /beats/, 'the manifest carries the beat times');
  assert.match(readFileSync(skill, 'utf8'), /every beat/i, 'the skill asks for every beat');
});

// Round 2: the overlay was built once and never refreshed, so the app it recorded lagged public main (the redesigned setup step would have been missed).
test('tools/hero.sh records the current public app: it rebuilds the overlay when public main (or HERO_PUBLIC_REF) moved', () => {
  const text = read('tools/hero.sh');
  assert.match(text, /git ls-remote/, 'it asks GitHub for the public commit');
  assert.match(text, /HERO_PUBLIC_REF/, 'a public PR branch can be recorded');
  assert.doesNotMatch(text, /\[ -d \.overlay\/\.git \] \|\| tools\/overlay\.sh/, 'never "build once, keep forever"');
});
