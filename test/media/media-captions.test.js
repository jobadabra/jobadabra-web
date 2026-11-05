// Guards the hero's on-video captions (media/captions.mjs, round 3): every hero step that names a beat says a short line, a cut look's line starts at its
// cut, and a caption stays until the next one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captionAt, captionSize, captionTimes, SAY_MAX, TAG_MAX} from '../../media/captions.mjs';
import {partsOf, VIDEOS} from '../../media/scenes.mjs';

const hero = Object.entries(VIDEOS).filter(([, piece]) => piece.slide || piece.part);

test('every hero look that names a beat says a line short enough to read at once', () => {
  assert.ok(hero.length >= 5, 'the four hero clips and the Apply clip\'s app part');
  for (const [name, piece] of hero) {
    for (const step of piece.steps.filter(each => each.beat)) {
      assert.ok(step.say, `${name}: the look "${step.beat}" has no caption (say)`);
      assert.ok(step.say.length <= SAY_MAX, `${name}: "${step.say}" is ${step.say.length} characters (at most ${SAY_MAX})`);
    }
  }
});

test('a part played before or after a piece exists and is not a piece of its own', () => {
  for (const [name, piece] of Object.entries(VIDEOS)) {
    for (const which of ['before', 'after'].filter(key => piece[key])) {
      const part = VIDEOS[piece[which]];
      assert.ok(part?.part, `${name}: ${which} "${piece[which]}" must be a VIDEOS entry with part: true`);
      assert.equal(part.speed, piece.speed, `${name}: its part plays at the same speed`);
      assert.equal(part.camera, piece.camera);
    }
  }
  assert.deepEqual(partsOf('hero-fill')[1], 'hero-fill', 'the piece plays between its parts');
});

test('a cut look\'s caption starts at its cut, an action\'s at its moment, and stays until the next', () => {
  const log = {events: [
    {type: 'hold', t: 0, s: 1, box: {}, say: 'first'},
    {type: 'mark', t: 1.2},
    {type: 'hold', t: 1.6, s: 1, box: {}, cut: true, say: 'after the cut'},
    {type: 'click', t: 2.8, say: 'she clicks'},
  ]};
  const list = captionTimes(log);
  assert.deepEqual(list.map(each => [each.t, each.say]), [[0, 'first'], [1.2, 'after the cut'], [2.8, 'she clicks']]);
  assert.deepEqual(captionAt(list, 1.1), {say: 'first', sayAge: 1.1});
  assert.equal(captionAt(list, 1.2).say, 'after the cut');
  assert.equal(captionAt(list, 9).say, 'she clicks');
  assert.deepEqual(captionAt([{t: 1, say: 'later'}], 0.5), {});
});

test('captions read on the phone copy as on the desktop one', () => {
  assert.ok(captionSize(720, true) >= 36, 'phone: about 20 px on a 390-px-wide screen');
  assert.ok(captionSize(1600, false) >= 26);
});

// Round 4 (owner, 24 Oct 2026: "we kind of need to highlight each of the steps"): every hero clip says where it is from its first line, in a short tag;
// a Set up tag counts the wizard's steps, so its lines no longer start with "Step n".
test('every hero clip and part names where it is from its first caption, in a short tag', () => {
  for (const [name, piece] of hero) {
    const said = piece.steps.filter(step => step.say);
    assert.ok(said[0]?.tag, `${name}: its first caption "${said[0]?.say}" has no tag`);
    for (const step of piece.steps.filter(each => each.tag)) assert.ok(step.tag.length <= TAG_MAX, `${name}: tag "${step.tag}" is longer than ${TAG_MAX}`);
  }
  const setup = VIDEOS['hero-onboarding'].steps.filter(step => step.tag);
  assert.deepEqual(setup.map(step => step.tag), ['Set up 1/5', 'Set up 2/5', 'Set up 3/5']);
  for (const step of VIDEOS['hero-onboarding'].steps.filter(each => each.say)) assert.doesNotMatch(step.say, /^Step \d/, 'the tag counts the steps');
});

test('a tag stays with the captions after it until another one is named', () => {
  const list = captionTimes({events: [
    {type: 'hold', t: 0, s: 1, box: {}, say: 'one', tag: 'Jobs'},
    {type: 'click', t: 1, say: 'two'},
    {type: 'hold', t: 2, s: 1, box: {}, say: 'three', tag: 'Chrome'},
  ]});
  assert.deepEqual(list.map(each => each.tag), ['Jobs', 'Jobs', 'Chrome']);
  assert.equal(captionAt(list, 1.5).tag, 'Jobs');
  assert.equal(captionAt([{t: 0, say: 'no tag'}], 1).tag, undefined);
});

// Owner, 24 Oct 2026: "Let's not put 'She' or 'He'. Let it be impersonal" (the Track card said "She opens Jobadabra to check her mail"). Every word a
// viewer reads (captions, cards, tags, the site's caption and alt) and every beat on the preview names no person: the CV, the job, the form.
const PERSONAL = /\b(she|he|her|hers|herself|him|his|himself)\b/i;
test('no hero caption, card, tag, site text or beat says she, he, her or his', () => {
  for (const [name, piece] of hero) {
    const words = [piece.caption, piece.alt, piece.shows, piece.card, ...(piece.steps || []).flatMap(step => [step.say, step.card, step.tag, step.beat])];
    for (const text of words.filter(Boolean)) assert.doesNotMatch(text, PERSONAL, `${name}: "${text}" (impersonal: the CV, the job, the form)`);
  }
});
