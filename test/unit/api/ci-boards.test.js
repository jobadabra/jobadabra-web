// The job boards our own CI searches read (api/ci-boards.js), reported as names for the Central Scout: own table, never sitefacts, so no install count, no k >= 3 fact and no served
// number can include CI (owner via sa, 13 Nov 2026, asked via AskUserQuestion: "Any install + our CI searches (Recommended)"). Real SQL on the migrations.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {agreedSites} from '../../../api/employers.js';
import {CI_DAYS, DAILY_ROWS, MAX_CI_BOARDS, MAX_COUNTRIES, MAX_LOCAL, PER_HOUR} from '../../../api/ci-boards.js';
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
const kvStore = () => { const kept = new Map(); return {kept, get: async key => kept.get(key) ?? null, put: async (key, value) => { kept.set(key, value); }}; };
const env = () => ({STATS: d1(), STATS_SALT: 's', WAITLIST: kvStore()});
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
  assert.deepEqual(list, [{host: 'jobeka.es', url: 'https://jobeka.es/s?q={role}', countries: ['es'], installs: 1, local: 0, ci: true}, {host: 'trabajo.org', url: null, countries: ['es'], installs: 0, local: 0, ci: true}]);
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

// Gitar on web #643: the door is public and the id can be rotated, so the limits sit on one fixed bucket, and the Scout reads every CI row.
test('the CI door is bounded: hosts and countries per share, shares per hour and rows per day, whatever the id', async () => {
  const e = env();
  const many = Array.from({length: MAX_CI_BOARDS + 20}, (_, n) => ({host: `h${n}.example`, countries: ['es', 'pt', 'fr', 'de', 'it']}));
  assert.equal((await share(e, {ci_boards: many})).status, 200);
  assert.equal(rows(e, 'ci_boards').length, MAX_CI_BOARDS * MAX_COUNTRIES, 'at most 150 hosts and 3 countries each');
  const f = env();
  for (let n = 0; n < PER_HOUR; n++) assert.equal((await share(f, {ci_boards: [{host: `a${n}.example`, countries: ['es']}]}, `ci-search-rotating-${n}`)).status, 200);
  assert.equal((await share(f, {ci_boards: [{host: 'late.example', countries: ['es']}]}, 'ci-search-yet-another')).status, 429, 'a rotated id does not get a new bucket');
  const g = env();
  const insert = g.STATS.db.prepare("INSERT INTO ci_boards (host, country, day) VALUES (?, 'es', '2026-11-13')");
  for (let n = 0; n < DAILY_ROWS; n++) insert.run(`d${n}.example`);
  assert.equal((await share(g, {ci_boards: [{host: 'over.example', countries: ['es']}]})).status, 429, 'the day\'s row cap holds');
  assert.equal(rows(g, 'ci_boards').length, DAILY_ROWS, 'nothing was evicted or added');
});

test('the Scout reads every CI row: the last host keeps all its countries past 1500 rows', async () => {
  const e = env();
  const insert = e.STATS.db.prepare("INSERT INTO ci_boards (host, country, day) VALUES (?, ?, '2026-11-12')");
  for (let n = 0; n < 1498; n++) insert.run(`a${String(n).padStart(4, '0')}.example`, 'es');
  for (const country of ['es', 'pt', 'fr']) insert.run('zzz.example', country);   // rows 1499-1501: a row limit of 1500 would cut its third country
  const list = await reportedBoards(e.STATS, NOW);
  assert.equal(list.length, 1499);
  assert.deepEqual(list.at(-1), {host: 'zzz.example', url: null, countries: ['es', 'fr', 'pt'], installs: 0, local: 0, ci: true});
});

// Why (13 Nov 2026, owner via sa): ties between reported boards are ordered by the jobs the search kept from them (`local`), so the Scout reads Jobeka (19) before an alphabetical neighbour.
const localsOf = e => Object.fromEntries(rows(e, 'ci_boards').map(row => [`${row.host}|${row.country}`, row.local]));
test('local is a count: stored as sent, anything else is 0, over the cap is 0, never a rejected share', async () => {
  const e = env();
  const item = (host, local) => ({host, countries: ['es'], local});
  const answer = await share(e, {ci_boards: [item('a.example', 19), item('b.example', '19'), item('c.example', -3), item('d.example', 4.5), item('e.example', MAX_LOCAL + 1), item('f.example', MAX_LOCAL),
    item('g.example', null), {host: 'h.example', countries: ['es']}, item('i.example', {n: 5})]});
  assert.equal(answer.status, 200);
  assert.deepEqual(localsOf(e), {'a.example|es': 19, 'b.example|es': 0, 'c.example|es': 0, 'd.example|es': 0, 'e.example|es': 0, 'f.example|es': MAX_LOCAL, 'g.example|es': 0, 'h.example|es': 0, 'i.example|es': 0});
});

test('the highest local seen is kept: a higher one replaces a lower, a lower or missing one never does, also inside one share', async () => {
  const e = env();
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es'], local: 5}, {host: 'jobeka.es', countries: ['es'], local: 9}, {host: 'jobeka.es', countries: ['es'], local: 2}]});
  assert.equal(localsOf(e)['jobeka.es|es'], 9, 'the highest of one share');
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es'], local: 3}]}, 'ci-search-run-2');
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es']}]}, 'ci-search-run-3');
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es'], local: 'many'}]}, 'ci-search-run-4');
  assert.equal(localsOf(e)['jobeka.es|es'], 9, 'a lower, missing or unreadable count never replaces it');
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es'], local: 19}]}, 'ci-search-run-5');
  assert.equal(localsOf(e)['jobeka.es|es'], 19, 'a higher one replaces it');
  assert.equal(rows(e, 'ci_boards').length, 1);
});

test('the Scout list carries local: the most over the host\'s rows for a CI board, 0 for an installs-only board, and still no id', async () => {
  const e = env();
  e.STATS.db.prepare("INSERT INTO sitefacts (install, day, host, kind, url, body) VALUES ('install-1', '2026-11-12', 'plain.example', 'board', 'https://plain.example/s?q={role}', ?)").run(JSON.stringify({countries: ['es']}));
  e.STATS.db.prepare("INSERT INTO sitefacts (install, day, host, kind, url, body) VALUES ('install-1', '2026-11-12', 'both.example', 'board', 'https://both.example/s?q={role}', ?)").run(JSON.stringify({countries: ['es']}));
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['es', 'pt'], local: 19}, {host: 'both.example', countries: ['es'], local: 7}]});
  await share(e, {ci_boards: [{host: 'jobeka.es', countries: ['pt'], local: 4}, {host: 'trabajo.org', countries: ['es']}]}, 'ci-search-run-2');
  const byHost = Object.fromEntries((await reportedBoards(e.STATS, NOW)).map(board => [board.host, board.local]));
  assert.deepEqual(byHost, {'plain.example': 0, 'both.example': 7, 'jobeka.es': 19, 'trabajo.org': 0});
  assert.ok(!/ci-search|install-1|"install"/.test(JSON.stringify(await reportedBoards(e.STATS, NOW))));
});
