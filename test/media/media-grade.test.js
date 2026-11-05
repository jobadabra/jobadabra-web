// The demo's grade (owner, 24 Oct 2026: "it looks washed, it doesn't have a high contrast"; option C): the app's own dark-theme colours come out with
// a darker page, brighter grey text and the white text kept; render.cjs grades the app's pixels BEFORE drawing the captions, tags, cards and cursor,
// so the brand amber of a step tag is never graded (a whole-frame grade turned 255,178,36 into 255,204,0).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GRADE, gradeColour, gradeSvg} from '../../media/grade.mjs';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('measured on the app\'s dark colours: the page and card darker, the grey text brighter, the white text kept', () => {
  const page = [11, 16, 22], card = [18, 26, 35], hint = [147, 161, 176], ink = [232, 236, 240];
  assert.ok(luma(gradeColour(page)) < luma(page) - 4, `page ${gradeColour(page)}`);
  assert.ok(luma(gradeColour(card)) < luma(card) - 4, `card ${gradeColour(card)}`);
  assert.ok(luma(gradeColour(hint)) > luma(hint) + 10, `grey text ${gradeColour(hint)}`);
  assert.ok(luma(gradeColour(ink)) >= luma(ink) - 1, `text ${gradeColour(ink)}`);
  assert.deepEqual(gradeColour([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(gradeColour([255, 255, 255]), [255, 255, 255]);
});

test('the SVG filter carries the curve, the colour and the sharpening, in sRGB', () => {
  const svg = gradeSvg();
  assert.match(svg, /<filter id="grade" color-interpolation-filters="sRGB"/);
  assert.equal(svg.match(/tableValues="([^"]+)"/g).length, 3, 'one table per channel');
  assert.ok(svg.includes(GRADE.table.join(' ')) && svg.includes(`values="${GRADE.saturate}"`) && svg.includes('feConvolveMatrix'));
});

test('render.cjs grades the app\'s pixels before any overlay: click ring, caption, tag, title card', () => {
  const src = fs.readFileSync(new URL('../../media/render.cjs', import.meta.url), 'utf8');
  const graded = src.indexOf('    grade();\n');
  assert.ok(graded > 0, 'the frame loop calls grade()');
  for (const overlay of ['frame.press != null', 'if (frame.say)', 'frame.card']) {
    assert.ok(src.indexOf(overlay) > graded, `${overlay} is drawn after the grade`);
  }
  assert.match(fs.readFileSync(new URL('../../media/media.mjs', import.meta.url), 'utf8'), /gradeSvg: gradeSvg\(\)/, 'every render job carries the grade');
});
