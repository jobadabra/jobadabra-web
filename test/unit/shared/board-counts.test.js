// shared/board-counts.js: the central scout's published boards counted per role family × country, the daily snapshot, the 18 test profiles' cells.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PROFILE_CELLS, SCOUT_BOARD_PREFIX, countsOf, dayCounts, gatherBoards, storeBoardCounts} from '../../../shared/board-counts.js';
import {SCOUT_BOARD_PREFIX as API_PREFIX} from '../../../api/employers.js';
import {COUNTRIES, FAMILIES} from '../../../shared/pool-tags.js';

const rows = [
  {countries: 'fr', families: 'nursing_care,construction', day: '2026-11-12'},
  {countries: 'fr', families: 'medical', day: '2026-11-10'},
  {countries: 'es', families: 'electrical_mechanical,nope', day: '2026-11-02'},
  {countries: 'xx1', families: 'medical', day: '2026-11-12'}];

test('countsOf: a board counts once in total and once per family; unknown families and bad countries are skipped; last = newest day per country', () => {
  const c = countsOf(rows);
  assert.equal(c.total, 3, 'the malformed country is not a board');
  assert.deepEqual(c.cells, {'nursing_care|fr': 1, 'construction|fr': 1, 'medical|fr': 1, 'electrical_mechanical|es': 1});
  assert.deepEqual(c.last, {fr: '2026-11-12', es: '2026-11-02'});
  assert.equal(c.profiles, 3, 'c03 in France, and c04 and c18 who share Spain × electrical & mechanical: one board counts for both');
  assert.deepEqual(countsOf(null), {total: 0, cells: {}, last: {}, profiles: 0}, 'nothing published reads as zero');
});

test('the prefix is the one api/employers.js stores boards under', () => assert.equal(SCOUT_BOARD_PREFIX, API_PREFIX));

test('the 30 test profiles: unique ids, each a known pool family and country (the owner\'s Trello list, shared/test-profiles.json)', () => {
  assert.equal(PROFILE_CELLS.length, 30);
  assert.equal(new Set(PROFILE_CELLS.map(cell => cell.id)).size, 30);
  for (const cell of PROFILE_CELLS) {
    assert.deepEqual(Object.keys(cell).sort(), ['country', 'family', 'id'], `${cell.id}: id, country and family only (fictional people, no other field)`);
    assert.ok(FAMILIES.includes(cell.family), `${cell.id}: ${cell.family}`); assert.ok(COUNTRIES.includes(cell.country), `${cell.id}: ${cell.country}`);
  }
});

// A tiny D1 stand-in: answers by SQL text, records writes.
function fakeDb(answers = {}) {
  const writes = [];
  return {writes, prepare: sql => ({bind: (...args) => ({
    all: async () => ({results: sql.includes('FROM sitefacts') ? answers.sitefacts || [] : []}),
    first: async () => (sql.includes('intel_start') ? answers.start ?? null : null),
    run: async () => { writes.push({sql, args}); return {}; }})})};
}

test('storeBoardCounts writes the day\'s counts into index_daily.boards; dayCounts reads them back, a missing value is a gap', async () => {
  const db = fakeDb({sitefacts: rows});
  await storeBoardCounts(db, '2026-11-12');
  assert.match(db.writes[0].sql, /^UPDATE index_daily SET boards = \? WHERE day = \?$/);
  assert.equal(db.writes[0].args[1], '2026-11-12');
  assert.deepEqual(dayCounts(db.writes[0].args[0]), {total: 3, profiles: 3});
  assert.equal(dayCounts(''), null);
  assert.equal(dayCounts('{bad'), null);
});

test('gatherBoards: the live counts, the history oldest first with gaps, the Worker\'s last discovery start', async () => {
  const daily = [{day: '2026-11-12', boards: JSON.stringify({total: 3, profiles: 2, cells: {}})}, {day: '2026-11-11', boards: ''}];
  const got = await gatherBoards(fakeDb({sitefacts: rows, start: {at: '2026-11-12T07:45:00Z', ok: 1, reason: ''}}), daily);
  assert.equal(got.total, 3);
  assert.deepEqual(got.history, [{day: '2026-11-11', total: null, profiles: null}, {day: '2026-11-12', total: 3, profiles: 2}]);
  assert.deepEqual(got.start, {at: '2026-11-12T07:45:00Z', ok: true, reason: ''});
  assert.equal((await gatherBoards(fakeDb(), [])).start, null, 'never started reads as null');
});
