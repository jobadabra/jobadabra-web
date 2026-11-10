// The "Jobs in the right place" card of the nightly Search check (owner, 10 Nov 2026: "How can I follow to understand if our search algoritm finds jobs out of the location"; a Dublin search listed 24 of 25 jobs in other countries
// and no screen said so). Guard for the counts in clean() (a count set that does not add up to the jobs found claims nothing, never zeros) and for admin/search-night-place.js: worst candidate first, only the judge's
// "yes" is right (remote, unsure and not-judged are named apart), a night without counts is a gap in the line, and a tab with no counts at all is as before.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {placeOf, placeSection, placeWords, ranked, totalOf} from '../../../../admin/search-night-place.js';
import {nightSection} from '../../../../admin/search-night-page.js';

const NOW = new Date('2026-11-21T00:00:00Z');   // a fixed clock: clean() refuses a night in the future
const counts = (yes, no, remote = 0, unknown = 0, unjudged = 0) => ({yes, no, remote, unknown, unjudged});
const row = (persona, label, found, place, role) => ({persona, label, kind: 'measured', local: 1, found, seconds: 80, place, role});
const night = (day, rows) => clean({state: 'success', head: `measured ${rows.length} of ${rows.length}`, rows}, {night: day}, NOW);
const DUBLIN = row(1, 'p1 Social Worker, Dublin', 25, counts(1, 24), {yes: 20, no: 5, unjudged: 0});
const LYON = row(2, 'p2 Nurse, Lyon', 10, counts(9, 1), {yes: 10, no: 0, unjudged: 0});

test('clean() keeps the place and role counts only when they add up to the jobs found: otherwise nothing is claimed, never zeros', () => {
  const [dublin, lyon] = night('2026-11-20', [DUBLIN, LYON]).rows;
  assert.deepEqual(dublin.place, counts(1, 24));
  assert.deepEqual(lyon.role, {yes: 10, no: 0, unjudged: 0});
  const odd = night('2026-11-20', [row(1, 'a', 10, counts(1, 1), null), row(2, 'b', 10, {yes: -1, no: 11, remote: 0, unknown: 0, unjudged: 0}, {yes: 10, no: 1, unjudged: 0}), row(3, 'c', 10, 'many', undefined), row(4, 'd', 10, {yes: 3.5, no: 6.5, remote: 0, unknown: 0, unjudged: 0})]);
  for (const kept of odd.rows) assert.equal(kept.place, null, `${kept.label}: counts that do not add up to the jobs found, a negative or fractional count, or a word are not stored`);
  assert.equal(odd.rows[1].role, null, 'the role counts add up to 11 of 10 jobs');
  assert.equal(night('2026-11-20', [{persona: 1, label: 'older record', kind: 'measured', found: 10}]).rows[0].place, null, 'a record from before the counts carries none');
});

test('placeOf: only the judge\'s yes is right; remote, unsure and not-judged jobs are named apart; a candidate with nothing judged has no share', () => {
  const place = placeOf(night('2026-11-20', [row(1, 'x', 12, counts(6, 2, 1, 2, 1), {yes: 9, no: 2, unjudged: 1})]).rows[0]);
  assert.deepEqual([place.yes, place.listed, place.other, place.remote, place.unsure, place.unjudged, place.wrongRole], [6, 12, 2, 1, 2, 1, 2]);
  assert.equal(place.share, 0.5, 'remote and unsure jobs do not count as in the right place');
  assert.equal(placeWords(place), '6 of 12 listed jobs in the right place');
  assert.equal(placeOf(night('2026-11-20', [row(1, 'y', 4, counts(0, 0, 0, 0, 4), null)]).rows[0]), null, 'four jobs and none judged: no share, never 0 of 4 as if judged wrong');
});

test('ranked and totalOf: the worst candidate first, ties by the bigger miss; the line adds every candidate up', () => {
  const last = night('2026-11-20', [LYON, DUBLIN, row(3, 'p3 Chef, Madrid', 20, counts(1, 19), null), row(4, 'p4 no counts', 5, null, null)]);
  assert.deepEqual(ranked(last).map(item => item.row.label), ['p1 Social Worker, Dublin', 'p3 Chef, Madrid', 'p2 Nurse, Lyon'], '1 of 25 (4%) is worse than 1 of 20 (5%): the lowest share is first, a candidate with no counts is left out');
  assert.deepEqual(totalOf(last), {yes: 11, listed: 55, share: 0.2, people: 3});
  assert.equal(totalOf(night('2026-11-20', [row(1, 'z', 3, null, null)])), null);
});

test('the card names the Dublin miss in words, worst first, and draws the line with a gap for a night without counts', () => {
  const nights = judgeAll([night('2026-11-20', [LYON, DUBLIN]), night('2026-11-19', [{persona: 1, label: 'older', kind: 'measured', found: 5}]), night('2026-11-18', [LYON, DUBLIN])]);
  const html = placeSection(nights);
  assert.ok(html.includes('1 of 25 listed jobs in the right place'), 'the owner\'s Dublin case reads in words');
  assert.ok(html.indexOf('Dublin') < html.indexOf('Lyon'), 'the worse candidate is listed first');
  assert.ok(html.includes('24 in another place') && html.includes('5 wrong role'));
  assert.ok(html.includes('2026-11-19 · no place counts on this night'), 'a stored night without counts is a gap in the line, not a 0');
  assert.equal(placeSection(judgeAll([night('2026-11-20', [row(1, 'a', 5, null, null)])])), '', 'no night carries counts: the tab is as before');
  assert.ok(nightSection(nights).includes('id="night-place"'), 'the card is on the Night search tab');
  assert.ok(!nightSection(judgeAll([night('2026-11-20', [row(1, 'a', 5, null, null)])])).includes('night-place'));
});
