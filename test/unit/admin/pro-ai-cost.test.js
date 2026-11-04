// Pro cost reports use actual charged calls, excluding purchases and refunds, with the selected time range.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readProCosts, proSection} from '../../../admin/pro-ai-cost.js';

const now = new Date('2026-10-27T12:00:00Z');
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pro_credit (account TEXT, delta_micro INTEGER, reason TEXT, ref TEXT, at TEXT)');
  const insert = db.prepare('INSERT INTO pro_credit VALUES (?, ?, ?, ?, ?)');
  for (const row of [
    ['a', -1000000, 'ai_call', 'kit', '2026-10-27T10:00:00Z'],
    ['a', -2000000, 'ai_call', 'answer', '2026-10-27T02:00:00Z'],
    ['b', -3000000, 'ai_call', 'kit', '2026-10-24T10:00:00Z'],
    ['c', -4000000, 'ai_call', null, '2026-10-01T10:00:00Z'],
    ['d', -9000000, 'ai_call', 'kit', '2026-09-01T10:00:00Z'],
    ['a', 10000000, 'purchase', null, '2026-10-27T11:00:00Z'],
    ['a', -9000000, 'refund', null, '2026-10-27T11:00:00Z'],
  ]) insert.run(...row);
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), all: async () => ({results: db.prepare(sql).all(...args)})});
  return {prepare: sql => statement(sql)};
}

test('Pro cost follows each range and counts only actual AI credit debits', async () => {
  for (const [range, calls, credit, accounts] of [['6h', 1, 1, 1], ['24h', 2, 3, 1], ['7d', 3, 6, 2], ['30d', 4, 10, 3]]) {
    const summary = await readProCosts(database(), now, {'6h': 6, '24h': 24, '7d': 168, '30d': 720}[range]);
    assert.equal(summary.calls, calls, range);
    assert.equal(summary.creditEur, credit, range);
    assert.equal(summary.accounts, accounts, range);
    assert.ok(Math.abs(summary.estimatedUsd - credit * 0.58) < 1e-8);
    assert.equal(summary.steps.reduce((n, s) => n + s.calls, 0), calls);
    assert.equal(summary.steps.reduce((n, s) => n + s.creditEur, 0), credit);
  }
});

test('section labels the cost estimate, per-step averages and excludes account identifiers', async () => {
  const summary = await readProCosts(database(), now, 720);
  const html = proSection(summary, '30 days');
  assert.match(html, /Pro AI/);
  assert.match(html, /4 calls · 3 accounts/);
  assert.match(html, /€10.00/);
  assert.match(html, /Estimated raw cost/);
  assert.match(html, /\$5.80/);
  assert.match(html, /Per call/);
  assert.match(html, /other/);
  assert.doesNotMatch(html, /<td>[abcd]<\/td>/);
});

test('missing data is unavailable, while an empty ledger is explicitly zero', async () => {
  assert.equal(await readProCosts({prepare: () => { throw new Error('missing table'); }}, now, 168), null);
  assert.match(proSection(null, '7 days'), /unavailable/);
  const db = database();
  const empty = await readProCosts(db, new Date('2027-01-01T12:00:00Z'), 720);
  assert.equal(empty.calls, 0);
  assert.match(proSection(empty, '30 days'), /No charged Pro AI calls/);
});

test('measurement start and escaped step names are preserved', async () => {
  const summary = await readProCosts(database(), now, 720, '2026-10-27');
  assert.equal(summary.calls, 2);
  const html = proSection({...summary, steps: [{action: '<script>', calls: 1, creditEur: 1, estimatedUsd: 0.58}]}, '7 days');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('the AI cost page includes the Pro section alongside Free AI', async () => {
  const {page} = await import('../../../admin/jobcost.js');
  const summary = await readProCosts(database(), now, 720);
  const html = page([], [], [], '', now, '30d', [], null, null, null, undefined, summary);
  assert.match(html, /Free AI \(Workers AI\)/);
  assert.match(html, /id="pro-ai-cost"/);
  assert.match(html, /4 calls · 3 accounts/);
});
