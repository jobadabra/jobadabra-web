// The round pickers of /admin/job-search/benchmark and /admin/form-filling/benchmark (owner, 13 Nov 2026: "it preselected the oldest", "too many chips", "a date picker, but not chips"; then "I don't understand why I don't see the latest round
// in this dropdown", answered "Full rounds by date + time (Recommended)"): "Round" lists every FULL round (a rival's rows for the widest set of people) by its own date and time, newest first and preselected; every other round is a test run in
// a second dropdown, "Test runs by sessions". What a round is comes from its data, never its key. Guard for admin/benchmark-rounds.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clockOf, isFullRound, roundChoices, roundPicker} from '../../../../admin/benchmark-rounds.js';
import {summarize} from '../../../../admin/benchmark-search-data.js';
import {page} from '../../../../admin/benchmark-search-page.js';
import {page as formPage} from '../../../../admin/benchmark-page.js';

const tool = (name, ours) => ({tool: name, ours, relevant: 1, relevantShare: 50, found: 2, personas: 1, empty: 0, place: 1, role: 1, employers: 1, avgSeconds: 5, cents: 0});
const people = n => Array.from({length: n}, (_, i) => ({persona: `p${i + 1}`, kind: 'tech', country: 'DE'}));
/** A round as the snapshot holds it: `at` = its newest row's time, n people, ours alone or with a rival. */
const round = (at, n, rivals, ai = 'haiku') => ({at, ai, tools: [tool('Ours', true), ...(rivals ? [tool('JobSpy', false)] : [])], personas: people(n), grid: {}, kinds: {}, missed: [], beyond: []});
// The owner's 13 Nov 2026 scenario, from the live rounds: a full round at 04:14 under a plain date, a SECOND full round the same day under a suffix at 17:16, an older full round under another suffix, and test runs of every size.
const ROUNDS = {
  '2026-11-12': round('2026-11-12T20:03:52.865Z', 10, true),
  '2026-11-12-full': round('2026-11-12T23:51:07.417Z', 10, true),
  '2026-11-13': round('2026-11-13T04:14:00.512Z', 10, true),
  '2026-11-13-evening': round('2026-11-13T17:16:53.171Z', 10, true, 'app'),
  '2026-11-13-ours-fixes': round('2026-11-13T13:15:32.794Z', 10, false),
  '2026-11-13-sonnet-1': round('2026-11-13T01:07:03.262Z', 4, false),
  '2026-11-13-diag-1': round('2026-11-13T00:49:21.820Z', 2, false),
};
const snapshot = {at: '2026-11-13T18:00:00Z', rounds: ROUNDS};
const PUBLISHED = {search: {now: {round: '2026-11-13', published_at: '2026-11-13T05:00:00Z'}, before: null}, form: {now: null, before: null}};

test('a full round is told by its data: a rival\'s rows for the widest set of people, whatever its key is called', () => {
  const full = Object.keys(ROUNDS).filter(key => roundChoices(ROUNDS).real.includes(key));
  assert.deepEqual(full.sort(), ['2026-11-12', '2026-11-12-full', '2026-11-13', '2026-11-13-evening']);
  assert.equal(isFullRound(ROUNDS['2026-11-13-ours-fixes'], 10), false, 'ours alone on 10 people is a test run');
  assert.equal(isFullRound(round('2026-11-13T02:00:00Z', 3, true), 10), false, 'a rival on 3 people is a test run');
  assert.equal(isFullRound(undefined, 0), false);
});

test('Round lists every full round newest first by its own time, including the second full round of one day; test runs go apart, newest first', () => {
  const c = roundChoices(ROUNDS);
  assert.deepEqual(c.real, ['2026-11-13-evening', '2026-11-13', '2026-11-12-full', '2026-11-12']);
  assert.deepEqual(c.side, ['2026-11-13-ours-fixes', '2026-11-13-sonnet-1', '2026-11-13-diag-1']);
  assert.equal(c.current, '2026-11-13-evening', 'the page opens on the newest full round');
  assert.equal(clockOf('2026-11-13-evening', ROUNDS['2026-11-13-evening']), '2026-11-13 17:16 UTC');
});

test('?round= of a test run still opens it; an unknown one falls back to the newest full round; with no full round, the newest key', () => {
  assert.equal(roundChoices(ROUNDS, '2026-11-13-sonnet-1').current, '2026-11-13-sonnet-1');
  assert.equal(roundChoices(ROUNDS, 'nope').current, '2026-11-13-evening');
  assert.equal(roundChoices({r1: round('2026-11-01T00:00:00Z', 2, false), r2: round('2026-11-02T00:00:00Z', 2, false)}).current, 'r2');
  assert.equal(roundChoices({}).current, null);
  assert.equal(roundChoices(undefined).current, null);
});

test('a snapshot built before rounds carried their time still lists them (by key) and never throws', () => {
  const old = Object.fromEntries(Object.entries(ROUNDS).map(([key, view]) => [key, {...view, at: undefined}]));
  assert.equal(roundChoices(old).current, '2026-11-13-evening', 'the key order is the fallback: the same newest round here');
  assert.equal(clockOf('2026-11-13', old['2026-11-13']), '2026-11-13');
});

test('the search page opens on the evening round, lists both full rounds with their time, keeps "public" on the published one, and names the test runs plainly', () => {
  const html = page(snapshot, {published: PUBLISHED});
  assert.match(html, /round 2026-11-13-evening</);
  assert.match(html, /<option value="2026-11-13-evening" selected>2026-11-13 17:16 UTC · App tiers<\/option>/);
  assert.match(html, /<option value="2026-11-13">2026-11-13 04:14 UTC · Haiku · public<\/option>/);
  assert.match(html, /Test runs by sessions \(3\)/);
  assert.match(html, /<option value="2026-11-13-sonnet-1">2026-11-13 01:07 UTC · ours only · 4 people · Haiku · 2026-11-13-sonnet-1<\/option>/);
  assert.doesNotMatch(html, /Side checks/);
  assert.doesNotMatch(html, /class="filter[ "]/, 'no chip per round');
  assert.doesNotMatch(html, /<option value="2026-11-13-sonnet-1" selected>/);
  assert.match(page(snapshot, {round: '2026-11-13-sonnet-1'}), /<option value="2026-11-13-sonnet-1" selected>/);
});

test('every round of the snapshot carries its newest row\'s time, the one the lists sort and label by', () => {
  const row = (round, tool, at) => ({id: `${round}/p1/${tool}`, at, round, persona: 'p1', kind: 'tech', country: 'DE', tool, ours: tool === 'Ours' ? 1 : 0, build: '', found: 1, place: 1, role: 1, relevant: 1, employers: 1, seconds: 60, cents: 0});
  const {rounds} = summarize([row('r', 'Ours', '2026-11-13T17:16:53.163Z'), row('r', 'JobSpy', '2026-11-13T17:16:53.171Z'), row('s', 'Ours', '2026-11-12T01:00:00.000Z')]);
  assert.deepEqual([rounds.r.at, rounds.s.at], ['2026-11-13T17:16:53.171Z', '2026-11-12T01:00:00.000Z']);
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
