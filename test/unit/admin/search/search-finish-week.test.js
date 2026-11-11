// The week's card on the Finish line tab (owner, 11 Nov 2026, picture approved via AskUserQuestion: "Yes, build it"; words: "each of the runs should provide new jobs"): new right jobs per run 1..5, a zero reads as zero,
// a missing week is an empty state (never a flat line), a count that was not sent reads "not sent" (never 0), "runs to the line" stays "not defined yet". Guard for admin/search-finish-week.js and its place in finishSection.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {weekCard} from '../../../../admin/search-finish-week.js';
import {finishSection} from '../../../../admin/search-finish-page.js';

const runs = adds => { let after = 0; return adds.map((n, k) => ({run: k + 1, newListed: n, newRight: n, rightAfter: n == null ? null : (after += n), seconds: 60})); };
const person = (persona, adds, kind = 'measured') => ({persona, label: `p${persona} Role, Place`, kind, runs: runs(adds)});
const week = {week: '2026-11-12', byHand: false, byRun: [{run: 1, measured: 2, peopleNew: 2, newRight: 7}, {run: 2, measured: 2, peopleNew: 1, newRight: 2}, {run: 3, measured: 2, peopleNew: 0, newRight: 0}, {run: 4, measured: 2, peopleNew: null, newRight: null}, {run: 5, measured: 2, peopleNew: 0, newRight: 0}],
  rows: [person(1, [4, 2, 0, 0, 0]), person(2, [3, 0, 0, null, 0]), person(3, [0, 0, 0, 0, 0], 'unmeasured')]};

test('no week yet is an empty state with the chip, never a chart; a week without its per-run counts says so', () => {
  const none = weekCard(null);
  assert.match(none, /id="finish-week"/);
  assert.match(none, /No week yet/);
  assert.doesNotMatch(none, /<svg/);
  assert.match(weekCard({week: '2026-11-12', rows: [], byRun: null}), /was sent without its per-run counts/);
});

test('a week draws runs 1..5 on one axis from a baseline of 0: a zero is a labelled run of no height, a run not sent is a hollow dashed column, never a zero', () => {
  const html = weekCard(week);
  for (const n of [1, 2, 3, 4, 5]) assert.match(html, new RegExp(`>Run ${n}</text>`), `run ${n} is on the axis`);
  assert.match(html, /class="vz-axis">7<\/text>/, 'run 1 is labelled 7');
  assert.equal((html.match(/class="vz-axis">0<\/text>/g) || []).length, 3, 'the axis 0 and the two measured zeros (runs 3 and 5) read as 0');
  assert.match(html, /stroke-dasharray="2 2"/, 'run 4 was not sent: hollow');
  assert.match(html, /Run 4 · new right jobs not sent/);
  assert.match(html, /runs to the line: not defined yet/);
});

test('the table says what the week measured: people with at least one new right job, new right jobs, right jobs after the run over the measured people; a person not measured is out of it and a missing count reads "not sent"', () => {
  const html = weekCard(week), table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'));
  assert.match(table, /Run 1<\/td><td class="num"><b>2<\/b><\/td><td class="num"><b>2<\/b><\/td><td class="num"><b>7<\/b><\/td><td class="num"><b>7<\/b><\/td>/, 'run 1: 7 right after (4 + 3)');
  assert.match(table, /Run 2<\/td>.*?<b>2<\/b><\/td><td class="num"><b>9<\/b><\/td>/, 'run 2: 9 right after');
  assert.match(table, /Run 4<\/td><td class="num"><b>2<\/b><\/td><td class="num"><span class="chip off">not sent<\/span><\/td><td class="num"><span class="chip off">not sent<\/span><\/td><td class="num"><span class="chip off">not sent<\/span>/, 'run 4: nothing sent for p2, so nothing is summed');
  const fold = html.slice(html.indexOf('<details>'));
  assert.match(fold, /p3<\/b> Role, Place<\/td><td class="num"><span class="chip off">not measured<\/span>/, 'an unmeasured person reads not measured in the fold');
});

test('the tab shows the card after the nights chart, and an unreadable or empty week leaves the rest of the tab alone', () => {
  assert.match(finishSection([], [], {}, week), /id="finish-week"/);
  assert.match(finishSection([], [], {}, null), /No week yet/);
  assert.match(finishSection([], [], {}), /No week yet/, 'a caller that passes no week still gets the empty state');
});
