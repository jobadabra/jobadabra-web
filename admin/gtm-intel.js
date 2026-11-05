// The GTM readiness snapshot (owner, 1 Nov 2026: "how stable are they"): the collector (tools/ci-intel/jobs/gtm-readiness.mjs, a step of e2e-intel.yml) reads each run's per-step results from CI artifacts
// (e2e-view-<suite>/steps.json, integration-results-<layer>) and sends the journey rows (PUT /gtm/data, Bearer SELFHEAL_PUBLISH_KEY). The site validates them and keeps ONE row (gtm_snapshot);
// the page (admin/gtm-readiness.js) reads that row only. Why a table of its own: e2e_runs/e2e_fails keep reds only, no green and no step, so a journey's share could not be drawn from them.
// Wire form of a Tier 1 row (compact, thousands of them): [runId, day, kind, os, journey, seen, failed, cut]. Guard: test/unit/admin/gtm-readiness.test.js.
import {equal} from '../shared/guard.js';

export const KEEP_DAYS = 28;   // two 14-day windows: this one and the one before (the trend)
export const MAX_T1 = 9000, MAX_READ = 4000;
export const T1_KINDS = ['after-merge', 'nightly', 'beta'];
const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const count = value => Number.isInteger(value) && value >= 0 && value < 100000;
const text = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const ids = list => (Array.isArray(list) ? list.slice(-MAX_READ).filter(id => Number.isInteger(id) && id > 0) : []);

/** Validate a collector body into the stored snapshot; null when it is not one. Unknown fields are dropped, rows older than KEEP_DAYS and rows of an unknown journey are dropped, the lists keep their newest rows. */
export function cleanSnapshot(data, now = new Date()) {
  if (!Array.isArray(data?.journeys) || !Array.isArray(data?.tier1)) return null;
  const from = new Date(now.getTime() - (KEEP_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const journeys = data.journeys.slice(0, 60).filter(item => /^(J\d{1,3}|K)$/.test(item?.id || '') && [1, 2].includes(item.tier) && text(item.name)).map(item => ({id: item.id, name: text(item.name), tier: item.tier}));
  const known = new Set(journeys.map(item => item.id));
  const tier1 = data.tier1.slice(-MAX_T1).filter(row => Array.isArray(row) && Number.isInteger(row[0]) && row[0] > 0 && isDay(row[1]) && row[1] >= from && T1_KINDS.includes(row[2]) && ['mac', 'windows'].includes(row[3])
    && known.has(row[4]) && count(row[5]) && count(row[6]) && count(row[7])).map(row => row.slice(0, 8));
  const tier2 = (Array.isArray(data.tier2) ? data.tier2.slice(-2000) : []).filter(row => isDay(row?.day) && row.day >= from && known.has(row.journey) && count(row.tests) && count(row.runs) && count(row.red))
    .map(row => ({day: row.day, journey: row.journey, tests: row.tests, runs: row.runs, red: row.red}));
  return {schema: 1, at: now.toISOString(), journeys, tier1, tier2, read: {e2e: ids(data.read?.e2e), integration: ids(data.read?.integration)}};
}

export async function readSnapshot(db) {
  try { const row = db ? await db.prepare('SELECT body FROM gtm_snapshot WHERE id = 1').first() : null; return row ? JSON.parse(row.body) : null; } catch { return null; }
}

// PUT the collector's snapshot. GET: the stored snapshot, so the collector reads only the runs it has not read (`read`) and sends the whole list again.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  if (request.method === 'GET') {   // Why (Gitar, #257): a D1 error must not read as "no snapshot yet" (404): the collector would start from nothing and overwrite 28 days with one pass
    try { const row = await env.STATS.prepare('SELECT body FROM gtm_snapshot WHERE id = 1').first(); return row ? json(JSON.parse(row.body)) : json({error: 'no snapshot yet'}, 404); } catch { return json({error: 'snapshot unreadable'}, 503); }
  }
  if (request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 900000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const snapshot = cleanSnapshot(data, now);
  if (!snapshot) return new Response('Unexpected shape', {status: 400});
  await env.STATS.prepare('INSERT INTO gtm_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return json({ok: true, tier1: snapshot.tier1.length, tier2: snapshot.tier2.length});
}
