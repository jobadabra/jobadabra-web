// The integration tests' snapshot: this file is the site's half (the Worker route that stores it and hands it back); the collector and the validators are one copy in the public repo.
// Why (2 Nov 2026, owner: the CI collectors move to the public repo, jobadabra#2989): integration-intel.yml runs there (tools/ci-intel/jobs/integration-intel.mjs) and PUTs /integration/data with Bearer SELFHEAL_PUBLISH_KEY;
// cleanSnapshot (the shape it must have) is imported from tools/ci-intel/lib/integration-intel.mjs so the sender and this route cannot disagree. The site keeps ONE row (integration_snapshot); the page (admin/integration-page.js) reads that row only.
// Guard: test/unit/admin/integration-page.test.js (the ingest) and the collector's own tests in the public repo (desktop/test/ci-intel-integration-intel-collector.test.js).
import {equal} from '../shared/guard.js';
import {cleanSnapshot} from '../tools/ci-intel/lib/integration-intel.mjs';
export {KEEP_DAYS, LAYERS, MAX_RUNS, cleanSnapshot} from '../tools/ci-intel/lib/integration-intel.mjs';

const authorized = (request, env) => Boolean(env.SELFHEAL_PUBLISH_KEY && equal((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SELFHEAL_PUBLISH_KEY));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

export async function readSnapshot(db) {
  try { const row = db ? await db.prepare('SELECT body FROM integration_snapshot WHERE id = 1').first() : null; return row ? JSON.parse(row.body) : null; } catch { return null; }
}

// PUT the collector's snapshot (see tools/ci-intel/jobs/integration-intel-rows.mjs for its shape). GET: the stored snapshot, for the collector's own comparison and the weekly.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env)) return new Response('Not found', {status: 404});
  if (request.method === 'GET') { const snapshot = await readSnapshot(env.STATS); return snapshot ? json(snapshot) : json({error: 'no snapshot yet'}, 404); }
  if (request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 900000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  const snapshot = cleanSnapshot(data, now);
  if (!snapshot) return new Response('Unexpected shape', {status: 400});
  await env.STATS.prepare('INSERT INTO integration_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return json({ok: true, runs: snapshot.runs.length, flaky: snapshot.flaky.length});
}
