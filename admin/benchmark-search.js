// /admin/job-search/benchmark: our job search against other tools on the same random role × city searches (owner, 20 Oct 2026). The bake-off's search-bench (a private repo) sends each scored
// tool-on-persona once (PUT /benchmark-search/data, Bearer SELFHEAL_PUBLISH_KEY); the site keeps one row per run (benchmark_search_runs) and, after each write, ONE snapshot row (benchmark_search_snapshot)
// the page reads: no table scan per page load (D1 free plan). Tool, persona and job-system names are data from the owner-only write. Pure maths: admin/benchmark-search-data.js; the page: admin/benchmark-search-page.js.
import {remember, viewer} from '../shared/auth.js';
import {equal} from '../shared/guard.js';
import {KINDS, summarize} from './benchmark-search-data.js';
import {page} from './benchmark-search-page.js';
import {state} from './benchmark-publish.js';

const KEEP_DAYS = 180, MAX_ROWS = 300;
const authorized = (request, env) => {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY));
};
const count = value => (Number.isInteger(value) && value >= 0 && value <= 100000 ? value : null);
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const NUMBERS = ['found', 'place', 'role', 'relevant', 'employers', 'seconds', 'cents'];

// One run in the shape the table holds, or null when it is not a run (a bad row is dropped, never stored half). `missed` = {job system: jobs}, titles and bodies never arrive.
export function clean(run) {
  const counts = value => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, jobs]) => [text(key, 60), count(jobs) ?? 0])) : {});
  // Why (27 Oct 2026, owner via 6e): a rival whose job failed for this persona is sent as null, never left out, so a rival that failed everywhere still shows as failed.
  const beyondOf = value => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, jobs]) => [text(key, 60), jobs === null ? null : count(jobs) ?? 0])) : {});
  const missed = counts(run?.missed), beyond = beyondOf(run?.beyond);   // beyond = {rival: relevant jobs "ours with every source" shows and that rival did not}
  const row = {id: text(run?.id, 80), at: text(run?.at, 30), round: text(run?.round, 30), persona: text(run?.persona, 60), kind: run?.kind, country: text(run?.country, 40), tool: text(run?.tool, 60), ours: run?.ours ? 1 : 0, build: text(run?.build, 20), missed: JSON.stringify(missed), beyond: JSON.stringify(beyond)};
  const numbers = Object.fromEntries(NUMBERS.map(key => [key, count(run?.[key] ?? 0)]));
  if (!row.id || !/^\d{4}-\d{2}-\d{2}/.test(row.at) || !row.round || !row.persona || !row.tool || !KINDS.includes(row.kind) || Object.values(numbers).includes(null)) return null;
  if (numbers.relevant > numbers.found || numbers.place > numbers.found || numbers.role > numbers.found) return null;
  return {...row, ...numbers};
}

export async function buildSnapshot(db, now = new Date()) {
  const {results = []} = await db.prepare('SELECT * FROM benchmark_search_runs ORDER BY at').all();
  return {...summarize(results.map(row => ({...row}))), at: now.toISOString()};
}

// PUT /benchmark-search/data {runs: [run]}: each run once (the same id replaces its row); then the snapshot is rebuilt.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env) || request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 300000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  if (!Array.isArray(data?.runs) || data.runs.length > MAX_ROWS) return new Response('Unexpected shape', {status: 400});
  const rows = data.runs.map(clean).filter(Boolean);
  const columns = ['id', 'at', 'round', 'persona', 'kind', 'country', 'tool', 'ours', 'build', ...NUMBERS, 'missed', 'beyond'];
  const write = env.STATS.prepare(`INSERT INTO benchmark_search_runs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(column => `${column} = excluded.${column}`).join(', ')}`);
  if (rows.length) await env.STATS.batch(rows.map(row => write.bind(...columns.map(column => row[column]))));
  await env.STATS.prepare('DELETE FROM benchmark_search_runs WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)).run();
  const snapshot = await buildSnapshot(env.STATS, now);
  await env.STATS.prepare('INSERT INTO benchmark_search_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  return new Response(JSON.stringify({ok: true, stored: rows.length, ignored: data.runs.length - rows.length}), {headers: {'Content-Type': 'application/json'}});
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { const row = env.STATS ? await env.STATS.prepare('SELECT body FROM benchmark_search_snapshot WHERE id = 1').first() : null; snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  const published = await state(env.STATS);
  return new Response(page(snapshot, {round: url.searchParams.get('round') || undefined, published, confirm: url.searchParams.get('confirm')}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
