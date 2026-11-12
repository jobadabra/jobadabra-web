// Norway's NAV feed kept in D1 (api/national-feed.js) on example pages in the feed's own shape (test/fixtures/nav-feed-pages.json: example names, made-up ids).
// Guard: data/privacy — the stored row holds only the feed page's fields (no contact, no person); a refused key is never sent again; no key, no request.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {FEED, KEEP_DAYS, PAGE_SIZE, isFeedTick, readNorway, sweepNational} from '../../../api/national-feed.js';

const PAGES = JSON.parse(readFileSync(new URL('../../fixtures/nav-feed-pages.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-12T10:25:00Z');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0149_national_ads.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => ({meta: {changes: Number(db.prepare(sql).run(...args).changes)}}),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql), batch: async list => { const out = []; for (const item of list) out.push(await item.run()); return out; }};
}

const env = (extra = {}) => ({NATIONAL_FEEDS: 'no', NAV_FEED_TOKEN: 'example-key', STATS: d1(), ...extra});
const reply = (status, body = null, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {status, headers});

/** A fake feed: answers from `answers` in order and records each request. */
function feed(answers) {
  const asked = [];
  const fetcher = async (url, init) => { asked.push({url, headers: init.headers}); const next = answers.shift(); if (!next) throw new Error('asked more than expected'); return next(); };
  return {asked, fetcher};
}

test('no key, or the country left out of NATIONAL_FEEDS: nothing is asked', async () => {
  for (const e of [env({NAV_FEED_TOKEN: ''}), env({NATIONAL_FEEDS: ''}), env({NATIONAL_FEEDS: 'se'})]) {
    const {asked, fetcher} = feed([]);
    assert.equal((await readNorway(e, {fetcher, now: NOW})).status, 'off');
    assert.equal(asked.length, 0);
  }
});

test('the first fill starts 183 days back, follows next_id to the end and keeps active ads only, the last change winning', async () => {
  const e = env();
  const {asked, fetcher} = feed([() => reply(200, PAGES.first), () => reply(200, PAGES.last, {ETag: 'etag-a6', 'Last-Modified': 'Wed, 11 Nov 2026 07:00:00 GMT'})]);
  const done = await readNorway(e, {fetcher, now: NOW});
  assert.deepEqual({status: done.status, pages: done.pages, skipped: done.skipped}, {status: 'caught-up', pages: 2, skipped: 1});
  assert.equal(asked[0].url, `${FEED}/api/v1/feed?pageSize=${PAGE_SIZE}`);
  assert.equal(asked[0].headers.Authorization, 'Bearer example-key');
  assert.equal(asked[0].headers['If-Modified-Since'], new Date(NOW.getTime() - KEEP_DAYS * 86400000).toUTCString());
  assert.equal(asked[1].url, `${FEED}/api/v1/feed/${PAGES.first.next_id}?pageSize=${PAGE_SIZE}`);
  const rows = e.STATS.db.prepare('SELECT id, title, employer, place, lat, lon FROM national_ads ORDER BY id').all();
  assert.deepEqual(rows.map(row => row.title), ['Sykepleier', 'Butikkmedarbeider', 'Sykepleier natt', 'Ærlig økonomimedarbeider']);   // 4 left: inactive on page 2
  const byTitle = Object.fromEntries(rows.map(row => [row.title, row]));
  assert.equal(byTitle.Sykepleier.place, 'Oslo');
  assert.ok(byTitle.Sykepleier.lat > 59 && byTitle.Sykepleier.lat < 61);
  assert.equal(byTitle['Sykepleier natt'].lat, null, 'Herøy names two municipalities: no point, so only a whole-country search sees it');
  assert.equal(byTitle['Ærlig økonomimedarbeider'].place, 'Nordre Follo');
  const state = e.STATS.db.prepare('SELECT page, etag, modified, caught_up FROM national_feeds').get();
  assert.deepEqual({...state}, {page: PAGES.last.id, etag: 'etag-a6', modified: 'Wed, 11 Nov 2026 07:00:00 GMT', caught_up: 1});
});

