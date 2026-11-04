// The fair round on /admin/form-filling/benchmark (admin/benchmark-fair.js): score = right / (right + wrong + empty + not reached) per repeat,
// mean and spread; ours shows its newest build on a set and every build in "Our builds"; old rows never mix in; the ingest keeps round,
// repeat and not reached; the page shows the fair round first and labels the old rounds. Names are made up.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {fairSummary, pickRound} from '../../../admin/benchmark-fair.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const put = (e, runs) => call(e, '/benchmark/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({runs})});
const fair = (tool, form, rep, right, wrong, empty, unreached, extra = {}) => ({id: `fixed/${form}/${tool}/${rep}/${extra.build || ''}`, at: '2026-10-27T10:00:00Z', round: 'fixed', rep, tool, form,
  required: right + wrong + empty, right, wrong, empty, unreached, unans: 3, holds: 0, dups: 0, ...extra});
const ROWS = [
  fair('Ours', 'Form 1', 1, 8, 1, 1, 0, {ours: true, build: 'b2'}), fair('Ours', 'Form 1', 2, 6, 1, 3, 0, {ours: true, build: 'b2'}),
  fair('Ours', 'Form 1', 1, 2, 0, 8, 0, {ours: true, build: 'b1', at: '2026-10-26T10:00:00Z'}),
  fair('Tool X', 'Form 1', 1, 7, 0, 2, 1), fair('Tool X', 'Form 1', 2, 9, 0, 1, 0),
];

test('per repeat score, mean and spread; ours is its newest build; every build is listed', () => {
  const r = fairSummary(ROWS.map(row => ({...row, ours: row.ours ? 1 : 0}))).rounds.fixed;
  const ours = r.tools.find(t => t.ours), x = r.tools.find(t => !t.ours);
  assert.deepEqual([ours.build, ours.score, ours.low, ours.high, ours.reps], ['b2', 70, 60, 80, 2]);   // 8/10 and 6/10
  assert.deepEqual([x.score, x.low, x.high], [80, 70, 90]);   // 7/10 (one not reached) and 9/10
  assert.deepEqual([ours.right, ours.wrong, ours.empty, ours.unreached], [14, 2, 4, 0]);
  assert.deepEqual(r.tools.map(t => t.tool), ['Tool X', 'Ours']);   // best score first
  assert.deepEqual(r.builds.map(b => [b.build, b.score]), [['b1', 20], ['b2', 70]]);
});

test('the fixed set is picked first, then the newest week', () => {
  assert.equal(pickRound({rounds: {'week-2026-W45': {}, fixed: {}, 'week-2026-W46': {}}}), 'fixed');
  assert.equal(pickRound({rounds: {'week-2026-W45': {}, 'week-2026-W46': {}}}), 'week-2026-W46');
  assert.equal(pickRound({rounds: {}}), null);
});

test('the ingest keeps round, repeat and not reached; old rows never mix into the fair round; a bad round is dropped', async () => {
  const e = env();
  const old = {id: 'old/1', at: '2026-10-15T10:00:00Z', tool: 'Tool X', form: 'Form 9', required: 10, right: 9, wrong: 0, empty: 1, unans: 0, holds: 0, dups: 0};
  const res = await put(e, [...ROWS.map(row => ({...row, ours: Boolean(row.ours)})), old, {...ROWS[0], id: 'bad', round: 'week-2026-45'}]);
  assert.deepEqual(await res.json(), {ok: true, stored: 6, ignored: 1});
  const html = await (await call(e, '/admin/form-filling/benchmark', {headers: {Cookie: 'jp_stats=k3y'}})).text();
  assert.match(html, /Fair round · Fixed set/);
  assert.match(html, /Not reached/);
  assert.match(html, /<details class="oldrounds"><summary class="old">Old rounds \(before 27 Oct 2026\)/);   // folded away
  assert.match(html, /as of .* UTC · fair round/);
  assert.ok(html.indexOf('Fair round') < html.indexOf('Old rounds'), 'the fair round comes first');
  assert.doesNotMatch(html.slice(html.indexOf('Fair round'), html.indexOf('Old rounds')), /Form 9/, 'an old row never shows in the fair round');
});
