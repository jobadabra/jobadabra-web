// Market coverage (mc 5/5, 10 Nov 2026): the weekly reference's per-source rows, kept in fixed words and drawn beside the newest run. A source that was not counted has no numbers (never 0); an unknown status word drops the source.
// Guard for admin/search-market.js, the reference store (admin/search-reference.js, reference() in admin/search-night.js) and the Market coverage card of the Finish line tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-reference.js';
import {cleanMarket, cleanSource, coverage, kindOf} from '../../../../admin/search-market.js';
import {finishSection} from '../../../../admin/search-finish-page.js';
import {clean as cleanNight} from '../../../../admin/search-night.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';

const NOW = new Date('2026-11-12T09:00:00Z');
const person = extra => ({total: 20, reachable: 15, eures: 20, market: 40, counted_on: '2026-11-09', sources: {
  eures: {status: 'counted', read: 30, right: 20, only: 5}, employer_sites: {status: 'partial: 2 feeds late', read: 12, right: 6, only: 2}, linkedin: {status: 'by hand', right: 9},
  free_job_apis: {status: 'none (no query)', right: 0}, web_search: {status: 'not counted: no key', read: 3, right: 0, only: 0}, mystery: {status: 'counted', right: 1}}, ...extra});

test('a status leads with its kind word; an unknown word drops the source; only counted and partial keep numbers, the others are null never 0', () => {
  assert.deepEqual(['counted', 'partial: x', 'not counted: no key', 'none (no board)', 'by hand', 'maybe'].map(kindOf), ['counted', 'partial', 'not-counted', 'none', 'by-hand', null]);
  assert.equal(cleanSource({status: 'maybe', right: 3}), null);
  assert.deepEqual(cleanSource({status: 'counted', read: 30, right: 0, only: 0}), {status: 'counted', kind: 'counted', read: 30, right: 0, only: 0}, 'a counted 0 is a real 0');
  assert.deepEqual(cleanSource({status: 'not counted: no key', read: 3, right: 0, only: 0}), {status: 'not counted: no key', kind: 'not-counted', read: null, right: null, only: null});
  assert.deepEqual(cleanSource({status: 'counted', read: -1, right: 1.5, only: '4'}), {status: 'counted', kind: 'counted', read: null, right: null, only: null});
  const kept = cleanMarket(person());
  assert.deepEqual([kept.market, kept.countedOn, Object.keys(kept.sources)], [40, '2026-11-09', ['eures', 'employer_sites', 'free_job_apis', 'web_search', 'linkedin']], 'an unknown source name is dropped, the order is the fixed list');
  assert.deepEqual([cleanMarket({total: 1}).market, cleanMarket({total: 1}).sources], [null, {}], 'a record without the fields keeps none');
});

test('the reference PUT keeps the market fields, its counts stay required, and 18 people with six sources fit the cap', () => {
  const personas = Object.fromEntries(Array.from({length: 18}, (_, i) => [i + 1, person()]));
  const record = clean({personas}, {week: '2026-W46'}, NOW);
  assert.equal(record.error, undefined);
  assert.equal(record.personas[1].sources.eures.right, 20);
  assert.ok(JSON.stringify({personas}).length < 32768, 'the body fits the cap');
  assert.match(clean({personas: {1: {...person(), total: null}}}, {week: '2026-W46'}, NOW).error, /total and reachable are required/);
});

test('coverage: market over the people counted, our right jobs of the same people from the newest run, per-source sums, no source = nothing', () => {
  const ref = {1: cleanMarket(person()), 2: cleanMarket(person({market: 10})), 3: cleanMarket(person({market: null, sources: {}}))};
  const run = {rows: [{persona: 1, kind: 'measured', local: 8}, {persona: 2, kind: 'measured', local: 4}, {persona: 3, kind: 'measured', local: 9}, {persona: 4, kind: 'fault', local: 1}]};
  const c = coverage(ref, run);
  assert.deepEqual([c.people, c.counted, c.market, c.ours, c.oursOf], [3, 2, 50, 12, 50], 'person 3 has no market count: out of both sums');
  const eures = c.sources.find(row => row.source === 'eures'), web = c.sources.find(row => row.source === 'web_search');
  assert.deepEqual([eures.right, eures.only, eures.kinds], [40, 10, {counted: 2}], 'EURES: counted for the two people who sent it; the person with no sources adds nothing');
  assert.deepEqual([web.right, web.only, web.read], [null, null, null], 'not counted everywhere: null, never 0');
  assert.deepEqual(coverage({}, run).sources, []);
  assert.equal(coverage(ref, {rows: [{persona: 1, kind: 'fault', local: 8}]}).ours, null, 'a person the night could not measure is not "0 of the market"');
});

test('the card: nothing sent says so; sent rows draw the market, our share, each source\'s kinds and sums', () => {
  const night = cleanNight({state: 'success', head: 'm', rows: [{persona: 1, label: 'p1 A, B', kind: 'measured', local: 8, found: 9, seconds: 90}, {persona: 2, label: 'p2 C, D', kind: 'measured', local: 4, found: 5, seconds: 90}]}, {night: '2026-11-11'}, NOW);
  const judged = judgeAll([night]);
  assert.match(finishSection(judged, [], {}), /id="finish-market"[\s\S]*not sent yet/);
  const ref = {1: cleanMarket(person()), 2: cleanMarket(person({market: 10}))};
  const html = finishSection(judged, [], ref);
  assert.match(html, /market 50 right jobs · 2 of 2 people/);
  assert.match(html, /our list holds 12 of 50 \(24%\)/);
  assert.match(html, /2 counted/);
  assert.match(html, /2 by hand/);
  assert.match(html, /counted 2026-11-09/);
});
