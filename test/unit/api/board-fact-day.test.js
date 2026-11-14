// A Scout board fact keeps the day the board was read (`day`), not the publish date, so a board not read again leaves 30 days after its read
// (14 Nov 2026, zb for sa, jobadabra#4346: a board read on 13 Nov was served dated 14 Nov, and every publish moved its day forward). Real SQL on the migrations, like board-listed.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agreedSites, SCOUT_BOARD_DAYS} from '../../../api/employers.js';
import {d1, env, put, store} from './scout-board-publish.js';

const shift = days => new Date(Date.parse(new Date().toISOString().slice(0, 10)) + days * 86400000).toISOString().slice(0, 10);   // the publish's own clock (the handler's): days from today
const board = (host, extra = {}) => ({host, url: `https://${host}/posao/{role}`, country: 'hr', local_jobs: 7, families: ['marketing_social'], family_jobs: {marketing_social: 7}, ...extra});
const stored = (e, host) => e.STATS.db.prepare(`SELECT day FROM sitefacts WHERE kind = 'board' AND host = ?`).get(host)?.day;
const servedDay = async (e, host) => (await agreedSites(e)).find(fact => fact.kind === 'board' && fact.host === host)?.relevant[0].day;

test('a fact read yesterday is stored and served with yesterday, not the publish date', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [board('read-yesterday.hr', {day: shift(-1)})]);
  assert.equal(stored(e, 'read-yesterday.hr'), shift(-1));
  assert.equal(await servedDay(e, 'read-yesterday.hr'), shift(-1));
});

test('a later publish of the same read keeps its day, so the board leaves 30 days after its read', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  const read = shift(-SCOUT_BOARD_DAYS);   // the last day it still counts
  await put(e, [board('old-read.hr', {day: read})]);
  await put(e, [board('old-read.hr', {day: read})]);
  assert.equal(stored(e, 'old-read.hr'), read, 'every publish moved the day forward: the board never left');
});

test('without a day (an older engine) the publish date is the day, as before', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [board('no-day.hr')]);
  assert.equal(stored(e, 'no-day.hr'), shift(0));
});

test('a day in the future, past the cutoff or not a date refuses that fact only: the others are stored and its old row stays', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [board('kept.hr', {day: shift(-3)})]);
  const answer = await (await put(e, [board('kept.hr', {day: shift(1)}), board('too-old.hr', {day: shift(-SCOUT_BOARD_DAYS - 1)}),
    board('not-a-date.hr', {day: '13 Nov'}), board('good.hr', {day: shift(-2)})])).json();
  assert.equal(answer.ok, true);
  assert.equal(answer.board_facts, 1);
  assert.equal(stored(e, 'kept.hr'), shift(-3), 'a refused fact never touches the row it would replace');
  assert.equal(stored(e, 'too-old.hr'), undefined);
  assert.equal(stored(e, 'not-a-date.hr'), undefined);
  assert.equal(stored(e, 'good.hr'), shift(-2));
});
