// A publish of Central Scout board facts through the real Worker onto real SQL of the migrations: the set-up board-listed.test.js and board-fact-day.test.js share.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../../../workers/www/index.js';

export const store = new Map();
/** The Worker's env with the publish key and a KV kept in `store`; add STATS: d1() for the database. */
export const env = () => ({INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')},
  WAITLIST: {get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); }}});
/** PUT /api/index with one feed and these board facts. */
export const put = (e, board_facts) => worker.fetch(new Request('https://www.jobpilotto.top/api/index', {method: 'PUT', headers: {Authorization: 'Bearer k3y'},
  body: JSON.stringify({feeds: [{company: 'Co a', ats: 'lever', slug: 'a', quality: 71.6, jobs: 12, relevant: 4.6, checked: '2026-09-30', places: ['Zurich, Switzerland', 7]}], board_facts})}), e, {});
/** An in-memory D1 (prepare/bind/run/all/first/batch) on the employer index and sitefacts migrations; `.db` is the raw database. */
export function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0018_employer_index.sql', import.meta.url), 'utf8'));
  for (const file of ['0037_pool_sitefacts.sql', '0038_sitefacts_layout.sql', '0094_sitefacts_board_yield.sql']) {
    try { db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8')); } catch (error) { if (!/duplicate column|already exists/.test(String(error))) throw error; }
  }
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql), batch: async statements => { for (const item of statements) await item.run(); }};
}
