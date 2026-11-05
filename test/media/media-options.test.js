// The media command's pure parts (media/options.mjs, stand-in.mjs): pieces, persona folders, the director's plan, the stand-in's answers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {jpegWidth, loadPersona, parseArgs, planOf, withPlan} from '../../media/options.mjs';
import {partsOf, VIDEOS} from '../../media/scenes.mjs';
import {answerReply, formHtml} from '../../media/stand-in.mjs';

const demo = path.join(import.meta.dirname, '..', 'demo');

test('pieces: all by default, some by name, an unknown one refused', () => {
  assert.deepEqual(parseArgs([]).pieces, [...Object.keys(VIDEOS), 'stills', 'snips']);
  assert.deepEqual(parseArgs(['hero', '--out', 'x']).pieces, ['hero']);
  assert.throws(() => parseArgs(['heroes']), /unknown piece heroes/);
});

test('the demo folder is a persona; a folder with a real key or no profile is refused; media.json overrides the defaults', () => {
  assert.equal(loadPersona(demo).applicant.first_name, 'Alex');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-persona-'));
  assert.throws(() => loadPersona(folder), /not a persona folder/);
  fs.writeFileSync(path.join(folder, 'profile.md'), '# Nurse');
  fs.writeFileSync(path.join(folder, 'media.json'), JSON.stringify({name: 'nurse-lyon', applicant: {first_name: 'Camille'}, job: {company: 'Clinique du Parc'}}));
  const persona = loadPersona(folder);
  assert.equal(persona.name, 'nurse-lyon');
  assert.equal(persona.applicant.first_name, 'Camille');
  assert.equal(persona.applicant.email, 'alex.morgan@example.com', 'unset fields keep the defaults');
  assert.equal(persona.job.company, 'Clinique du Parc');
  fs.writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify({NOTION_TOKEN: 'ntn_5f8a2c9d1e3b4a6f7c8d9e0a1b2c3d4e'}));
  assert.throws(() => loadPersona(folder), /real-looking keys/);
  fs.rmSync(folder, {recursive: true, force: true});
});

test('the director\'s plan sets a zoom per look and the manifest\'s words; no plan keeps the scene', () => {
  assert.equal(withPlan(VIDEOS['hero-track'], null), VIDEOS['hero-track']);
  const planned = withPlan(VIDEOS['hero-track'], {zooms: {'#activity-card .mail-email': 1.3}, caption: 'Jobs that fit you'});
  assert.equal(planned.steps.find(step => step.look === '#activity-card .mail-email').zoom, 1.3);
  assert.equal(planned.caption, 'Jobs that fit you');
  assert.equal(planOf('no-such-piece', os.tmpdir()), null);
});

test('the stand-in answers only the questions asked, with the persona\'s words; the form shows the persona\'s job', () => {
  const reply = answerReply(JSON.stringify({fields: [{field: 'permit'}, {field: 'unknown'}]}), {permit: 'Yes', notice: '1 month'});
  assert.deepEqual(reply, {ok: true, eligible: true, answers: [{field: 'permit', value: 'Yes'}]});
  assert.deepEqual(answerReply('not json', {permit: 'Yes'}).answers, []);
  const page = formHtml(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'media', 'form.html'), 'utf8'), {company: 'Clinique du Parc', title: 'Nurse', place: 'Lyon, France', city: 'Lyon'});
  assert.ok(page.includes('<h1>Nurse</h1>') && page.includes('Clinique du Parc') && !page.includes('{{'));
});

test('a frame\'s width is read from its JPEG header', () => {
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x08, 0xca, 0x0e, 0x10]);
  assert.equal(jpegWidth(sof), 3600);
});

test('the hero clips play at most 2x and every zoomed view stays on screen long enough to read (owner, 21 Oct 2026)', () => {
  for (const [name, piece] of Object.entries(VIDEOS)) {
    if (!piece.slide && !piece.part) continue;
    assert.ok((piece.speed || 1) <= 2, `${name} plays at ${piece.speed}x`);
    for (const step of piece.steps.filter(item => item.look)) {
      const seen = step.hold / (piece.speed || 1);
      assert.ok(seen >= 1.1, `${name}: ${step.look} is on screen ${seen.toFixed(1)} s`);
    }
  }
});

