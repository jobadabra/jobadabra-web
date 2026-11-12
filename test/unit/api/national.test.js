// The national ads search installs call (api/national.js, GET /api/index/national) on example rows (example names, made-up ids).
// Guard: privacy/data — only an install with the index token reads; a country off (kill switch, no key, beta-only) answers 204 so the app says nothing;
// a row served has exactly the validated fields and links to the service's own page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../../../shared/guard.js';
import {PER_INSTALL_PER_DAY, boxOf, findOf, nationalSearch, pointOf, rowOf, switches} from '../../../api/national.js';
import PLACES from '../../../shared/norway-places.json' with {type: 'json'};

const INSTALL = 'example-install-1';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0149_national_ads.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}

function seeded() {
  const e = {NATIONAL_FEEDS: 'no', NAV_FEED_TOKEN: 'example-key', STATS_SALT: 'example-salt', STATS: d1()};
  const put = e.STATS.db.prepare('INSERT INTO national_ads (country, id, title, employer, place, lat, lon, changed, find) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const oslo = pointOf('no', 'Oslo'), bergen = pointOf('no', 'Bergen');
  [['00000000-0000-4000-8000-000000000001', 'Sykepleier', 'Eksempel Helse AS', 'Oslo', oslo, '2026-11-10T08:00:00.000Z'],
    ['00000000-0000-4000-8000-000000000002', 'SYKEPLEIER natt', 'Eksempel Omsorg AS', 'Oslo', oslo, '2026-11-11T08:00:00.000Z'],
    ['00000000-0000-4000-8000-000000000003', 'Sykepleier', 'Eksempel Bergen AS', 'Bergen', bergen, '2026-11-09T08:00:00.000Z'],
    ['00000000-0000-4000-8000-000000000004', 'Ærlig økonomimedarbeider', 'Eksempel Regnskap AS', 'Oslo', oslo, '2026-11-08T08:00:00.000Z'],
    ['00000000-0000-4000-8000-000000000005', '50%_stilling sykepleier', 'Eksempel AS', 'Herøy', [null, null], '2026-11-07T08:00:00.000Z'],
  ].forEach(([id, title, employer, place, [lat, lon], changed]) => put.run('no', id, title, employer, place, lat, lon, changed, findOf(title)));
  return e;
}

async function ask(e, query, {token = true, beta = false} = {}) {
  const headers = {'X-Install-Id': INSTALL, ...(token ? {Authorization: `Bearer ${await tokenFor(INSTALL, e, 'index')}`} : {}), ...(beta ? {'X-Beta': '1'} : {})};
  const answer = await nationalSearch(new Request(`https://example.test/api/index/national?${new URLSearchParams(query)}`, {headers}), e);
  return {status: answer.status, body: answer.status === 200 ? await answer.json() : null};
}

test('only an install with the index token reads (the recipes token or none is refused)', async () => {
  const e = seeded();
  assert.equal((await ask(e, {country: 'no', q: 'sykepleier'}, {token: false})).status, 401);
  const recipes = await tokenFor(INSTALL, e, 'recipes');
  const answer = await nationalSearch(new Request('https://example.test/api/index/national?country=no&q=sykepleier', {headers: {'X-Install-Id': INSTALL, Authorization: `Bearer ${recipes}`}}), e);
  assert.equal(answer.status, 401);
});

test('a country off answers 204 with no body: left out of NATIONAL_FEEDS, no key, or beta-only for a non-beta install', async () => {
  for (const extra of [{NATIONAL_FEEDS: ''}, {NAV_FEED_TOKEN: ''}, {NATIONAL_FEEDS: 'no:beta'}]) {
    const e = {...seeded(), ...extra};
    assert.equal((await ask(e, {country: 'no', q: 'sykepleier'})).status, 204, JSON.stringify(extra));
  }
  assert.equal((await ask({...seeded(), NATIONAL_FEEDS: 'no:beta'}, {country: 'no', q: 'sykepleier'}, {beta: true})).status, 200);
  assert.deepEqual(switches({NATIONAL_FEEDS: 'no:beta, fr', NAV_FEED_TOKEN: 'k'}), {no: 'beta'}, 'a country with no service row, or no key, is never on');
});

test('a role word matches titles in any case, æøå included, newest first, each row linking to its page at NAV', async () => {
  const {body} = await ask(seeded(), {country: 'no', q: 'Sykepleier'});
  assert.equal(body.total, 4);
  assert.deepEqual(body.rows.map(row => row.employer), ['Eksempel Omsorg AS', 'Eksempel Helse AS', 'Eksempel Bergen AS', 'Eksempel AS']);
  assert.deepEqual(Object.keys(body.rows[0]), ['id', 'title', 'employer', 'place', 'date', 'url']);
  assert.deepEqual(body.rows[0], {id: '00000000-0000-4000-8000-000000000002', title: 'SYKEPLEIER natt', employer: 'Eksempel Omsorg AS', place: 'Oslo', date: '2026-11-11',
    url: 'https://arbeidsplassen.nav.no/stillinger/stilling/00000000-0000-4000-8000-000000000002'});
  assert.equal((await ask(seeded(), {country: 'no', q: 'ØKONOMI'})).body.total, 1);
  assert.equal((await ask(seeded(), {country: 'no', q: '50%_'})).body.total, 1, '% and _ are the word, not LIKE wildcards');
  assert.equal((await ask(seeded(), {country: 'no', q: '%'})).body.total, 1);
});

test('a point and radius keep the ads near it; an ad with no point is seen only by a whole-country search', async () => {
  const [lat, lon] = pointOf('no', 'Oslo');
  const near = (await ask(seeded(), {country: 'no', q: 'sykepleier', lat, lon, r: 30})).body;
  assert.deepEqual(near.rows.map(row => row.place), ['Oslo', 'Oslo']);
  const paged = (await ask(seeded(), {country: 'no', q: 'sykepleier', offset: 3})).body;
  assert.deepEqual([paged.total, paged.rows.length], [4, 1]);
  assert.equal(boxOf(NaN, 10, 5), null);
  assert.ok(boxOf(60, 10, 10000)[1] - 60 < 3, 'the radius is capped');
});

test('an install past its daily searches gets 429', async () => {
  const e = seeded();
  e.STATS.db.prepare('INSERT INTO national_use (day, who, n) VALUES (?, ?, ?)').run(new Date().toISOString().slice(0, 10), await (await import('../../../shared/guard.js')).digestOf(INSTALL), PER_INSTALL_PER_DAY);
  assert.equal((await ask(e, {country: 'no', q: 'sykepleier'})).status, 429);
});

test('rowOf keeps only a well-formed ad, and the place table knows Norway\'s municipalities but no shared name', () => {
  assert.equal(rowOf({id: 'nope', title: 'X', changed: '2026-11-10'}), null);
  assert.equal(rowOf({id: '00000000-0000-4000-8000-000000000001', title: '  ', changed: '2026-11-10'}), null);
  assert.equal(rowOf({id: '00000000-0000-4000-8000-000000000001', title: 'X', changed: 'later'}), null);
  assert.deepEqual(Object.keys(rowOf({id: '00000000-0000-4000-8000-00000000000A', title: ' A  b ', changed: '2026-11-10', phone: '+47 000', email: 'x@example.com'})),
    ['id', 'title', 'employer', 'place', 'changed'], 'a contact field is never kept');
  assert.ok(Object.keys(PLACES.places).length >= 357);
  for (const name of ['oslo', 'bergen', 'trondheim', 'tromsø', 'nordre follo']) assert.ok(PLACES.places[name], name);
  for (const name of PLACES.shared) assert.equal(PLACES.places[name], undefined, name);
  assert.ok(PLACES.shared.includes('herøy') && PLACES.shared.includes('våler'));
});
