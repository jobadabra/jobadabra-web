// A board count read from the board's own LIST of jobs is served `listed: true`, never `measured` (13 Nov 2026, owner via sa; plan 1/2 of
// docs/superpowers/plans/2026-11-13-proven-boards.md in jobadabra). Real SQL on the migrations, like employers.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../../../workers/www/index.js';
import {agreedSites, boardFactsOf} from '../../../api/employers.js';
import {listedFamiliesOf} from '../../../api/board-listed.js';

const store = new Map();
const env = () => ({INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')},
  WAITLIST: {get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); }}});
const auth = {Authorization: 'Bearer k3y'};
const put = (e, board_facts) => worker.fetch(new Request('https://www.jobpilotto.top/api/index', {method: 'PUT', headers: auth,
  body: JSON.stringify({feeds: [{company: 'Co a', ats: 'lever', slug: 'a', quality: 71.6, jobs: 12, relevant: 4.6, checked: '2026-09-30', places: ['Zurich, Switzerland', 7]}], board_facts})}), e, {});
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0018_employer_index.sql', import.meta.url), 'utf8'));
  for (const file of ['0037_pool_sitefacts.sql', '0038_sitefacts_layout.sql', '0094_sitefacts_board_yield.sql']) {
    try { db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8')); } catch (error) { if (!/duplicate column|already exists/.test(String(error))) throw error; }
  }
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql), batch: async statements => { for (const item of statements) await item.run(); }};
}
const cellsOf = async (e, host) => Object.fromEntries((await agreedSites(e)).find(fact => fact.kind === 'board' && fact.host === host).relevant.map(cell => [cell.family, cell]));
const airline = {host: 'airlinejobs.com', url: 'https://airlinejobs.com/es', country: 'es', local_jobs: 178, families: ['electrical_mechanical', 'customer_service'],
  family_jobs: {electrical_mechanical: 53, customer_service: 4}};
const day = new Date().toISOString().slice(0, 10);

test('a family counted from the board\'s list is served listed, not measured; a searched count is unchanged', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [{...airline, listed_families: ['electrical_mechanical']}]);
  const cells = await cellsOf(e, 'airlinejobs.com');
  assert.deepEqual(cells.electrical_mechanical, {family: 'electrical_mechanical', country: 'es', installs: 1, in_places: 53, fit70: 0, right: 53, day, listed: true});
  assert.deepEqual(cells.customer_service, {family: 'customer_service', country: 'es', installs: 1, in_places: 4, fit70: 0, right: 4, day, measured: true});
});

test('no listed_families: the cell is what it was before the mark (no listed key)', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [airline]);
  const cells = await cellsOf(e, 'airlinejobs.com');
  assert.deepEqual(cells.electrical_mechanical, {family: 'electrical_mechanical', country: 'es', installs: 1, in_places: 53, fit70: 0, right: 53, day, measured: true});
  assert.equal('listed' in cells.customer_service, false);
});

test('a bad listed_families is dropped and the board and its counts stay', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  const bad = [
    {...airline, host: 'unknown.com', url: 'https://unknown.com/es', listed_families: ['nonsense']},
    {...airline, host: 'absent.com', url: 'https://absent.com/es', listed_families: ['teaching']},   // a pool family, but no count for it
    {...airline, host: 'text.com', url: 'https://text.com/es', listed_families: 'electrical_mechanical'},
    {...airline, host: 'obj.com', url: 'https://obj.com/es', listed_families: {electrical_mechanical: true}},
    {...airline, host: 'nocount.com', url: 'https://nocount.com/es', family_jobs: undefined, listed_families: ['electrical_mechanical']}];
  assert.equal((await (await put(e, bad)).json()).board_facts, 5, 'a bad mark never costs the board');
  for (const host of ['unknown.com', 'absent.com', 'text.com', 'obj.com']) {
    const cells = await cellsOf(e, host);
    assert.equal(cells.electrical_mechanical.measured, true, host);
    assert.equal(Object.values(cells).some(cell => 'listed' in cell), false, host);
  }
  assert.equal(Object.values(await cellsOf(e, 'nocount.com')).some(cell => 'listed' in cell || 'measured' in cell), false, 'no counts: no mark');
  assert.deepEqual(listedFamiliesOf(['electrical_mechanical', 'electrical_mechanical', 'nonsense', 'teaching'], {electrical_mechanical: 1}), ['electrical_mechanical'], 'deduped, only counted pool families');
  assert.equal(listedFamiliesOf(['teaching'], {electrical_mechanical: 1}), undefined);
  assert.equal(boardFactsOf([{...airline, listed_families: ['nonsense']}])[0].listed_families, undefined);
});

test('a refresh by a pass that did not list the family clears its mark (the row is replaced)', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await put(e, [{...airline, listed_families: ['electrical_mechanical']}]);
  assert.equal((await cellsOf(e, 'airlinejobs.com')).electrical_mechanical.listed, true);
  await put(e, [airline]);   // this pass searched it
  const cells = await cellsOf(e, 'airlinejobs.com');
  assert.equal('listed' in cells.electrical_mechanical, false);
  assert.equal(cells.electrical_mechanical.measured, true);
});
