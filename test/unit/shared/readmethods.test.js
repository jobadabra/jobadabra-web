// "How sources were read" (shared/readmethods.js): five fixed methods, counts only; a scout run and an install report give the same shape; the card draws and has empty states.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {METHODS, MEASURES, READ_FIELDS, cleanReads, fromReport, perDay, section, gather} from '../../../shared/readmethods.js';
import {FIELDS, clean} from '../../../shared/search-report.js';
import {cleanStats} from '../../../shared/scouting.js';
import {page} from '../../../admin/scoutingadmin.js';

const reads = {feed_api: {sources: 40, jobs: 300, s: 12, ai_cents: 0}, browser: {sources: 2, jobs: 9, s: 70, ai_cents: 3}};

test('every method × measure is one listed install field and nothing else is', () => {
  assert.equal(Object.keys(READ_FIELDS).length, METHODS.length * MEASURES.length);
  for (const method of METHODS) for (const measure of MEASURES) assert.ok(FIELDS[`read_${method}_${measure}`], `read_${method}_${measure}`);
  const kept = clean({kind: 'search', read_feed_api_sources: 5, read_feed_api_host: 'x.com', read_unknown_sources: 3, read_browser_s: -1});
  assert.deepEqual(Object.keys(kept).sort(), ['kind', 'read_feed_api_sources'], 'an unlisted method or measure, or a negative count, is dropped');
});

test('cleanReads keeps whole numbers for the five methods and drops the rest', () => {
  const kept = cleanReads({...reads, secret_host: {sources: 9}, plain_page: {sources: 'x', host: 'a.com'}});
  assert.deepEqual(Object.keys(kept), METHODS);
  assert.deepEqual(kept.plain_page, {sources: 0, jobs: 0, s: 0, ai_cents: 0});
  assert.equal(cleanReads({}), null);
  assert.equal(cleanReads(null), null);
});

test('a scout run keeps its reads, an install report gives the same shape', () => {
  const run = cleanStats({run: {at: '2026-10-24T04:20', reads}}).run;
  assert.equal(run.reads.feed_api.sources, 40);
  const report = fromReport({read_feed_api_sources: 40, read_feed_api_jobs: 300, read_feed_api_s: 12, read_browser_sources: 2});
  assert.equal(report.feed_api.jobs, 300);
  assert.equal(fromReport({in_places: 3}), null, 'a report from a build without reads');
});

test('days add up their records, newest first', () => {
  const rows = perDay([{day: '2026-10-23', reads: cleanReads(reads)}, {day: '2026-10-24', reads: cleanReads(reads)}, {day: '2026-10-24', reads: cleanReads(reads)}, {day: '2026-10-22', reads: null}]);
  assert.deepEqual(rows.map(r => [r.day, r.runs, r.reads.feed_api.sources]), [['2026-10-24', 2, 80], ['2026-10-23', 1, 40]]);
});

test('the card draws both panels from data and says when one has none yet', () => {
  const html = section({central: [{day: '2026-10-24', reads: cleanReads(reads)}], installs: []});
  assert.match(html, /How sources were read/);
  assert.match(html, /Job-feed API/);
  assert.match(html, /Comes with the next report\./, 'installs: empty state');
  assert.match(section(null), /Comes with the central scout's next run\./);
});

test('the page shows the card, and gather reads only search reports that carry reads', async () => {
  const db = {prepare: () => ({bind: () => ({all: async () => ({results: [{install: 'a', day: '2026-10-24', data: JSON.stringify({read_feed_api_sources: 3})}, {install: 'b', day: '2026-10-24', data: '{"in_places":1}'}]})})})};
  const got = await gather(db, [{at: '2026-10-24T04:20', reads: cleanReads(reads)}], new Date('2026-10-25'));
  assert.equal(got.installs.filter(r => r.reads).length, 1);
  const html = page({feeds: [], daily: [], sharing7: 0, sharing30: 0, shared: 0, routes: [], useful: [], dead: [], deadTotal: 0, central: null, reads: got});
  assert.match(html, /How sources were read/);
  assert.match(html, /1 reporting/);
});
