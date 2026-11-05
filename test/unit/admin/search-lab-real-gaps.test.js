// GET /search-lab/real-gaps (admin/search-lab-real-gaps.js): the real installs' search gaps for the robot's alarm, from reports sent as the app sends them.
// Keyed like its sibling /applying/discovery-input; a field × country only with 3+ installs; each install's latest finished search counts once.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {gaps} from '../../../admin/search-lab-real-gaps.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const report = (install, more = {}) => ({kind: 'search', install, version: '0.9.0', platform: 'darwin', at: new Date().toISOString(), family: 'aviation_transport', country: 'DE',
  in_places: 900, scored: 3, fit70: 0, first_s: 9, nth: 1, engine: 'api', trigger: 'first', ...more});
const send = (env, events) => worker.fetch(new Request('https://www.jobpilotto.top/report/telemetry', {method: 'POST', body: JSON.stringify({events})}), env, {});
const ask = (env, key) => worker.fetch(new Request('https://www.jobpilotto.top/search-lab/real-gaps', {headers: key ? {Authorization: `Bearer ${key}`} : {}}), env, {});

test('3 installs with 0 relevant jobs in one field × country come back as one group; the route needs its key', async () => {
  const env = {STATS: d1(), REPLAYS_PUBLISH_KEY: 'k', ASSETS: {fetch: () => new Response('asset')}};
  assert.equal((await send(env, [report('install-aaaa'), report('install-bbbb'), report('install-cccc'), report('install-dddd', {country: 'FR'})])).status, 200);
  assert.equal((await ask(env, '')).status, 404);
  assert.equal((await ask(env, 'wrong')).status, 404);
  const answer = await (await ask(env, 'k')).json();
  assert.deepEqual(answer.groups, [{family: 'aviation_transport', name: answer.groups[0].name, country: 'DE', installs: 3, zero: 3, in_places: 900}]);
  assert.ok(!JSON.stringify(answer).includes('install-'), 'no install id leaves the server');
});

test('each install counts once with its latest finished search; failed searches and old ones do not count', () => {
  const now = new Date('2026-10-26T12:00:00Z'), row = (install, day, more = {}) => ({install, day, family: 'healthcare', country: 'PT', fit70: 0, in_places: 50, ...more});
  const reports = [row('a', '2026-10-20'), row('a', '2026-10-25', {fit70: 4}), row('b', '2026-10-24'), row('c', '2026-10-25'), row('d', '2026-10-25', {result: 'failed', fit70: undefined}),
    row('e', '2026-09-01')];
  assert.deepEqual(gaps(reports, now).map(g => [g.installs, g.zero]), [[3, 2]]);
  assert.deepEqual(gaps(reports.slice(0, 3), now), [], 'under 3 installs: nothing is sent');
});
