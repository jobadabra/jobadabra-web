// The round pickers of /admin/job-search/benchmark and /admin/form-filling/benchmark (owner, 13 Nov 2026: "it preselected the oldest", "too many chips", "a date picker, but not chips"):
// real rounds (plain dates) in one date dropdown with the newest preselected, side checks (any suffix) in a second one, none preselected. Guard for admin/benchmark-rounds.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isRealRound, roundChoices, roundPicker} from '../../../../admin/benchmark-rounds.js';
import {page} from '../../../../admin/benchmark-search-page.js';
import {page as formPage} from '../../../../admin/benchmark-page.js';

const KEYS = ['2026-11-12', '2026-11-13', '2026-11-13-sonnet-1', '2026-11-13-diag-1'];
const round = ai => ({ai, tools: [{tool: 'Ours', ours: true, relevant: 1, relevantShare: 50, found: 2, personas: 1, empty: 0, place: 1, role: 1, employers: 1, avgSeconds: 5, cents: 0}], personas: [], grid: {}, kinds: {}, missed: [], beyond: []});
const snapshot = {at: '2026-11-13T10:00:00Z', rounds: Object.fromEntries(KEYS.map(key => [key, round('haiku')]))};

test('only a plain date is a real round; any suffix makes it a side check', () => {
  assert.deepEqual(KEYS.map(isRealRound), [true, true, false, false]);
  assert.equal(isRealRound('2026-11-13-full'), false);
  assert.equal(isRealRound('r1'), false);
});

test('the newest real round is preselected, not the newest key; side checks are listed apart, newest first', () => {
  const c = roundChoices(KEYS);
  assert.equal(c.current, '2026-11-13');
  assert.deepEqual(c.real, ['2026-11-13', '2026-11-12']);
  assert.deepEqual(c.side, ['2026-11-13-sonnet-1', '2026-11-13-diag-1']);
});

test('?round= of a side check still opens it; an unknown one falls back to the newest real round; no real round falls back to the newest key', () => {
  assert.equal(roundChoices(KEYS, '2026-11-13-sonnet-1').current, '2026-11-13-sonnet-1');
  assert.equal(roundChoices(KEYS, 'nope').current, '2026-11-13');
  assert.equal(roundChoices(['r1', 'r2']).current, 'r2');
  assert.equal(roundChoices([]).current, null);
});

test('the search page shows two dropdowns (no round chips), preselects 2026-11-13 and marks the public round', () => {
  const html = page(snapshot, {published: {search: {now: {round: '2026-11-12', published_at: '2026-11-12T09:00:00Z'}, before: null}, form: {now: null, before: null}}});
  assert.match(html, /round 2026-11-13</);
  assert.match(html, /<option value="2026-11-13" selected>/);
  assert.match(html, /<option value="2026-11-12">[^<]*public/);
  assert.match(html, /Side checks \(2\)/);
  assert.doesNotMatch(html, /class="filter[ "]/, 'no chip per round');
  assert.doesNotMatch(html, /<option value="2026-11-13-sonnet-1" selected>/);
  assert.match(page(snapshot, {round: '2026-11-13-sonnet-1'}), /round 2026-11-13-sonnet-1</);
  assert.match(page(snapshot, {round: '2026-11-13-sonnet-1'}), /<option value="2026-11-13-sonnet-1" selected>/);
});

test('the picker escapes keys and is one form per dropdown, so ?round= stays the link', () => {
  const html = roundPicker({real: [['a"b', 'a"b'], ['c', 'c']], side: [], current: 'a"b'});
  assert.match(html, /<form method="get"/);
  assert.match(html, /name="round"/);
  assert.doesNotMatch(html, /a"b/);
});

test('form filling: the same dropdown, the fixed set first and selected, weeks after it', () => {
  const fair = {rounds: {fixed: {at: '2026-11-01', forms: [], tools: [], grid: {}, builds: []}, 'week-2026-W46': {at: '2026-11-10', forms: [], tools: [], grid: {}, builds: []}}};
  const html = formPage({segments: {}, fair, at: '2026-11-13T10:00:00Z'});
  assert.match(html, /<option value="fixed" selected>/);
  assert.match(html, /<option value="week-2026-W46">New set, week 2026-W46/);
  assert.doesNotMatch(html, /<a href="\?round=/);
});
