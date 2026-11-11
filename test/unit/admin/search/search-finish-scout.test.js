// The Central Scout's card on the Finish line tab (owner, 11 Nov 2026, to sa: "How much the Central Scout is helping us? Do we measure this ?"): the four classes of the list's employers per person, the gap share = no kind counted /
// (in places - empty feeds) with the empty feeds kept apart (lab issue #87: 363 of them in every person's places read as a gap and gave 72-94% instead of 17-40%), a record that does not add up claims nothing, a missing count reads
// "not sent" never 0. Guard for admin/search-finish-scout.js, its clean step in search-night.js and its place on the tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanScout, gapOf, scoutCard, scoutOf} from '../../../../admin/search-finish-scout.js';
import {finishSection} from '../../../../admin/search-finish-page.js';
import {clean} from '../../../../admin/search-night.js';

const raw = (extra = {}) => ({in_places: 500, empty_feeds: 363, no_kind_mix: 30, mix_only: 100, counted_per_country: 7, for_role: 4, fit_their_kind: 12, kind_not_theirs: 95, kinds_known: true, listed_from_list: 5, right_from_list: 2, employers_right_from_list: 1, ...extra});
const row = (persona, scout, kind = 'measured') => ({persona, label: `p${persona} Role, Place`, kind, scout: scout === undefined ? cleanScout(raw()) : scout});
const run = (rows, extra = {}) => ({night: '2026-11-12', hand: false, rows, ...extra});

test('the gap keeps the empty feeds apart: 30 of 137 employers with open jobs, not 393 of 500', () => {
  const scout = cleanScout(raw());
  assert.equal(gapOf(scout), 30 / 137);
  assert.notEqual(Math.round(gapOf(scout) * 100), Math.round((393 / 500) * 100), 'the first reading counted the 363 empty feeds as a gap');
  assert.equal(gapOf(null), null);
  assert.equal(gapOf(cleanScout(raw({in_places: 363, empty_feeds: 363, no_kind_mix: 0, mix_only: 0, counted_per_country: 0}))), null, 'no employer with open jobs: no share, never 0%');
});

test('a record whose classes do not add up to the employers in places claims nothing; a count that is not whole is null', () => {
  assert.equal(cleanScout(raw({mix_only: 99})), null);
  assert.equal(cleanScout(raw({in_places: '500'})), null);
  assert.equal(cleanScout(raw({counted_per_country: -1})), null);
  assert.equal(cleanScout(null), null);
  assert.equal(cleanScout([1]), null);
  assert.equal(cleanScout(raw({right_from_list: 1.5})).right, null, 'an odd count beside a good record is "not sent", not a zero');
});

test('an undecided kind keeps the four classes and leaves what needs the kind null', () => {
  const scout = cleanScout(raw({kinds_known: false}));
  assert.deepEqual([scout.noKind, scout.mixOnly, scout.counted, scout.empty], [30, 100, 7, 363]);
  assert.deepEqual([scout.forRole, scout.fits, scout.notTheirs], [null, null, null]);
  assert.match(scoutCard([run([row(1, scout)])]), /kind not decided/);
});

test('the night clean step keeps `scout` per row, whole and checked, and null when a row sent none', () => {
  const verdict = {state: 'success', head: '', rows: [{persona: 1, label: 'p1 A', kind: 'measured', scout: raw()}, {persona: 2, label: 'p2 B', kind: 'measured'}]};
  const saved = clean(verdict, {night: '2026-11-12'}, new Date('2026-11-12T12:00:00Z'));
  assert.equal(saved.rows[0].scout.noKind, 30);
  assert.equal(saved.rows[1].scout, null);
});

test('no night with the list counts is an empty state with the chip, never bars or a 0%', () => {
  for (const runs of [[], [run([row(1, null)])]]) {
    const html = scoutCard(runs);
    assert.match(html, /id="finish-scout"/);
    assert.match(html, /No night has sent the list's counts yet/);
    assert.doesNotMatch(html, /sc-bar/);
    assert.doesNotMatch(html, /0%/);
  }
});

test('the card draws one bar per person, the median gap over the measured people, blind people as not measured and a person with none as not sent', () => {
  const rows = [row(1), row(2, cleanScout(raw({no_kind_mix: 60, mix_only: 70}))), row(3, undefined, 'unmeasured'), row(4, null)];
  const view = scoutOf(run(rows));
  assert.equal(view.measured, 2);
  assert.equal(view.median, (30 / 137 + 60 / 137) / 2);
  const html = scoutCard([run(rows)]);
  assert.equal((html.match(/class="sc-row"/g) || []).length, 4);
  assert.match(html, /not measured/);
  assert.match(html, /not sent/);
  assert.match(html, /of the employers with open jobs in a person's places have no counted kind/);
  assert.match(html, /33%/, 'the median over 22% and 44%: (30+60)/2/137');
});

test('the card is on the Finish line tab', () => {
  const html = finishSection([run([row(1)], {state: 'success', head: ''})]);
  assert.match(html, /id="finish-scout"/);
});
