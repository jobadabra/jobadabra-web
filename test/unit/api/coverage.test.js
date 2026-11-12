// GET /api/coverage: the website's public numbers (owner, 20 Oct 2026: "share some interesting stats ... how many jobs, what industries,
// what locations"), from the central list's daily snapshot. Counts only: never an employer, never anything from an install.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../../../workers/www/index.js';
import {snapshot, storeSnapshot} from '../../../shared/scouting-snapshot.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0029_index_daily.sql', '0099_scouting_history.sql']) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {prepare: sql => statement(sql), exec: sql => db.exec(sql)};
}
const feed = (i, kind, countries, jobs = 10) => ({company: `Secret Employer ${i}`, ats: 'lever', slug: `secret${i}`, kinds: {[kind]: 0.9}, countries, jobs});
const kv = values => ({get: async key => values[key] ?? null});
const get = env => worker.fetch(new Request('https://www.jobadabra.top/api/coverage'), env, {});

test('the coverage numbers: employers, open jobs in Europe, countries and kinds from the latest snapshot, the week\'s growth, no names', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-13', snapshot([feed(1, 'software', ['de'])]));
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de']), feed(2, 'healthcare', ['fr', 'de'], 4), feed(3, 'other', ['pl']),
    feed(4, 'logistics', ['us'])]));
  const res = await get({STATS, WAITLIST: kv({'index:summary': JSON.stringify({employers: 5, jobs: 24})})});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control'), /public, max-age=3600/);
  const {heat, ...body} = await res.json();
  assert.match(heat.table, /<table class="heat">/);
  // employers and jobs: the landing's summary of the latest publish (each employer's jobs once); the rest from the snapshot
  assert.deepEqual(body, {day: '2026-10-20', employers: 5, jobs: 24, country_count: 3, week_added: 3,
    countries: [['Germany', 2], ['France', 1], ['Poland', 1]],
    kinds: [['Healthcare', 2], ['Software & IT', 1]], other_kinds: 1});
  assert.doesNotMatch(JSON.stringify(body), /Secret|lever|secret/, 'never an employer');
});

test('before any snapshot, or without the database: 404, and the pages keep their written numbers', async () => {
  assert.equal((await get({STATS: d1()})).status, 404);
  assert.equal((await get({})).status, 404);
});

test('a week of history is needed for the growth; without it the field is left out', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de'])]));
  assert.equal((await (await get({STATS})).json()).week_added, undefined);
});

test('without the summary the employers come from the snapshot and jobs are left out (never a sum that counts an employer twice)', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de']), feed(2, 'healthcare', ['fr', 'de'], 4)]));
  const body = await (await get({STATS, WAITLIST: kv({})})).json();
  assert.equal(body.employers, 2);
  assert.equal(body.jobs, undefined);
  assert.equal(body.jobs_europe, undefined);
});

// The owner's heatmap on /coverage (27 Oct 2026: "let's publish this graph"), drawn by the admin's renderer in its public cut.
test('the public heat table: counts and the week\'s change only, every field biggest first (Software & IT among them), no jobs, installs, floors or AI aim', async () => {
  const STATS = d1();
  await storeSnapshot(STATS, '2026-10-13', snapshot([feed(1, 'healthcare', ['pl'])]));
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'healthcare', ['pl']), feed(2, 'healthcare', ['pl'], 7), feed(3, 'software', ['de']),
    {company: 'Secret New', ats: 'lever', slug: 'secretnew', countries: ['fr'], jobs: 3}]));
  const {heat} = await (await get({STATS})).json();
  assert.match(heat.table, /data-tip="Healthcare · Poland: 2 employers · \+1 this week"/);
  assert.match(heat.table, /<th class="kind" scope="row">Field not sorted yet<\/th>/);
  assert.match(heat.table, /<th class="kind" scope="row">Several fields<\/th>/);
  assert.match(heat.table, /class="h\d"/, 'colour steps as classes the site paints');
  assert.doesNotMatch(heat.table, /style=|tabindex|open jobs|install|short of|aim|Not counted|Secret|secret|lever/);
  assert.match(heat.legend, /^Employers: <i class="h0"><\/i>0/);
  const rows = [...heat.table.matchAll(/scope="row">([^<]+)</g)].map(match => match[1]);
  assert.ok(rows.indexOf('Healthcare') < rows.indexOf('Logistics'), 'the fields biggest first');
  assert.ok(rows.indexOf('Healthcare') < rows.indexOf('Software &amp; IT') && rows.indexOf('Software &amp; IT') < rows.indexOf('Logistics'),
    'Software & IT is sorted by its size like every field (owner, 27 Oct 2026), not pinned last');
  assert.match(heat.table, /<td class="hn" data-tip="Field not sorted yet · France: 1 employer/, 'not sorted yet in one neutral, off the amber scale');
  assert.deepEqual(rows.slice(-2), ['Several fields', 'Field not sorted yet']);
});

test('job boards across Europe: totals and the map in its public cut; never a board host or brand (owner, 12 Nov 2026: "not disclose our intellectual property")', async () => {
  const STATS = d1();
  STATS.exec('CREATE TABLE sitefacts (install TEXT, day TEXT, host TEXT, kind TEXT, url TEXT, body TEXT, in_places INTEGER, fit70 INTEGER, countries TEXT, families TEXT, UNIQUE (install, host, kind))');   // the columns api/employers.js writes
  await storeSnapshot(STATS, '2026-10-20', snapshot([feed(1, 'software', ['de'])]));
  for (const [host, country] of [['secretboard.at', 'at'], ['secretboard.es', 'es'], ['hiddenjobs.fr', 'fr']])
    await STATS.prepare(`INSERT INTO sitefacts (install, day, host, kind, url, body, in_places, fit70, countries, families) VALUES (?, '2026-10-20', ?, 'board', ?, '{}', 9, 0, ?, 'medical')`)
      .bind(`central-scout-${country}`, host, `https://${host}/jobs?q={role}`, country).run();
  const {boards} = await (await get({STATS})).json();
  assert.equal(boards.local, 1);
  assert.equal(boards.multi, 1);
  assert.equal(boards.countries, 3);
  assert.match(boards.map, /class="reach-map"/);
  assert.doesNotMatch(JSON.stringify(boards), /secretboard|hiddenjobs|jobs\?q/);
});
