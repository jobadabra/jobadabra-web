// The weekly reference of the nightly Search check (owner, 6 Nov 2026: "how to know if it's a good or bad result?"): the upload (key, shape, week, size), what is kept (the latest week, counts only, "not read" stays null,
// never 0) and what the Night search tab shows from it. Guard for admin/search-reference.js and its route in workers/www/index.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {reference} from '../../../../admin/search-night.js';
import {MAX_BYTES, MAX_PERSONAS, clean, ingestRoute, isoWeek} from '../../../../admin/search-reference.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {clean as cleanNight} from '../../../../admin/search-night.js';
import {nightSection} from '../../../../admin/search-night-page.js';
import worker from '../../../../workers/www/index.js';

const NOW = new Date('2026-11-06T09:00:00Z'), KEY = 'search-lab-key-0123456789';
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), REPLAYS_PUBLISH_KEY: KEY});
const counts = (total, reachable, eures, google) => ({total, reachable, eures, google, market: null, countedOn: '', sources: {}});   // the market fields (admin/search-market.js) of a record that sends none
const body = (personas = {1: counts(31, 24, 20, 17), 3: counts(14, 14, 14, null)}) => ({personas});
const put = (e, payload, {week = '2026-W45', key = KEY, at = NOW} = {}) => ingestRoute(new Request(`https://www.jobadabra.top/search-check/reference${week ? `?week=${week}` : ''}`, {method: 'PUT', headers: key ? {Authorization: `Bearer ${key}`} : {}, body: typeof payload === 'string' ? payload : JSON.stringify(payload)}), e, at);

test('a wrong or missing key and a missing store are a plain 404; nothing is stored', async () => {
  const e = env();
  assert.equal((await put(e, body(), {key: ''})).status, 404);
  assert.equal((await put(e, body(), {key: 'wrong'})).status, 404);
  assert.equal((await put({...e, STATS: undefined}, body())).status, 404);
  assert.deepEqual(await reference(e), {});
});

test('the week is stored and read back as the tab reads it; a source that was not read stays null, never 0', async () => {
  const e = env(), answer = await put(e, body());
  assert.deepEqual([answer.status, await answer.json()], [200, {ok: true, week: '2026-W45', stored: true, personas: 2}]);
  assert.deepEqual(await reference(e), {1: counts(31, 24, 20, 17), 3: counts(14, 14, 14, null)});
});

test('the tab shows the reference per candidate: separate totals when EURES alone was read (the owner\'s choice), the older "reachable" note when Google Jobs was too', async () => {
  const e = env();
  await put(e, body());
  const night = cleanNight({state: 'success', head: '🟢 measured 2 of 2', rows: [{persona: 1, label: 'p1 A', kind: 'measured', local: 7, found: 9}, {persona: 3, label: 'p3 B', kind: 'measured', local: 5, found: 6}]}, {night: '2026-11-06'});
  const html = nightSection(judgeAll([night]), await reference(e));
  assert.match(html, /Reference: 31<div class="why">24 reachable · EURES 20 · Google Jobs 17</);
  assert.match(html, /EURES reference: 14/);
  assert.doesNotMatch(html.match(/EURES reference: 14[^<]*<\/td>/)[0], /Google|reachable/, 'no Google figure where Google was not read');
  assert.match(nightSection(judgeAll([night]), {1: counts(31, 24, 20, 0)}), /Reference: 31<div class="why">24 reachable · EURES 20 · Google Jobs 0</, 'a Google figure of 0 is a figure: the older note stays');
});

test('a stored total of 0 reads "EURES lists none", not as a failed read; a candidate with no record stays "no reference yet" (owner/coordinator, 6 Nov 2026)', async () => {
  const e = env();
  await put(e, body({1: counts(0, 0, 0, null), 3: counts(14, 14, 14, null)}));
  const refs = await reference(e);
  assert.deepEqual(refs[1], counts(0, 0, 0, null), 'a zero is stored as 0');
  const night = cleanNight({state: 'success', head: '🟢 measured 3 of 3', rows: [1, 2, 3].map(persona => ({persona, label: `p${persona} X`, kind: 'measured', local: 4, found: 5}))}, {night: '2026-11-06'});
  const html = nightSection(judgeAll([night]), refs);
  const cell = label => html.match(new RegExp(`<b>${label} X</b>.*?</tr>`, 's'))[0];
  assert.match(cell('p1'), /EURES lists none/);
  assert.doesNotMatch(cell('p1'), /no reference/);
  assert.match(cell('p2'), /no reference yet/, 'no record at all');
  assert.match(cell('p3'), /EURES reference: 14/);
  assert.match(nightSection(judgeAll([night]), {1: counts(0, 0, null, 0)}), /p1 X<\/b>.*?no reference<\/span>/s, 'a total of 0 that is not EURES\'s own count claims nothing');
});

