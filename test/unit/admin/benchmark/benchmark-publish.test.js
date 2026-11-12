// "Publish to website" (admin/benchmark-publish.js; owner, 12 Nov 2026): the public /benchmark shows ONLY what the owner published; the form table counts the forms every tool ran and says which one was left out;
// the press is owner-only, same-origin and two-step; "Unpublish" brings back the round before, then the starting snapshot. Fake D1 with the real migrations. Names are made up.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {fairSummary} from '../../../../admin/benchmark-fair.js';
import {formsSection, mergeResults, publishPress, results, searchSection, state} from '../../../../admin/benchmark-publish.js';
import {page as formPage} from '../../../../admin/benchmark-page.js';
import {summarize as searchSummarize} from '../../../../admin/benchmark-search-data.js';
import {page as searchPage} from '../../../../admin/benchmark-search-page.js';
import {buildSnapshot as formSnapshot} from '../../../../admin/benchmark.js';
import {buildSnapshot as searchSnapshot} from '../../../../admin/benchmark-search.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const ORIGIN = 'https://www.jobadabra.top';
const setup = () => ({STATS: d1(), STATS_SALT: 's', STATS_KEY: 'k3y', STATS_API_KEY: 'owner-key', ASSETS: {fetch: async () => new Response(JSON.stringify({schema: 1, date: '2026-10-27', search: {tools: [{name: 'Old'}], personas: [], verdictsUrl: 'https://old'}, forms: {tools: [{name: 'Old'}], runId: '1', productBuild: 'old'}}))}});
const fair = (tool, form, right, wrong, empty, unreached, ours = 0) => ({id: `fixed/${form}/${tool}`, at: '2026-11-12T10:00:00Z', applicant: 'thin', mode: ours ? 'user' : 'any', round: 'fixed', rep: 1, tool, ours, build: ours ? 'b7' : '', form, heldout: 0, fixes: '',
  required: right + wrong + empty, right, wrong, empty, unans: 0, holds: 0, dups: 0, unreached});
const FORM_ROWS = [fair('Ours', '101', 9, 1, 0, 0, 1), fair('Ours', '102', 10, 0, 0, 0, 1), fair('Ours', '105', 8, 1, 1, 0, 1),   // ours never ran 104 (a bot check)
  fair('Tool X', '101', 8, 1, 1, 0), fair('Tool X', '102', 9, 0, 1, 0), fair('Tool X', '104', 5, 0, 5, 0), fair('Tool X', '105', 6, 2, 2, 0)];
