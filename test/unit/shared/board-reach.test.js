// shared/board-reach.js: job boards across Europe, local vs multi-country (grouped by brand), and the tile map in its public cut (bands only) and Admin's cut (counts, dots).
// Owner, 12 Nov 2026: "we should not disclose our intellectual property": the public map carries no number per country, no dot, no name.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BANDS, TILES, brandOf, publicReach, reachMap, reachOf} from '../../../shared/board-reach.js';
import {EUROPE} from '../../../shared/pool-tags.js';

const rows = [['acme-jobs.at', 'at'], ['acme-jobs.es', 'es'], ['www.acme-jobs.lu', 'lu'], ['hire.co.uk', 'gb'], ['jobs.hire.co.uk', 'gb'],
  ['search.local-one.fr', 'fr'], ['local-two.fr', 'fr'], ['nordic.no', 'no'], ['far-away.com', 'us']].map(([host, countries]) => ({host, countries}));

test('brandOf: the label before the ending, a second-level ending skipped, www dropped', () => {
  for (const [host, brand] of [['acme-jobs.at', 'acme-jobs'], ['www.acme-jobs.lu', 'acme-jobs'], ['search.local-one.fr', 'local-one'], ['jobs.hire.co.uk', 'hire'],
    ['hire.co.uk', 'hire'], ['de.bigboard.com', 'bigboard'], ['localhost', 'localhost'], ['', '']]) assert.equal(brandOf(host), brand, host);
});

test('reachOf: one brand on 3 country domains is one multi-country board; the rest local; outside Europe skipped', () => {
  const reach = reachOf(rows);
  assert.deepEqual(reach.multi, [{brand: 'acme-jobs', hosts: ['acme-jobs.at', 'acme-jobs.es', 'www.acme-jobs.lu'], countries: ['at', 'lu', 'es']}]);
  assert.equal(reach.local, 4, 'hire (two gb hosts, one brand), local-one, local-two, nordic');
  assert.equal(reach.boards, reach.local + reach.multi.length, 'a brand counts once, local or multi');
  assert.deepEqual(reach.countries, {at: 1, es: 1, lu: 1, gb: 1, fr: 2, no: 1});
  assert.equal(reach.countries.us, undefined);
});

test('TILES: every European country has its own square on the 8 × 7 map', () => {
  const seen = new Set();
  for (const country of EUROPE) {
    const [col, row] = TILES[country] || [];
    assert.ok(col >= 1 && col <= 8 && row >= 1 && row <= 7, `${country} placed`);
    assert.ok(!seen.has(`${col},${row}`), `${country} on its own square`);
    seen.add(`${col},${row}`);
  }
});

test('the public cut: bands in words, no count per country, no multi-country dot, no host or brand anywhere', () => {
  const body = publicReach(rows);
  assert.deepEqual({local: body.local, multi: body.multi, countries: body.countries, of: body.of}, {local: 4, multi: 1, countries: 6, of: EUROPE.length});
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /acme|hire|local-one|local-two|nordic|far-away/);
  assert.doesNotMatch(body.map, /<small>|shared/, 'no number and no dot on a public square');
  assert.match(body.map, /data-tip="France: 1 or 2 boards"/);
  assert.match(body.map, /data-tip="Finland: no board yet"/);
  assert.equal(publicReach([]), null, 'no board yet: no section');
  assert.equal(BANDS.at(-1).max, Infinity);
});

test("Admin's cut: each country's count and a dot where a multi-country board reaches", () => {
  const map = reachMap(reachOf(rows));
  assert.match(map, /class="tile h2 shared"[^>]*><b>AT<\/b><small>1<\/small>/);
  assert.match(map, /<b>FR<\/b><small>2<\/small>/);
  assert.match(map, /<b>FI<\/b><small>·<\/small>/);
});
