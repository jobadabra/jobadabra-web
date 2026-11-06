// The nightly Search check's per-step counters (owner, 6 Nov 2026: "go ahead. Fix the search"; brief step 2): per persona, employer sites read, EU portal (EURES) jobs OUR read listed, titles asked,
// AI calls and the seconds to the first job, each against its own median of the last 7 nights of the same persona count; a drop beyond the sample's own spread is one line in the night's head
// ("EU jobs: p10 200 → 0"), report only: it never makes a night `dropped` and never alerts. Guard for admin/search-night-counters.js, the counters in clean() and judgeNight(), and the tab's counter line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {judgeAll, judgeNight} from '../../../../admin/search-night-judge.js';
import {COUNTERS, counterNotes} from '../../../../admin/search-night-counters.js';
import {nightSection} from '../../../../admin/search-night-page.js';

const day = back => new Date(Date.UTC(2026, 10, 20 - back)).toISOString().slice(0, 10);
const flat = {eu: 140, sites: 12, titles: 30, ai: 8, firstS: 60};
// A stored night of 3 personas; `counters(i)` gives persona i's counters (null = the press wrote no numbers).
const night = (back, counters = () => flat) => ({night: day(back), run: null, state: 'success', head: 'measured 3 of 3', rows: [1, 2, 3].map(i => ({persona: i, label: `p${i} Role, City`, kind: 'measured', why: '', local: 3, found: 9, seconds: 100, ranOut: [], counters: counters(i)}))});
// Seven earlier nights whose counters wobble a little (a spread), newest first.
const wobble = (k, i) => ({eu: 140 + (k % 3) * 4 + i, sites: 12 + (k % 2), titles: 30 + (k % 3), ai: 8 + (k % 2), firstS: 60 + (k % 4) * 3});
const history = Array.from({length: 7}, (_, k) => night(k + 1, i => wobble(k, i)));

test('clean() keeps the five counters as whole numbers or null, and no row text: a bad value is null, a missing object is null', () => {
  const stored = clean({state: 'success', head: 'h', rows: [{persona: 1, label: 'p1', kind: 'measured', counters: {eu: 146, sites: 0, titles: '29', ai: -1, firstS: null, extra: 'a company name'}}, {persona: 2, label: 'p2', kind: 'measured'}]}, {night: day(0)}, new Date(Date.UTC(2026, 10, 21)));
  assert.deepEqual(stored.rows[0].counters, {eu: 146, sites: 0, titles: null, ai: null, firstS: null});
  assert.equal(stored.rows[1].counters, null, 'no counters object: nothing is claimed, no zeros');
  assert.deepEqual(COUNTERS.map(item => item.key), ['eu', 'sites', 'titles', 'ai', 'firstS']);
});

test('a flat night reads clean: no drop, each persona carries its own usual for each counter', () => {
  const judged = judgeNight(night(0, i => wobble(0, i)), history);
  assert.deepEqual(judged.notes, []);
  assert.deepEqual(judged.rows[0].drops, []);
  assert.equal(typeof judged.rows[0].counterUsual.eu, 'number');
});

test('a counter that drops beyond its own spread is one line in the head: "EU jobs: p2 140 → 0" (the usual is the median of that persona\'s own nights)', () => {
  const judged = judgeNight(night(0, i => (i === 2 ? {...wobble(0, i), eu: 0} : wobble(0, i))), history);
  assert.equal(judged.notes.length, 1);
  assert.match(judged.notes[0], /^EU jobs: p2 \d+ → 0$/);
  assert.deepEqual(judged.rows[1].drops, ['eu']);
  assert.deepEqual(judged.rows[0].drops, [], 'the other personas are not blamed');
});

test('report only: a counter drop never makes the night dropped and never adds a reason', () => {
  const judged = judgeNight(night(0, () => ({eu: 0, sites: 0, titles: 0, ai: 0, firstS: null})), history);
  assert.equal(judged.dropped, false);
  assert.deepEqual(judged.reasons, []);
  assert.ok(judged.notes.length >= 4, 'the lines are still there');
});