test('the latest week replaces the one before, and an older week never replaces a newer one', async () => {
  const e = env();
  await put(e, body({1: counts(10, 8, 6, 5)}), {week: '2026-W44'});
  await put(e, body({1: counts(31, 24, 20, 17)}), {week: '2026-W45'});
  assert.deepEqual(await reference(e), {1: counts(31, 24, 20, 17)});
  const old = await (await put(e, body({1: counts(1, 1, 1, 1)}), {week: '2026-W43'})).json();
  assert.deepEqual([old.stored, (await reference(e))[1].total], [false, 31]);
});

test('the week defaults to this one (UTC) and ISO weeks cross the year the way CI counts them', async () => {
  const e = env();
  assert.equal((await (await put(e, body(), {week: ''})).json()).week, '2026-W45');
  assert.deepEqual(['2026-11-06', '2026-01-01', '2027-01-01', '2024-12-30', '2026-12-31'].map(day => isoWeek(new Date(`${day}T12:00:00Z`))), ['2026-W45', '2026-W01', '2026-W53', '2025-W01', '2026-W53']);
});

test('what is refused: a bad or future week, bad counts, reachable over total, no total, too many or badly numbered personas, a non-JSON body, an oversized body', async () => {
  const e = env(), bad = async (payload, options) => (await put(e, payload, options)).status;
  assert.equal(await bad(body(), {week: '2026-45'}), 400);
  assert.equal(await bad(body(), {week: '2026-W54'}), 400);
  assert.equal(await bad(body(), {week: '2026-W00'}), 400);
  assert.equal(await bad(body(), {week: '2026-W52'}), 400, 'a future week');
  assert.equal(await bad(body(), {week: '2026-W46'}), 400, 'next week: a skewed clock would store it and answer the real week "not stored"');
  for (const row of [counts(-1, 0, 0, 0), counts(1.5, 1, 1, 1), counts('9', 1, 1, 1), counts(5, 6, 1, 1), counts(null, 1, 1, 1), counts(5, null, 1, 1), {reachable: 1}, 'x', [counts(1, 1, 1, 1)], counts(1e9, 0, 0, 0)]) assert.equal(await bad({personas: {1: row}}), 400, JSON.stringify(row));
  for (const personas of [{}, [], null, 'x', {0: counts(1, 1, 1, 1)}, {'01': counts(1, 1, 1, 1)}, {abc: counts(1, 1, 1, 1)}, {100: counts(1, 1, 1, 1)}, Object.fromEntries(Array.from({length: MAX_PERSONAS + 1}, (_, index) => [index + 1, counts(1, 1, 1, 1)]))]) assert.equal(await bad({personas}), 400, JSON.stringify(personas)?.slice(0, 40));
  assert.equal(await bad('not json'), 400);
  assert.equal((await put(e, ' '.repeat(MAX_BYTES + 1))).status, 413);
  assert.deepEqual(await reference(e), {}, 'nothing refused was stored');
  assert.deepEqual(clean(body(), {week: '2026-W45', run: 'abc'}, NOW), {error: 'run is the number of the workflow run'});
});

test('only counts are kept: a text field in the body is dropped, not stored', async () => {
  const e = env();
  await put(e, {personas: {1: {...counts(3, 2, 2, 1), title: 'Truck Driver at ACME', link: 'https://x.test/job/1'}}});
  const stored = JSON.stringify(JSON.parse((await e.STATS.prepare('SELECT body FROM ci_state WHERE key = ?').bind('search-reference').first()).body));
  assert.doesNotMatch(stored, /ACME|x\.test|Truck/);
});

test('the Worker serves the route: PUT with the key stores, without it is a 404, and only PUT stores', async () => {
  const e = env();
  const call = (method, headers = {}, payload) => worker.fetch(new Request('https://www.jobadabra.top/search-check/reference?week=2026-W45', {method, headers, body: payload}), {...e, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset', {status: 404})}}, {waitUntil() {}});
  assert.equal((await call('PUT', {}, JSON.stringify(body()))).status, 404);
  assert.equal((await call('PUT', {Authorization: `Bearer ${KEY}`}, JSON.stringify(body()))).status, 200);
  assert.equal(Object.keys(await reference(e)).length, 2);
  assert.notEqual((await call('GET', {Authorization: `Bearer ${KEY}`})).status, 200, 'only PUT stores');
});