test('an ad sent again with the same title and date but a corrected employer or municipality is rewritten, point included (Gitar on #573)', async () => {
  const e = env();
  await readNorway(e, {fetcher: feed([() => reply(200, PAGES.last)]).fetcher, now: NOW});
  const again = structuredClone(PAGES.last);
  Object.assign(again.items[0]._feed_entry, {businessName: 'Eksempel Regnskap Oslo AS', municipal: 'OSLO'});
  await readNorway({...e}, {fetcher: feed([() => reply(200, again)]).fetcher, now: NOW});
  const row = e.STATS.db.prepare('SELECT employer, place, lat FROM national_ads WHERE id = ?').get('00000000-0000-4000-8000-000000000005');
  assert.deepEqual([row.employer, row.place], ['Eksempel Regnskap Oslo AS', 'Oslo']);
  assert.ok(row.lat > 59.5 && row.lat < 60.5, 'the new municipality\'s point');
});

test('a stored ad has exactly the feed page fields: no contact, no description, no person', async () => {
  const e = env();
  const {fetcher} = feed([() => reply(200, PAGES.last)]);
  await readNorway(e, {fetcher, now: NOW});
  const columns = e.STATS.db.prepare('PRAGMA table_info(national_ads)').all().map(column => column.name);
  assert.deepEqual(columns, ['country', 'id', 'title', 'employer', 'place', 'lat', 'lon', 'changed', 'find']);
});

test('an hour with no change is a 304: the stored ETag and Last-Modified are sent and nothing is written', async () => {
  const e = env();
  await readNorway(e, {fetcher: feed([() => reply(200, PAGES.last, {ETag: 'etag-a6', 'Last-Modified': 'Wed, 11 Nov 2026 07:00:00 GMT'})]).fetcher, now: NOW});
  const {asked, fetcher} = feed([() => reply(304)]);
  const done = await readNorway(e, {fetcher, now: new Date(NOW.getTime() + 3600000)});
  assert.deepEqual({status: done.status, written: done.written}, {status: 'caught-up', written: 0});
  assert.equal(asked[0].url, `${FEED}/api/v1/feed/${PAGES.last.id}?pageSize=${PAGE_SIZE}`);
  assert.deepEqual([asked[0].headers['If-None-Match'], asked[0].headers['If-Modified-Since']], ['etag-a6', 'Wed, 11 Nov 2026 07:00:00 GMT']);
});

test('a 401 or 403 stops the read and that key is never sent again; a new key is', async () => {
  for (const code of [401, 403]) {
    const e = env();
    assert.equal((await readNorway(e, {fetcher: feed([() => reply(code)]).fetcher, now: NOW})).status, 'refused');
    const again = feed([]);
    assert.equal((await readNorway(e, {fetcher: again.fetcher, now: NOW})).status, 'refused');
    assert.equal(again.asked.length, 0, `the refused key is not sent again after a ${code}`);
    const fresh = feed([() => reply(200, PAGES.last)]);
    assert.equal((await readNorway({...e, NAV_FEED_TOKEN: 'another-example-key'}, {fetcher: fresh.fetcher, now: NOW})).status, 'caught-up');
  }
});

test('a 429 ends this hour\'s read without a retry', async () => {
  const {asked, fetcher} = feed([() => reply(429, null, {'Retry-After': '60'})]);
  assert.equal((await readNorway(env(), {fetcher, now: NOW})).status, 'slowed');
  assert.equal(asked.length, 1);
});

test('the read runs once an hour, and the daily sweep drops ads past 6 months', async () => {
  assert.deepEqual([0, 10, 25, 30, 55].map(minute => isFeedTick(new Date(Date.UTC(2026, 10, 12, 4, minute)))), [false, false, true, false, false]);
  const e = env();
  await readNorway(e, {fetcher: feed([() => reply(200, PAGES.last)]).fetcher, now: NOW});
  assert.equal(await sweepNational(e, new Date('2027-06-01T00:00:00Z')), 1);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM national_ads').get().n, 0);
});
