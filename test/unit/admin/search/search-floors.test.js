// Floors that only rise (cr G2, 10 Nov 2026; sa: "the card draws them and computes nothing"). Guard for admin/search-floors.js (the kept shape) and admin/search-floors-page.js (the card), mounted in the Finish line tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {cleanFloors, cleanMeasure} from '../../../../admin/search-floors.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {finishSection} from '../../../../admin/search-finish-page.js';

const NOW = new Date('2026-11-19T09:00:00Z');
const row = persona => ({persona, label: `p${persona} Role, Place`, kind: 'measured', why: '', local: 3, found: 9, seconds: 100});
const night = (day, extra) => clean({state: 'success', head: 'measured', rows: [row(1), row(2), row(3)], ...extra}, {night: day}, NOW);
const checked = {checked: true, series: 'abc123abc123|codex-gpt-6-luna|eures-on|off', last_green: {run: '42897000000', sha: '83bf4626aabbccdd'},
  merges: ['Fix the place judge (#3701)', 'Raise the read cap (#3709)'],
  red: [{persona: 3, number: 'right', floor: 4, now: 0, spread: 1, below: 2}],
  levels: {1: {right: {floor: 4, now: 5, spread: 1, below: 0}, first_s: {floor: 60, now: 48, spread: 5, below: 0}}, 3: {right: {floor: 4, now: 0, spread: 1, below: 2}, eures_inout: {floor: null, now: 0.5, spread: null, below: 0}}}};

test('the fields are kept in fixed shape: a 12-hex measure, the not-checked word, red rows and levels with known numbers only', () => {
  assert.equal(cleanMeasure('0123456789ab'), '0123456789ab');
  assert.deepEqual([cleanMeasure('xyz'), cleanMeasure(5), cleanMeasure(null)], [null, null, null]);
  assert.deepEqual(cleanFloors({checked: false, why: 'not run: no AI answered'}), {checked: false, why: 'not run: no AI answered'});
  assert.equal(cleanFloors({red: []}), null, 'neither checked true nor false: nothing is claimed');
  const kept = cleanFloors({...checked, red: [...checked.red, {persona: 9, number: 'salary', floor: 1}, {persona: 'x', number: 'right'}], levels: {...checked.levels, abc: {right: {}}, 4: {mystery: {floor: 1}}}});
  assert.equal(kept.red.length, 1, 'an unknown number or persona is dropped');
  assert.deepEqual(Object.keys(kept.levels), ['1', '3', '4']);
  assert.deepEqual(kept.levels[4], {}, 'an unknown number name is dropped');
  assert.deepEqual(kept.levels[3].eures_inout, {floor: null, now: 0.5, spread: null, below: 0}, 'a floor not set yet stays null, never 0');
  assert.deepEqual(kept.last_green, {run: '42897000000', sha: '83bf4626aabbccdd'});
  const many = cleanFloors({checked: true, merges: Array.from({length: 40}, (_, i) => `merge ${i}\nline`)}).merges;
  assert.deepEqual([many.length, many[0], many.at(-1)], [10, 'merge 30 line', 'merge 39 line'], 'the newest 10 are kept, one line each');
  assert.equal(cleanFloors({checked: true, red: Array.from({length: 60}, () => ({persona: 1, number: 'right'}))}).red.length, 54, '3 numbers x 18 people can all be red, no more');
});

test('the night keeps both fields; an old verdict without them keeps null', () => {
  const stored = night('2026-11-18', {measure: 'abc123abc123', floors: checked});
  assert.deepEqual([stored.measure, stored.floors.red[0].persona], ['abc123abc123', 3]);
  assert.deepEqual([night('2026-11-17').measure, night('2026-11-17').floors], [null, null]);
});

test('the card: nothing sent says so, not checked says why and is never red, checked draws cr\'s red row in cr\'s words', () => {
  const draw = nights => finishSection(judgeAll(nights), []);
  assert.match(draw([night('2026-11-18')]), /id="finish-floors"[\s\S]*not sent yet/);
  const off = draw([night('2026-11-18', {floors: {checked: false, why: 'state unreadable: HTTP 500'}})]);
  assert.match(off, /floors: not checked \(state unreadable: HTTP 500\)/);
  assert.ok(!/under the floor/.test(off), 'not checked is never red');
  const red = draw([night('2026-11-18', {measure: 'abc123abc123', floors: checked})]);
  assert.match(red, /1 under the floor/);
  assert.match(red, /<b>p3<\/b> Role, Place · right jobs 0, floor 4 · 2nd night under/);
  assert.match(red, /Merges since the last green: Fix the place judge \(#3701\); Raise the read cap \(#3709\)/);
  assert.match(red, /last green run 42897000000 \(83bf462\)/);
  assert.match(red, /measure abc123abc123/);
  assert.match(red, /no floor yet/, 'a number with no floor yet says so in the table');
  assert.match(draw([night('2026-11-18', {floors: {...checked, red: []}})]), /all above their floors/);
});

test('seconds to first job reads as a ceiling, and a hostile merge subject is escaped', () => {
  const html = finishSection(judgeAll([night('2026-11-18', {floors: {...checked, merges: ['<img src=x onerror=1>'], red: [{persona: 1, number: 'first_s', floor: 60, now: 95, spread: 5, below: 2}, {persona: 2, number: 'eures_inout', floor: 0.9, now: 0.5, spread: 0.05, below: 2}]}})]), []);
  assert.match(html, /seconds to first job 95, ceiling 60/);
  assert.match(html, /EURES in = out share 50%, floor 90%/, 'a share is a fraction 0-1, drawn as a percent');
  assert.ok(!/<img src=x/.test(html));
});