test('identical earlier nights do not make a hair trigger: a drop of 1 is silent, a real fall is not (a count\'s own noise is at least its square root)', () => {
  const same = Array.from({length: 7}, (_, k) => night(k + 1, () => flat));
  assert.deepEqual(judgeNight(night(0, () => ({eu: 139, sites: 11, titles: 29, ai: 7, firstS: 61})), same).notes, []);
  assert.match(judgeNight(night(0, () => ({...flat, eu: 100})), same).notes.join(' '), /EU jobs: p1 140 → 100/);
});

test('the first week is silent: fewer than 7 earlier nights, or a median of 0 (no line below it), or a press with no numbers, say nothing', () => {
  assert.deepEqual(judgeNight(night(0, () => ({...flat, eu: 0})), history.slice(0, 6)).notes, []);
  const zeros = Array.from({length: 7}, (_, k) => night(k + 1, () => ({...flat, eu: 0})));
  assert.deepEqual(judgeNight(night(0, () => ({...flat, eu: 0})), zeros).notes, []);
  assert.deepEqual(judgeNight(night(0, () => null), history).notes, [], 'a press that wrote no numbers is the "not measured" row, not a counter drop');
});

test('the first job is the one counter where higher is worse: slower beyond the spread, or no job at all, is a drop', () => {
  const slow = judgeNight(night(0, i => ({...wobble(0, i), firstS: 170})), history);
  assert.match(slow.notes.join(' | '), /First job: p1 \d+ s → 170 s/);
  const none = judgeNight(night(0, i => ({...wobble(0, i), firstS: null})), history);
  assert.match(none.notes.join(' | '), /First job: p1 \d+ s → none/);
  assert.deepEqual(judgeNight(night(0, i => ({...wobble(0, i), firstS: 55})), history).notes, [], 'faster is not a drop');
});

test('a night is only compared with earlier nights of the same persona count', () => {
  const six = Array.from({length: 7}, (_, k) => ({...night(k + 1), rows: [1, 2, 3, 4, 5, 6].map(i => ({...night(1).rows[0], persona: i}))}));
  assert.deepEqual(judgeNight(night(0, () => ({...flat, eu: 0})), six).notes, []);
});

test('counterNotes caps the personas named per line and says how many more', () => {
  const rows = Array.from({length: 6}, (_, i) => ({label: `p${i + 1} X, Y`, drops: ['eu'], counters: {eu: 0}, counterUsual: {eu: 100}}));
  assert.deepEqual(counterNotes(rows), ['EU jobs: p1 100 → 0, p2 100 → 0, p3 100 → 0 (+3 more)']);
});

test('the tab: each persona shows its counters beside "N of X on EURES"; a dropped one is marked with its usual; the head carries the line; an older night without counters shows none', () => {
  const judged = judgeAll([night(0, i => (i === 2 ? {...wobble(0, i), eu: 0} : wobble(0, i))), ...history]);
  const html = nightSection(judged, {2: {total: 19, reachable: 19, eures: 19, google: null}});
  const cell = html.match(/<b>p2 Role, City<\/b>.*?<\/tr>/s)[0];
  assert.match(cell, /3 of 19 on EURES/);
  assert.match(cell, /EU read[^<]*0/, 'our EU read listed 0');
  assert.match(cell, /usual \d+/, 'the dropped counter names its usual');
  assert.match(html.match(/<p class="vb-chips">.*?<\/p>/s)[0], /EU jobs: p2 \d+ → 0/);
  const line = persona => html.match(new RegExp(`<b>p${persona} Role, City</b>.*?(<div class="why">(?:<[^>]*>)?EU read.*?</div>)`, 's'))[1];   // the persona's own counter line (the cell also holds the local jobs' usual)
  assert.doesNotMatch(line(1), /usual|chip/, 'no mark on a flat persona');
  assert.match(line(2), /usual \d+/, 'the control: the dropped persona\'s line does carry its usual, so the check above can fail');
  const old = nightSection(judgeAll([{...night(0), rows: night(0).rows.map(row => ({...row, counters: undefined}))}]), {});
  assert.doesNotMatch(old, /EU read|NaN|undefined/);
});

test('the help text says what each counter is, in one place, so the tab does not need a second glossary', () => {
  const html = nightSection(judgeAll([night(0), ...history]), {});
  for (const item of COUNTERS) assert.ok(html.includes(item.long), `the explanation names ${item.long}`);
});