// Owner, 24 Oct 2026 (sketch MD1RKmELpnh7rzkprJkKfg + review): "zoom toward the result, then hold"; one deliberate move per phase; key facts readable at the
// hero's real size; a tighter phone crop. Every clip on the hero stage, so a fifth one follows the same rules.
test('every hero clip is steady, makes at most one deliberate move, holds a zoomed result 2 s or more, and has its own 4:3 phone copy', () => {
  const slides = Object.entries(VIDEOS).filter(([, piece]) => piece.slide);
  assert.deepEqual(slides.map(([, piece]) => piece.slide).sort(), [1, 2, 3, 4]);
  for (const [name, piece] of slides) {
    assert.equal(piece.camera, 'steady', `${name}: no zoom on every click`);
    // Apply plays its app parts around the fill (round 3: before; round 5: after): one clip, one budget of moves; each part opens on its own first look (the join is a cut)
    // one deliberate camera move per part: a part is a phase of its own (round 5, owner: the live card "B, then pan to the pill")
    for (const part of partsOf(name)) {
      const steps = VIDEOS[part].steps;
      const looks = steps.filter(step => step.look);   // a look that repeats the one before it moves nothing (the drawer's tabs, owner 25 Oct 2026)
      const moves = looks.slice(1).filter((step, i) => !step.cut && JSON.stringify(step.look) !== JSON.stringify(looks[i].look)).length + steps.filter(step => (step.click || step.tap) && step.zoom).length;
      // a piece may name more (owner, 25 Oct 2026: a close zoom on Use Free AI and on the search card, besides the result's move): `moves` in scenes.mjs
      assert.ok(moves <= (VIDEOS[part].moves || 1), `${part}: ${moves} camera moves`);
    }
    const result = piece.steps.find(step => step.poster);
    assert.ok(result && result.look && result.zoom >= (result.wide ? 1.4 : 1.6), `${name}: a zoomed result marked poster`);
    assert.ok(result.hold / piece.speed >= 2, `${name}: the result is on screen ${(result.hold / piece.speed).toFixed(1)} s`);
    assert.equal(piece.phone.width / piece.phone.height, 4 / 3, `${name}: phone copy 4:3`);
    assert.ok(piece.steps.filter(step => step.look).every(step => (step.phoneZoom || 0) > (step.zoom || 1)), `${name}: the phone crops tighter`);
  }
});

// Round 2 (owner, 24 Oct 2026: Set up "not showing all the steps", Find "show we got to that list", Track "doesn't continue the journey"): a phase is the
// user's real sequence, one look per step, each look naming what the viewer reads (its beat: the storyboard's caption, tools/hero.sh --storyboard).
test('every hero look names its beat; a phase shows three steps or more, except Apply (one fill)', () => {
  for (const [name, piece] of Object.entries(VIDEOS).filter(([, p]) => p.slide)) {
    const looks = piece.steps.filter(step => step.look);
    for (const look of looks) assert.ok(typeof look.beat === 'string' && look.beat.length >= 12, `${name}: ${look.look} has no beat`);
    if (piece.source === 'app') assert.ok(looks.length >= 3, `${name}: ${looks.length} steps shown`);
    assert.equal(new Set(looks.map(look => look.beat)).size, looks.length, `${name}: two looks with the same beat`);
  }
});

// Round 2: Recent activity (opened for Track's Gmail beat) stays open on the next page and covered the Interviews table (a click timed out).
test('a scene that opens the Recent activity panel closes it before it goes to another page', () => {
  const TOGGLE = "getElementById('activity-toggle')";
  for (const [name, piece] of Object.entries(VIDEOS)) {
    let open = false;
    for (const step of piece.steps) {
      if ([step.js, step.then].some(code => code?.includes(TOGGLE))) open = !open;   // a press's `then` opens it too (round 5: Run on the Actions card)
      else if (step.go) assert.ok(!open, `${name}: close Recent activity before {go: '${step.go}'}`);
    }
  }
});

test('every scene step that clicks the results panel\'s toggle sets it open or shut, never flips it (runs 26-28: Track\'s e-mail look)', async () => {
  const {VIDEOS, STILLS} = await import('../../media/scenes.mjs');
  let seen = 0;
  for (const [name, piece] of Object.entries({...VIDEOS, ...STILLS})) for (const step of piece.steps || []) for (const value of Object.values(step)) {
    if (typeof value !== 'string' || !value.includes('activity-toggle')) continue;
    seen++;
    assert.match(value, /\.hidden/, `${name}: ${value.slice(0, 80)} reads the panel's state before clicking`);
  }
  assert.ok(seen >= 3, `${seen} toggle steps`);
});

