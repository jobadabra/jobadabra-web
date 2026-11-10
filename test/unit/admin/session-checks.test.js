// The Session checks tab (owner, 24 Oct 2026): the upload (its own key, checks, free text cut), the newest-first read and the tab. Guard for admin/session-checks.js and session-checks-page.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {checks, clean, ingest, ingestRoute, KEEP_CHECKS} from '../../../admin/session-checks.js';
import {page} from '../../../admin/search-lab-page.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const check = (more = {}) => ({session: '4e', case_id: 'nurse-zagreb', label: 'Nurse, Zagreb', country: 'Croatia', role: 'nurse', run_at: '2026-10-24T20:00:00Z', build: '1525fb1', mode: 'full', state: 'ok',
  seconds: 1148, first_s: 77, local_jobs: 24, in_places: 105, scored: 93, fit70: 0, boards: [{name: 'Posao.hr', listed: 95, relevant: 23, note: 'own section'}, {name: 'MojPosao', listed: 33, relevant: 0}],
  broke: 'MojPosao: script-built fields', conclusion: 'Closed for Posao.hr; MojPosao needs the browser path', prs: '#1825 #1835', ...more});

test('a check is stored with its boards, re-uploading replaces it, free text is cut', async () => {
  const {prepare} = d1();
  assert.equal((await ingest({prepare}, [check()])).ok, true);
  await ingest({prepare}, [check({local_jobs: 30, conclusion: '<script>alert(1)</script> fine'})]);
  const rows = await checks({prepare});
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].local_jobs, rows[0].boards.length, rows[0].boards[0].name], [30, 2, 'Posao.hr']);
  assert.doesNotMatch(rows[0].conclusion, /[<>]/);
});

test('bad checks are refused with the first thing wrong', () => {
  assert.match(clean(check({session: 'Igor Mardari'})).error, /session/);
  assert.match(clean(check({run_at: 'yesterday'})).error, /run_at/);
  assert.match(clean(check({mode: 'half'})).error, /mode/);
  assert.match(clean(check({local_jobs: -3})).error, /local_jobs/);
  assert.match(clean(check({boards: [{name: 'X', listed: 'many', relevant: 1}]})).error, /board/);
});

test('the upload needs its own key, not the CI one', async () => {
  const {prepare} = d1(), env = {STATS: {prepare}, SESSION_CHECKS_KEY: 'k', REPLAYS_PUBLISH_KEY: 'ci'};
  const put = (key, body) => ingestRoute(new Request('https://x/search-lab/session-checks', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)}), env);
  assert.equal((await put('ci', {rows: [check()]})).status, 404);
  assert.equal((await put('wrong', {rows: [check()]})).status, 404);
  assert.equal((await put('k', {rows: [check()]})).status, 200);
  assert.equal((await put('k', {rows: []})).status, 400);
});

test('checks are kept newest first, up to KEEP_CHECKS', async () => {
  const {prepare} = d1();
  for (let n = 0; n < 2; n++) await ingest({prepare}, [check({case_id: `case-${n}`, run_at: `2026-10-${10 + n}T10:00:00Z`})]);
  const rows = await checks({prepare});
  assert.deepEqual(rows.map(row => row.case_id), ['case-1', 'case-0']);
  assert.ok(KEEP_CHECKS >= 100);
});

test('the tab shows each check with its boards, what broke and the conclusion', () => {
  const html = page([], 'checks', [], null, [{...check(), boards: check().boards}]);
  assert.match(html, /Session checks/);
  assert.match(html, /Nurse, Zagreb/);
  assert.match(html, /Posao\.hr/);
  assert.match(html, /What broke/);
  assert.match(html, /Conclusion/);
  assert.match(page([], 'checks'), /No session check yet/);
  assert.match(page([], 'checks', [], null, [{...check(), boards: check().boards}]).match(/<style>[\s\S]*?<\/style>/)[0], /\.down\{color:#ff8a80\}/, 'the red "0 relevant" keeps its colour (the Lab page\'s own CSS draws it)');
});
