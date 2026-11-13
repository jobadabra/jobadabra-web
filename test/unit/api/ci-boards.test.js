// The job boards our own CI searches read (api/ci-boards.js), reported as names for the Central Scout: own table, never sitefacts, so no install count, no k >= 3 fact and no served
// number can include CI (owner via sa, 13 Nov 2026, asked via AskUserQuestion: "Any install + our CI searches (Recommended)"). Real SQL on the migrations.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {agreedSites} from '../../../api/employers.js';
import {CI_DAYS} from '../../../api/ci-boards.js';
import {contribute} from '../../../api/pool.js';
import {reportedBoards} from '../../../api/scout-memory.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const d1 = () => {
  const db = new DatabaseSync(':memory:');
  const folder = new URL(existsSync(new URL('../../../db/migrations/', import.meta.url)) ? '../../../db/migrations/' : '../../../ops/db/migrations/', import.meta.url);   // the overlay puts ops/ at the root
  for (const file of readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, folder), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), all: async () => ({results: db.prepare(sql).all(...args)}), run: async () => { db.prepare(sql).run(...args); return {}; },
    first: async () => db.prepare(sql).get(...args), exec: () => db.prepare(sql).run(...args)});
  return {db, prepare: sql => statement(sql), batch: async statements => { for (const one of statements) one.exec(); }};
};
const env = () => ({STATS: d1(), STATS_SALT: 's', WAITLIST: {get: async () => null, put: async () => {}}});
const share = (e, body, install = 'ci-search-43498322357') => contribute(new Request('https://x.test/api/contribute', {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({v: 2, install, ...body})}), e, NOW);
const rows = (e, table) => e.STATS.db.prepare(`SELECT * FROM ${table}`).all();

test('a CI share keeps each (host, country) once, today, in its own table and nothing in sitefacts, contributions or boards', async () => {
  const e = env();
  const answer = await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}, {host: 'trabajo.org', countries: ['es', 'pt', 'xx']}, {host: 'jobeka.es', countries: ['es']}, {host: 'bad host', countries: ['es']}]});
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {ok: true, stored: 3, dropped: {ci_boards: 1}});
  assert.deepEqual(rows(e, 'ci_boards').map(row => `${row.host}|${row.country}|${row.day}`).sort(), ['jobeka.es|es|2026-11-13', 'trabajo.org|es|2026-11-13', 'trabajo.org|pt|2026-11-13']);
  for (const table of ['sitefacts', 'contributions', 'board_reads', 'nofeed']) assert.equal(rows(e, table).length, 0, `${table} untouched`);
  assert.ok(!JSON.stringify(rows(e, 'ci_boards')).includes('43498322357'), 'not even the run id is stored');
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}]}, 'ci-search-another-run');
  assert.equal(rows(e, 'ci_boards').length, 3, 'the same board from another run is the same row');
});

test('CI never raises an installs number or k: the Scout list counts real installs only, marks ci, puts CI-only boards last; apps are served nothing from CI', async () => {
  const e = env();
  e.STATS.db.prepare("INSERT INTO sitefacts (install, day, host, kind, url, body) VALUES ('install-1', '2026-11-12', 'jobeka.es', 'board', 'https://jobeka.es/s?q={role}', ?)").run(JSON.stringify({countries: ['es']}));
  for (const run of ['a', 'b', 'c', 'd']) await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}, {host: 'trabajo.org', countries: ['es']}]}, `ci-search-run-${run}`);
  const list = await reportedBoards(e.STATS, NOW);
  assert.deepEqual(list, [{host: 'jobeka.es', url: 'https://jobeka.es/s?q={role}', countries: ['es'], installs: 1, ci: true}, {host: 'trabajo.org', url: null, countries: ['es'], installs: 0, ci: true}]);
  assert.ok(!/ci-search|install-1|"install"/.test(JSON.stringify(list)), 'no id, real or CI');
  const served = JSON.stringify(await agreedSites({STATS: e.STATS, WAITLIST: e.WAITLIST}));
  assert.ok(!served.includes('trabajo.org'), 'a CI-only board reaches no app');
});

test('a share that fakes the mark gains nothing, and a normal install cannot use the CI door', async () => {
  const e = env();
  assert.equal((await share(e, {ci_boards: []})).status, 400, 'no boards, no row');
  assert.equal((await share(e, {ci_boards: [{host: 'x.example', countries: ['xx']}]})).status, 400);
  const normal = await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}]}, 'a-normal-install-id');
  assert.equal(normal.status, 400, 'an install id without the mark goes the normal way: no feeds, nothing stored');
  assert.equal(rows(e, 'ci_boards').length, 0);
  assert.equal((await share(e, {ci_boards: [{host: 'e2e-test.example', countries: ['es']}]})).status, 400, 'test hosts never enter');
});

test('CI rows older than the window are not served and are dropped on the next share', async () => {
  const e = env();
  e.STATS.db.prepare("INSERT INTO ci_boards (host, country, day) VALUES ('old.example', 'es', ?)").run(new Date(NOW.getTime() - (CI_DAYS + 1) * 86400000).toISOString().slice(0, 10));
  assert.deepEqual(await reportedBoards(e.STATS, NOW), []);
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}]});
  assert.deepEqual(rows(e, 'ci_boards').map(row => row.host), ['jobeka.es']);
});
