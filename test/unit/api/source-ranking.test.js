// One shared ranking per role kind × country of every source (api/source-ranking.js; spec 2026-10-18-search-learns-sources.md item B, owner
// 26 Oct 2026): what installs shared (jobs located in their places, fit 70+, seconds) comes back in the employer index, proven after 1 install,
// dead after 3, best by jobs per minute. Counts and fixed ids only.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {DEAD_K, MAX_PROVEN, sourceRanking} from '../../../api/source-ranking.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql), batch: async statements => { for (const s of statements) await s.run(); }};
}
const kvStore = () => { const map = new Map(); return {map, get: async k => map.get(k) ?? null, put: async (k, v) => { map.set(k, v); }}; };
const setup = () => ({STATS: d1(), WAITLIST: kvStore(), STATS_SALT: 'salt', INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')}});
const post = (env, body) => worker.fetch(new Request('https://www.jobpilotto.top/api/contribute', {method: 'POST', body: JSON.stringify(body)}), env, {});
const feed = (slug, extra = {}) => ({ats: 'lever', slug, company: `Co ${slug}`, matched: false, own: false, jobs: 40, hits: 0, ...extra});
const share = (install, feeds, extra = {}) => ({v: 2, install, roles: ['finance_admin'], regions: ['europe'], countries: ['de'], feeds, ...extra});

test('an employer that gave one install local jobs is proven for its kind × country; one read fine with none by 3 installs is dead', async () => {
  const env = setup();
  await post(env, share('install-aaaa1111', [feed('good', {local: 6, fit70: 2, seconds: 3}), feed('empty', {local: 0, seconds: 2}), feed('old')]));
  await post(env, share('install-bbbb2222', [feed('empty', {local: 0, seconds: 1}), feed('fast', {local: 4, seconds: 1})]));
  let ranking = await sourceRanking(env);
  const cell = ranking['finance_admin|de'];
  assert.deepEqual(cell.proven.map(s => [s.kind, s.source, s.installs, s.local, s.fit70]), [['employer', 'lever:fast', 1, 4, 0], ['employer', 'lever:good', 1, 6, 2]],
    'best by jobs per minute: 4 in 1 s beats 6 in 3 s');
  assert.deepEqual(cell.dead, [], `0 local jobs from 2 installs is not yet dead (DEAD_K = ${DEAD_K})`);
  assert.equal(cell.proven.some(s => s.source === 'lever:old'), false, 'a feed sent without counts (an older app) is neither proven nor dead');
  await post(env, share('install-cccc3333', [feed('empty', {local: 0, seconds: 2})]));
  ranking = await sourceRanking(env);
  assert.deepEqual(ranking['finance_admin|de'].dead, ['employer:lever:empty']);
  assert.equal(ranking['finance_admin|fr'], undefined, 'nothing for a country nobody searched');
});

test('the kind is the key, whatever its value: a new kind added to the fixed list works with no change here', async () => {
  const env = setup();
  await post(env, share('install-aaaa1111', [feed('a', {local: 3, seconds: 2})], {roles: ['healthcare', 'education'], countries: ['de', 'at']}));
  const ranking = await sourceRanking(env);
  assert.deepEqual(Object.keys(ranking).sort(), ['education|at', 'education|de', 'healthcare|at', 'healthcare|de']);
});

test('a dead mark never comes from "other" (any field) or from a failed read', async () => {
  const env = setup();
  for (const install of ['install-aaaa1111', 'install-bbbb2222', 'install-cccc3333']) {
    await post(env, share(install, [feed('x', {local: 0, seconds: 1}), feed('broken', {local: 0, failed: true})], {roles: ['other', 'trades']}));
  }
  const ranking = await sourceRanking(env);
  assert.deepEqual(ranking['other|de']?.dead || [], []);
  assert.deepEqual(ranking['trades|de'].dead, ['employer:lever:x'], 'a failed read is not "nothing here"');
});

test('a job board ranks in the same list, by the kinds of the install that read it, only in countries it serves', async () => {
  const env = setup();
  const board = (host, given, countries = ['de']) => ({host, kind: 'board', url: `https://${host}/jobs?q={role}`, board: {countries}, yield: given});
  await post(env, share('install-aaaa1111', [feed('slow', {local: 5, seconds: 60})], {countries: ['de', 'fr'],
    sites: [board('boardone.example', {in_places: 9, fit70: 1, seconds: 6}), board('frboard.example', {in_places: 2, fit70: 0, seconds: 1}, ['fr'])]}));
  const ranking = await sourceRanking(env);
  assert.deepEqual(ranking['finance_admin|de'].proven.map(s => `${s.kind}:${s.source}`), ['board:boardone.example', 'employer:lever:slow']);
  assert.deepEqual(ranking['finance_admin|fr'].proven.map(s => `${s.kind}:${s.source}`), ['board:frboard.example', 'employer:lever:slow']);
});

test('a source without its seconds ranks after the timed ones by jobs per run, and a cell keeps at most MAX_PROVEN', async () => {
  const env = setup();
  const feeds = Array.from({length: MAX_PROVEN + 5}, (_, i) => feed(`f${i}`, {local: 1 + i, ...(i === 0 ? {seconds: 1} : {})}));
  await post(env, share('install-aaaa1111', feeds));
  const proven = (await sourceRanking(env))['finance_admin|de'].proven;
  assert.equal(proven.length, MAX_PROVEN);
  assert.equal(proven[0].source, 'lever:f0', 'the one timed source first');
  assert.equal(proven[1].source, `lever:f${MAX_PROVEN + 4}`, 'then by jobs per run');
  assert.equal(proven[1].per_min, null);
});

test('the index an install downloads carries the ranking', async () => {
  const env = setup();
  await post(env, share('install-aaaa1111', [feed('good', {local: 6, seconds: 3})]));
  await worker.fetch(new Request('https://www.jobpilotto.top/api/index', {method: 'PUT', headers: {Authorization: 'Bearer k3y', 'Content-Type': 'application/json'},
    body: JSON.stringify({feeds: [{company: 'Co good', ats: 'lever', slug: 'good', regions: ['europe']}]})}), env, {});
  const got = await (await worker.fetch(new Request('https://www.jobpilotto.top/api/index?regions=europe', {headers: {Authorization: 'Bearer k3y'}}), env, {})).json();
  assert.deepEqual(got.ranking['finance_admin|de'].proven.map(s => s.source), ['lever:good']);
});
