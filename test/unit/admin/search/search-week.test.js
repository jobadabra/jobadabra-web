// The Search check's week in Admin (owner, 11 Nov 2026, via AskUserQuestion in session sa: "2 runs nightly, 5 runs weekly (Recommended)"; "each of the runs should provide new jobs"): the upload
// (key, shape, the same checks as a night), what each person's 5 runs added kept as counts, and the week stored apart: it never replaces or adds a night. Guard for admin/search-week.js and its route.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {nights} from '../../../../admin/search-night.js';
import {KEEP_WEEKS, cleanRuns, weekRoute, weeks} from '../../../../admin/search-week.js';
import worker from '../../../../workers/www/index.js';

const NOW = new Date('2026-11-12T10:30:00Z'), KEY = 'search-lab-key-0123456789';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}

const five = (...right) => right.map((newRight, index) => ({run: index + 1, new_listed: newRight + 2, new_right: newRight, right_after: right.slice(0, index + 1).reduce((a, b) => a + b, 0), seconds: 150}));
const week = () => ({state: 'success', head: 'measured 2 of 2', rows: [{persona: 1, label: 'p1', kind: 'measured', local: 4, found: 9, seconds: 160, runs: five(4, 1, 0, 0, 2)},
  {persona: 2, label: 'p2', kind: 'measured', local: 3, found: 5, seconds: 170, runs: five(3, 0, 0, 1, 0)}],
  by_run: [1, 2, 3, 4, 5].map(run => ({run, measured: 2, people_new: run === 3 ? 0 : 1, new_right: run === 1 ? 7 : 1}))});
const put = (env, verdict, query, key = KEY) => worker.fetch(new Request(`https://www.jobadabra.top/search-check/weekly?${query}`, {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(verdict)}), env, {waitUntil() {}});

test('a week is stored apart with what each run added; it never replaces or adds a night', async () => {
  const env = {STATS: d1(), REPLAYS_PUBLISH_KEY: KEY};
  assert.equal((await put(env, week(), 'week=2026-11-12&run=43000000001')).status, 200);
  const [stored] = await weeks(env);
  assert.equal(stored.week, '2026-11-12');
  assert.deepEqual(stored.rows[0].runs.map(run => [run.newRight, run.rightAfter]), [[4, 4], [1, 5], [0, 5], [0, 5], [2, 7]]);
  assert.deepEqual(stored.byRun[2], {run: 3, measured: 2, peopleNew: 0, newRight: 1}, 'a measured 0 is a 0');
  assert.deepEqual(await nights(env), [], 'the week is no night');
  await put(env, week(), 'week=2026-11-12&run=43000000002');
  assert.equal((await weeks(env)).length, 1, 'the same week sent again replaces itself');
  for (let day = 1; day < 1 + KEEP_WEEKS + 2; day += 1) await put(env, week(), `week=2026-10-${String(day).padStart(2, '0')}&run=4300000${day}00`);   // past days: a night or week ahead of tomorrow is refused
  assert.equal((await weeks(env)).length, KEEP_WEEKS, 'the last weeks only');
});

test('the week refuses what a night refuses: no key, a wrong shape, a mistyped flag; runs that are not 1..n say nothing', async () => {
  const env = {STATS: d1(), REPLAYS_PUBLISH_KEY: KEY};
  assert.equal((await put(env, week(), 'week=2026-11-12', 'wrong')).status, 404, 'no key, no write');
  assert.equal((await put(env, {rows: []}, 'week=2026-11-12')).status, 400);
  assert.equal((await put(env, week(), 'week=2026-02-30')).status, 400, 'a day that does not exist');
  assert.equal((await put(env, week(), 'week=2026-11-12&by_hand=true')).status, 400);
  assert.equal((await weekRoute(new Request('https://x/search-check/weekly', {method: 'PUT', body: '{}'}), env, NOW)).status, 404);
  assert.deepEqual(await weeks(env), []);
  assert.equal(cleanRuns([{run: 2, new_right: 1}]), null, 'runs start at 1');
  assert.equal(cleanRuns('x'), null);
  assert.deepEqual(cleanRuns([{run: 1, new_right: -1, right_after: 'x'}]), [{run: 1, newListed: null, newRight: null, rightAfter: null, seconds: null}], 'a number that is not a whole count is null, never 0');
});