const insert = (env, rows) => { for (const r of rows) env.STATS.db.prepare('INSERT INTO benchmark_runs (id, at, applicant, mode, tool, ours, build, form, heldout, fixes, required, right, wrong, empty, unans, holds, dups, round, rep, unreached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(r.id, r.at, r.applicant, r.mode, r.tool, r.ours, r.build, r.form, r.heldout, r.fixes, r.required, r.right, r.wrong, r.empty, r.unans, r.holds, r.dups, r.round, r.rep, r.unreached); };
const seed = async env => {
  insert(env, FORM_ROWS);
  const snap = await formSnapshot(env.STATS); await env.STATS.prepare('INSERT INTO benchmark_snapshot (id, at, body) VALUES (1, ?, ?)').bind(snap.at, JSON.stringify(snap)).run();
  const runs = [['Ours', 1, [20, 10]], ['Ours with every source', 0, [30, 15]], ['Tool A', 0, [12, 6]]].flatMap(([tool, ours, found]) => ['Nurse · Town', 'Cook · Port'].map((persona, i) => ({id: `${tool}/${i}`, at: '2026-11-12T10:00:00Z', round: '2026-11-12', persona, kind: 'non-tech', country: 'Land', tool, ours,
    build: ours ? 'b7' : '', found: found[i], place: found[i] - 1, role: found[i] - 2, relevant: found[i] - 3, employers: 3, seconds: 0, cents: 0, missed: '{}', beyond: tool === 'Ours with every source' ? '{"Tool A": 4}' : '{}'})));
  for (const r of runs) env.STATS.db.prepare('INSERT INTO benchmark_search_runs (id, at, round, persona, kind, country, tool, ours, build, found, place, role, relevant, employers, seconds, cents, missed, beyond) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.at, r.round, r.persona, r.kind, r.country, r.tool, r.ours, r.build, r.found, r.place, r.role, r.relevant, r.employers, r.seconds, r.cents, r.missed, r.beyond);
  const ss = await searchSnapshot(env.STATS); await env.STATS.prepare('INSERT INTO benchmark_search_snapshot (id, at, body) VALUES (1, ?, ?)').bind(ss.at, JSON.stringify(ss)).run();
};
const press = (env, fields, {path = '/admin/form-filling/benchmark/publish', headers = {Authorization: 'Bearer owner-key', Origin: ORIGIN}} = {}) => publishPress(new Request(`${ORIGIN}${path}`, {method: 'POST', headers, body: new URLSearchParams(fields)}), env);
const publicNow = async env => (await (await results(new Request(`${ORIGIN}/benchmark-results.json`), env)).json());

test('the form table counts only the forms every tool ran, says which was left out and for whom, and the owner\'s words travel with it', () => {
  const section = formsSection('fixed', fairSummary(FORM_ROWS.map(r => ({...r}))).rounds.fixed, 'Ashby bot check');
  assert.deepEqual(section.forms, ['101', '102', '105']);
  assert.deepEqual(section.leftOut, [{form: '104', tools: ['Jobadabra'], why: 'Ashby bot check'}]);
  const ours = section.tools.find(t => t.name === 'Jobadabra'), x = section.tools.find(t => t.name === 'Tool X');
  assert.deepEqual([ours.right, ours.wrong, ours.empty, ours.score, ours.forms], [27, 2, 1, 90, 3]);   // form 104's 5 right of Tool X do not count
  assert.deepEqual([x.right, x.wrong, x.empty, x.score], [23, 3, 4, 76.7]);
  assert.equal(section.productBuild, 'b7');
  assert.deepEqual(section.tools.map(t => t.name), ['Jobadabra', 'Tool X'], 'best score first');
});

test('a search round publishes ours (rivals\' sources off) and every rival, never the "with every source" line, with absent splits as null not zero', async () => {
  const env = setup(); await seed(env);
  const snap = await searchSnapshot(env.STATS), part = searchSection('2026-11-12', snap.rounds['2026-11-12'], snap.at);
  assert.deepEqual(part.tools.map(t => t.name), ['Jobadabra', 'Tool A']);
  assert.deepEqual([part.tools[0].found, part.tools[0].relevant, part.tools[0].remote, part.tools[0].observedPersonas], [30, 24, null, 2]);
  assert.equal(part.date, '2026-11-12');
  assert.deepEqual(part.personas.map(p => [p.title, p.city]), [['Cook', 'Port'], ['Nurse', 'Town']]);
  assert.equal(part.returnedRows, 48);
});

test('nothing is public until the owner presses; the first press only asks, the second stores, and /benchmark-results.json then serves it over the starting snapshot', async () => {
  const env = setup(); await seed(env);
  assert.equal((await publicNow(env)).forms.runId, '1', 'before: the starting snapshot');
  const ask = await press(env, {kind: 'form', round: 'fixed', action: 'publish', note: 'Ashby bot check'});
  assert.equal(ask.status, 303); assert.match(ask.headers.get('Location'), /confirm=publish&note=Ashby%20bot%20check#publish$/);
  assert.equal((await publicNow(env)).forms.runId, '1', 'a first press changes nothing');
  assert.equal((await press(env, {kind: 'form', round: 'fixed', action: 'publish', confirmed: '1', note: 'Ashby bot check'})).status, 303);
  const now = await publicNow(env);
  assert.equal(now.forms.round, 'fixed'); assert.equal(now.forms.runId, undefined, 'a published section replaces the starting one whole'); assert.equal(now.forms.leftOut[0].why, 'Ashby bot check');
  assert.equal(now.search.verdictsUrl, 'https://old', 'the search section is still the starting one');
  assert.equal(now.published.form.round, 'fixed');
});

test('unpublish brings back the round before, then the starting snapshot', async () => {
  const env = setup(); await seed(env);
  await press(env, {kind: 'search', round: '2026-11-12', action: 'publish', confirmed: '1'}, {path: '/admin/job-search/benchmark/publish'});
  assert.equal((await publicNow(env)).search.round, '2026-11-12');
  await press(env, {kind: 'search', round: '2026-11-12', action: 'publish', confirmed: '1'}, {path: '/admin/job-search/benchmark/publish'});
  assert.equal((await state(env.STATS)).search.before.round, '2026-11-12');
  await press(env, {kind: 'search', round: '2026-11-12', action: 'unpublish'}, {path: '/admin/job-search/benchmark/publish'});
  assert.equal((await publicNow(env)).search.round, '2026-11-12', 'one published round is left');
  await press(env, {kind: 'search', round: '2026-11-12', action: 'unpublish'}, {path: '/admin/job-search/benchmark/publish'});
  assert.equal((await publicNow(env)).search.verdictsUrl, 'https://old', 'none left: the starting snapshot');
});

test('only the owner, from the site itself, and only for a round that exists; the section is rebuilt from stored rows, not taken from the form', async () => {
  const env = setup(); await seed(env);
  const fields = {kind: 'form', round: 'fixed', action: 'publish', confirmed: '1'};
  assert.equal((await press(env, fields, {headers: {Origin: ORIGIN}})).status, 404, 'no key');
  assert.equal((await press(env, fields, {headers: {Authorization: 'Bearer owner-key', Origin: 'https://evil.example'}})).status, 404, 'wrong origin');
  assert.equal((await press(env, {...fields, kind: 'search'})).status, 400, 'the path and the kind must agree');
  assert.equal((await press(env, {...fields, round: 'week-2026-W99'})).status, 404);
  const forged = await press(env, {...fields, body: '{"tools":[]}', tools: 'x'});
  assert.equal(forged.status, 303);
  assert.ok((await publicNow(env)).forms.tools.length >= 2, 'the stored rows decide what is public');
  assert.equal(env.STATS.db.prepare('SELECT COUNT(*) AS n FROM benchmark_published').get().n, 1);
});

test('the Admin pages show what is public now, the button, and on the first press exactly what the public page will say', async () => {
  const env = setup(); await seed(env);
  const snap = JSON.parse(env.STATS.db.prepare('SELECT body FROM benchmark_snapshot WHERE id = 1').get().body), published = await state(env.STATS);
  const plain = formPage(snap, {published}), ask = formPage(snap, {published, confirm: 'publish', note: 'Ashby bot check'});
  assert.match(plain, /starting snapshot of 27 Oct 2026/); assert.match(plain, /Publish to website/); assert.doesNotMatch(plain, /The public page will say/);
  assert.match(ask, /The public page will say/); assert.match(ask, /Form 104 not run for Jobadabra \(Ashby bot check\)/); assert.match(ask, /Publish now/);
  const ss = JSON.parse(env.STATS.db.prepare('SELECT body FROM benchmark_search_snapshot WHERE id = 1').get().body);
  assert.match(searchPage(ss, {published, confirm: 'publish'}), /The public page will say[\s\S]*Jobadabra with every source" stays in Admin only/);
  await press(env, {kind: 'form', round: 'fixed', action: 'publish', confirmed: '1'});
  const live = formPage(snap, {published: await state(env.STATS)});
  assert.match(live, /Public now: round <b>fixed<\/b>/); assert.match(live, /This round is the one on the website/); assert.match(live, /Unpublish/); assert.match(live, /brings back the starting snapshot/);
});

test('mergeResults leaves the starting snapshot alone for a kind nobody published', () => {
  const base = {schema: 1, search: {a: 1}, forms: {b: 2}};
  assert.deepEqual(mergeResults(base, {form: null, search: null}), {...base, published: {}});
});
