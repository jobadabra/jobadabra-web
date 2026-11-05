// /admin/job-search/installs (src/installsimpact.js): what installs add to the employer list, from fixture rows in a real SQLite; counts and names only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {byKind, floorCells, gather, page, view} from '../../../admin/installsimpact.js';
import {poolSnapshot, pooledKeys, storePoolSnapshot} from '../../../shared/pool-snapshot.js';
import {stacked} from '../../../admin/installscharts.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0003_contributions.sql', '0027_contributions_v2.sql', '0028_nofeed.sql', '0029_index_daily.sql', '0031_board_reads.sql', '0099_scouting_history.sql', '0101_pool_served.sql', '0102_installs_impact.sql'])
    db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS index_feeds (key TEXT PRIMARY KEY, body TEXT)');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const feed = (slug, kind, jobs, countries = ['ch']) => ({company: slug, ats: 'lever', slug, kinds: {[kind]: 0.9}, countries, jobs});
const feeds = [feed('a', 'software', 100), feed('b', 'healthcare', 40), feed('c', 'healthcare', 60, ['de', 'ch']), feed('d', 'logistics', 10)];

test('employers an install shared with its own route count as from installs; the central index and own lists do not', async () => {
  const env = d1();
  env.db.exec(`INSERT INTO contributions (install, day, company, ats, slug, how, matched, own, roles, regions) VALUES ('i1','2026-10-19','Co','lever','b','ai_idea', 0, 0, '', ''), ('i2','2026-10-19','Co','lever','c','careers_page', 0, 0, '', ''), ('i3','2026-10-19','Co','lever','a','index', 0, 0, '', ''), ('i3','2026-10-19','Co','lever','d','own', 0, 0, '', ''), ('i3','2026-10-19','Co','lever','zz',NULL, 0, 0, '', '')`);
  assert.deepEqual([...await pooledKeys(env)].sort(), ['lever:b', 'lever:c']);
});

test('the snapshot adds the jobs, the jobs from installs and the pooled kind × country cells', async () => {
  const keys = new Set(['lever:b', 'lever:c']);
  const snap = poolSnapshot(feeds, keys);
  assert.deepEqual(snap, {jobs_total: 210, from_pool_jobs: 100, pool_cells: {'healthcare|ch': [2, 100], 'healthcare|de': [1, 60]}});
  const env = d1();
  env.db.exec("INSERT INTO index_daily (day, feeds) VALUES ('2026-10-20', 4)");
  await storePoolSnapshot(env, '2026-10-20', snap);
  const row = env.db.prepare('SELECT jobs_total, from_pool_jobs, pool_cells FROM index_daily').get();
  assert.equal(row.from_pool_jobs, 100);
  assert.deepEqual(JSON.parse(row.pool_cells), snap.pool_cells);
});

test('a cell lifted to the floor counts only when the central scout alone left it under', () => {
  const cells = {'healthcare|pl': [25, 5], 'healthcare|de': [30, 5], 'sales_b2b|fr': [10, 1], 'logistics|lu': [5, 1]};   // floors: 25 big markets, 5 small
  assert.deepEqual(floorCells(cells, {'healthcare|pl': [5, 1], 'healthcare|de': [2, 1], 'logistics|lu': [1, 1]}), {withInstalls: 3, alone: 1, gained: 2});
});

test('each employer is counted once per kind, central or from installs', () => {
  assert.deepEqual(byKind(feeds, new Set(['lever:b', 'lever:c'])), [{kind: 'healthcare', central: 0, installs: 2}, {kind: 'software', central: 1, installs: 0}, {kind: 'logistics', central: 1, installs: 0}]);
});

test('the page answers in its verdict and tiles from fixture rows, and shows the skipped steps', async () => {
  const env = d1();
  for (const f of feeds) env.db.prepare('INSERT INTO index_feeds (key, body) VALUES (?, ?)').run(f.slug, JSON.stringify(f));
  env.db.exec(`INSERT INTO contributions (install, day, company, ats, slug, how, matched, own, roles, regions) VALUES ('i1','2026-10-19','Co','lever','b','ai_idea', 0, 0, '', ''), ('i2','2026-10-19','Co','lever','c','careers_page', 0, 0, '', '')`);
  env.db.exec(`INSERT INTO index_daily (day, feeds, from_pool) VALUES ('2026-10-18', 3, 1), ('2026-10-19', 4, 2)`);
  env.db.exec(`INSERT INTO pool_served_day (day, kind, n) VALUES ('2026-10-19', 'places', 7), ('2026-10-20', 'places', 5)`);
  env.db.exec(`INSERT INTO board_reads (install, day, board, roles, regions, hits) VALUES ('i1','2026-10-19','jobsch','','', 3)`);
  const html = page(await gather(env, new Date('2026-10-20T12:00:00Z')), new Date('2026-10-20T12:00:00Z'));
  assert.match(html, /2 of 4 employers \(50%\) came from installs, holding 48% of the open jobs\. Installs skipped 12 steps in 30 days/);
  assert.match(html, /Steps skipped, 30 days<\/span><b>12<\/b>/);
  assert.match(html, /Boards found by installs<\/span><b>1<\/b>/);
  assert.match(html, /<td><span class="chip">places<\/span><\/td><td>5<\/td><td>12<\/td><td>12<\/td>/, 'the per-kind table from /admin/job-search/scouting is reused');
  assert.doesNotMatch(html, /<script>[^<]*http/, 'no external call');
});

test('an empty database still renders, and the chart needs two days', async () => {
  const html = page(await gather(d1()));
  assert.match(html, /No employer list published yet/);
  assert.match(stacked([{day: '2026-10-20', central: 1, installs: 1}]), /Needs two daily snapshots/);
  assert.match(stacked([{day: '2026-10-19', central: 5, installs: 1}, {day: '2026-10-20', central: 6, installs: 3}], {label: 'x'}), /3 of 9 from installs today/);
});

test('the page needs the admin login', async () => {
  const response = await view(new Request('https://www.jobadabra.top/admin/job-search/installs'), {STATS: d1()});
  assert.equal(response.status, 404);
});
