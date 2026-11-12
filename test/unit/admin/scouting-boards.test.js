// admin/scouting-boards.js: the "Job boards with 3+ local jobs" card of /admin/job-search/scouting.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boardsSection, days30, lastChip} from '../../../admin/scouting-boards.js';
import {page} from '../../../admin/scoutingadmin.js';
import {countsOf} from '../../../shared/board-counts.js';

const now = new Date('2026-11-12T12:00:00Z');
const live = countsOf([{countries: 'fr', families: 'nursing_care,medical', day: '2026-11-12'}, {countries: 'no', families: 'medical', day: '2026-11-03'}, {countries: 'lu', families: 'legal', day: '2026-11-12'}]);

test('lastChip: today green, 3 days amber, 9 days red, never grey', () => {
  assert.equal(lastChip('2026-11-12', now), '<span class="chip good">today</span>');
  assert.equal(lastChip('2026-11-09', now), '<span class="chip warn">3 d</span>');
  assert.equal(lastChip('2026-11-03', now), '<span class="chip bad">9 d</span>');
  assert.equal(lastChip(undefined, now), '<span class="chip off">–</span>');
});

test('days30: 30 days ending today; a day without a snapshot is a gap (null), never 0; today is the live count', () => {
  const days = days30([{day: '2026-11-10', total: 4, profiles: 1}], now, {total: 2, profiles: 1});
  assert.equal(days.length, 30);
  assert.equal(days[0].day, '2026-10-14');
  assert.deepEqual(days[27].values, [4, 1]);
  assert.deepEqual(days[28].values, [null, null]);
  assert.deepEqual(days[29].values, [2, 1]);
});

test('the card: verdict chips, the trend chart, every test profile cell (red at 0), the country columns with their last measured day', () => {
  const html = boardsSection({...live, history: [], start: null}, now);
  for (const want of ['3 boards', '3 countries', '1 of 30 test profiles have a board', '29 test profiles at 0', 'discovery timer: not started yet']) assert.ok(html.includes(want), want);
  assert.match(html, /<svg class="vz-cols"/, 'a chart with an axis, not a sentence');
  assert.ok(html.includes('<td class="p" tabindex="0" data-tip="Nursing &amp; care · France: 1 board with 3+ local jobs · test profile c03"><span class="chip good">1</span></td>'));
  assert.match(html, /Electrical &amp; mechanical · Spain: 0 boards with 3\+ local jobs · test profiles c04, c18"><span class="chip bad">0<\/span>/, 'a cell two profiles share, at 0, reads red and names both');
  assert.match(html, />NO<small><span class="chip bad">9 d<\/span>/, 'a country shows its last measured day');
  assert.match(html, />BG<small><span class="chip off">–<\/span>/, 'a profile country without a board shows as never measured');
  assert.match(html, />LU<small><span class="chip good">today/, 'a country without a profile shows because it has a board');
  assert.doesNotMatch(html, /https?:\/\//, 'no board address on the page');
});

test('the discovery start: started green with its time, refused red with its reason', () => {
  assert.match(boardsSection({...live, history: [], start: {at: '2026-11-12T07:45:00.000Z', ok: true, reason: ''}}, now), /chip good">discovery started 2026-11-12 07:45 UTC/);
  assert.match(boardsSection({...live, history: [], start: {at: '2026-11-12T07:45:00Z', ok: false, reason: 'BRAIN_GITHUB_TOKEN is not set'}}, now), /chip bad">discovery start refused: BRAIN_GITHUB_TOKEN is not set/);
});

test('the Scouting page shows the card under the heat map when its data came, and leaves it out when not', () => {
  const base = {feeds: [], daily: [], sharing7: 0, sharing30: 0, shared: 0, routes: [], useful: [], dead: [], deadTotal: 0, central: null};
  const html = page({...base, boardCounts: {...live, history: [], start: null}}, undefined, now);
  assert.ok(html.indexOf('Where the list is strong or thin') < html.indexOf('Job boards with 3+ local jobs'));
  assert.doesNotMatch(page(base, undefined, now), /Job boards with 3\+ local jobs/);
});

test('a workflow disabled in GitHub reads as paused (grey), even when the Worker\'s last start was refused', () => {
  const html = boardsSection({...live, history: [], start: {at: '2026-11-12T08:45:00Z', ok: false, reason: 'GitHub dispatch failed: 422'}, paused: true}, now);
  assert.match(html, /chip off">discovery paused: workflow disabled in GitHub/);
  assert.doesNotMatch(html, /discovery start refused/);
});
