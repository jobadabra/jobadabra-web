// /admin/job-search/benchmark: our job search against other tools on the same random role × city searches (owner, 20 Oct 2026). The bake-off's search-bench (a private repo) sends each scored
// tool-on-persona once (PUT /benchmark-search/data, Bearer SELFHEAL_PUBLISH_KEY); the site keeps one row per run (benchmark_search_runs) and, after each write, ONE snapshot row (benchmark_search_snapshot)
// the page reads: no table scan per page load (D1 free plan). Tool, persona and job-system names are data from the owner-only write. Pure maths: admin/benchmark-search-data.js; the page: admin/benchmark-search-page.js.
import {remember, viewer} from '../shared/auth.js';
import {equal} from '../shared/guard.js';
import {KINDS} from './benchmark-search-data.js';
import {buildSnapshot, saveSnapshot, snapshotOf} from './benchmark-search-snapshot.js';
import {page} from './benchmark-search-page.js';
import {state} from './benchmark-publish.js';
import {stored} from './benchmark-ai.js';

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
  const missed = counts(run?.missed);
  const row = {id: text(run?.id, 80), at: text(run?.at, 30), round: text(run?.round, 30), persona: text(run?.persona, 60), kind: run?.kind, country: text(run?.country, 40), tool: text(run?.tool, 60), ours: run?.ours ? 1 : 0, build: text(run?.build, 20), ai: stored(run?.ai), missed: JSON.stringify(missed)};
  const numbers = Object.fromEntries(NUMBERS.map(key => [key, count(run?.[key] ?? 0)]));
  if (!row.id || !/^\d{4}-\d{2}-\d{2}/.test(row.at) || !row.round || !row.persona || !row.tool || !KINDS.includes(row.kind) || Object.values(numbers).includes(null)) return null;
  if (numbers.relevant > numbers.found || numbers.place > numbers.found || numbers.role > numbers.found) return null;
  return {...row, ...numbers};
}

export {buildSnapshot};

// PUT /benchmark-search/data {runs: [run], replace?: true}: each run once (the same id replaces its row); then the snapshot is rebuilt.
// Why (13 Nov 2026, owner: "a full round's publish replaces its round's rows, so old rows can't linger again; side checks keep adding"): the upsert alone left ten stale "ours with every source" rows
// of round 2026-11-13 beside the new ones. `replace: true` (a full round, sent whole in ONE put, under MAX_ROWS) deletes the rows of every round it carries before the inserts, in the same batch; a side check sends no flag.
export async function ingest(request, env, now = new Date()) {
  if (!authorized(request, env) || request.method !== 'PUT') return new Response('Not found', {status: 404});
  const body = await request.text();
  if (body.length > 300000) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Not JSON', {status: 400}); }
  if (!Array.isArray(data?.runs) || data.runs.length > MAX_ROWS) return new Response('Unexpected shape', {status: 400});
  const rows = data.runs.map(clean).filter(Boolean);
  const columns = ['id', 'at', 'round', 'persona', 'kind', 'country', 'tool', 'ours', 'build', 'ai', ...NUMBERS, 'missed'];
  const write = env.STATS.prepare(`INSERT INTO benchmark_search_runs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(column => `${column} = excluded.${column}`).join(', ')}`);
  const replaced = data.replace === true ? [...new Set(rows.map(row => row.round))] : [];
  if (rows.length) await env.STATS.batch([...replaced.map(round => env.STATS.prepare('DELETE FROM benchmark_search_runs WHERE round = ?').bind(round)), ...rows.map(row => write.bind(...columns.map(column => row[column])))]);
  await env.STATS.prepare('DELETE FROM benchmark_search_runs WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)).run();
  await saveSnapshot(env.STATS, now);
  return new Response(JSON.stringify({ok: true, stored: rows.length, ignored: data.runs.length - rows.length}), {headers: {'Content-Type': 'application/json'}});
}

export async function view(request, env) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  let snapshot = null;
  try { snapshot = await snapshotOf(env.STATS); } catch { snapshot = null; }
  const published = await state(env.STATS);
  return new Response(page(snapshot, {round: url.searchParams.get('round') || undefined, published, confirm: url.searchParams.get('confirm')}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
