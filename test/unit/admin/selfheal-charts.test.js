// Self-healing charts (owner, 5 Nov 2026: plain tables of numbers become charts). Each keeps its table behind "Show table".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {finderFigure, resolutionFigure} from '../../../admin/selfheal-charts.js';
import {RESOLUTION_WORDS, causesSection, periodsSection} from '../../../admin/selfheal.js';

const TABLE = '<div class="wrap"><table><tr><td>old table</td></tr></table></div>';

test('What the Finder found: a stacked bar per detector, real / false / duplicate / unclear; open issues only in the tooltip; the table behind the toggle', () => {
  const rows = [{detector: 'AI code review', filed: 10, fixed: 3, queued: 1, falsePositive: 2, harness: 1, duplicate: 1, stale: 0, unclear: 1, open: 1}, {detector: 'Layout checks', filed: 0}];
  const html = finderFigure(rows, {fixed: 3, queued: 1, falsePositive: 2, harness: 1}, TABLE);
  assert.match(html, /10 filed/); assert.match(html, /4 real/); assert.match(html, /3 wrong/); assert.match(html, /open, unjudged 1/); assert.match(html, /<details class="vz-more"><summary>Show table<\/summary><div class="wrap">/);
  assert.match(html, /Layout checks/, 'a detector that filed nothing is still listed'); assert.equal(finderFigure([], {}, TABLE), TABLE, 'no detectors: the table alone');
});

test('Why issues were closed: one segmented bar of the labels in words; a tail folds into Other; none is the table alone', () => {
  const causes = [['fixed', 9], ['duplicate', 5], ['by-design', 3], ['fp:harness', 2], ['fp:detector', 2], ['fp:unknown', 1], ['not-seen', 1]];
  const html = resolutionFigure(causes, RESOLUTION_WORDS, TABLE);
  assert.match(html, /A fix landed/); assert.match(html, /Other/); assert.match(html, /23 closed with a label/); assert.match(html, /A fix landed is 39%/);
  assert.equal(resolutionFigure([], RESOLUTION_WORDS, TABLE), TABLE);
});

test('the Self-healing page keeps both tables behind their charts', () => {
  const live = {periods: {all: {totals: {filed: 4, fixed: 1, real: 1, falsePositive: 1, precision: 0.5, judged: 2}, byDetector: [{detector: 'AI code review', filed: 4, fixed: 1, queued: 0, falsePositive: 1}]}}, history: [], causes: {fixed: 2, duplicate: 1}};
  const finder = periodsSection(live), why = causesSection(live);
  assert.match(finder, /class="vz"/); assert.match(finder, /<details class="vz-more">[\s\S]*<th>Detector<\/th>/);
  assert.match(why, /class="vz"/); assert.match(why, /<details class="vz-more">[\s\S]*<th>Resolution<\/th>/);
});

test('the "real" chip prints the same number as the "Real bugs caught" tile (totals.real), not a sum of its own', () => {
  const html = finderFigure([{detector: 'A', filed: 8, fixed: 2, queued: 1}], {real: 5, fixed: 2, queued: 1}, '<table></table>');
  assert.match(html, /5 real/);
  assert.match(finderFigure([{detector: 'A', filed: 3, fixed: 2, queued: 1}], {fixed: 2, queued: 1}, '<table></table>'), /3 real/);   // an older snapshot without `real`
});
