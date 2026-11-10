// The Lab page's fill regression (admin/applying-fill-drop.js): a pool site whose last run filled fewer fields than its own best share would, beyond the measured noise of one field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {NOISE_FIELDS, fillDrop} from '../../../../admin/applying-fill-drop.js';
import {data, ingest} from '../../../../admin/applying.js';

const run = (day, filled, left, reached = 'form') => ({day, reached, filled, left_n: left});

test('a run within one field of its best is noise, not a regression', () => {
  assert.equal(NOISE_FIELDS, 1);
  assert.equal(fillDrop([run('2026-11-01', 10, 2), run('2026-11-02', 9, 3)]), null);
  assert.equal(fillDrop([run('2026-11-01', 9, 3), run('2026-11-02', 10, 2), run('2026-11-03', 9, 3)]), null);
});

test('the same form filling 3 fields fewer than its best is a fill regression of 3 fields', () => {
  assert.deepEqual(fillDrop([run('2026-11-01', 10, 2), run('2026-11-02', 9, 3), run('2026-11-03', 7, 5)]),
    {fields: 3, best: {filled: 10, total: 12, share: 83, day: '2026-11-01'}, last: {filled: 7, total: 12, share: 58, day: '2026-11-03'}, formChanged: false});
});

test('a form that grew is measured on its new size and says it changed', () => {
  const drop = fillDrop([run('2026-11-01', 7, 2), run('2026-11-04', 9, 8)]);   // 78% of 17 fields is 13.2: 4 fields fewer than the best share
  assert.equal(drop.fields, 4);
  assert.equal(drop.formChanged, true);
  assert.deepEqual([drop.best.total, drop.last.total], [9, 17]);
});

test('a last run that did not reach the form is the reach regression, not a fill one', () => {
  assert.equal(fillDrop([run('2026-11-01', 10, 2), run('2026-11-02', 4, 8, 'posting')]), null);
  assert.equal(fillDrop([run('2026-11-01', 10, 2), run('2026-11-02', null, null)]), null);
});

test('a form ready for the person\'s check counts as a form; a single run or a best last run is never a drop', () => {
  assert.equal(fillDrop([run('2026-11-01', 10, 2, 'ready'), run('2026-11-02', 6, 6, 'ready')]).fields, 4);
  assert.equal(fillDrop([run('2026-11-01', 3, 9)]), null);
  assert.equal(fillDrop([run('2026-11-01', 6, 6), run('2026-11-02', 10, 2)]), null);
  assert.equal(fillDrop([]), null);
});

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}

test('the page data carries each pool row\'s fill drop and the regressions tile counts them', async () => {
  const db = d1(), now = new Date('2026-11-10T12:00:00Z');
  await ingest(db, {kind: 'pool', day: '2026-11-08', rows: [{name: 'Dropped'}, {name: 'Steady'}]}, now);
  for (const [day, dropped, steady] of [['2026-11-08', 10, 10], ['2026-11-09', 10, 9], ['2026-11-10', 6, 10]]) {
    await ingest(db, {kind: 'smoke', day, version: '0.9.600', rows: [{name: 'Dropped', reached: 'form', filled: dropped, left: 12 - dropped}, {name: 'Steady', reached: 'form', filled: steady, left: 12 - steady}]}, new Date(day + 'T12:00:00Z'));
  }
  const page = await data(db, now), row = name => page.pool.find(item => item.shape === name);
  assert.equal(row('Dropped').fillDrop.fields, 4);
  assert.equal(row('Steady').fillDrop, null);
  assert.equal(page.tiles.fillDrops, 1);
});
