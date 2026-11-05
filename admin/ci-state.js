// The CI's small stores that were pinned GitHub issues, now one D1 table `ci_state` (key, body JSON, at): read by the Self-healing cards and the Red main tab, written by CI
// (Bearer SELFHEAL_PUBLISH_KEY, the key every CI upload here uses) and, for two keys, by the owner's buttons (admin/selfheal.js POST). One copy of each fact, no second store.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): the noise register (#274), the verdict audit
// (#2736) and the red-main issues (#2817) were data that loops read back from an issue body. Spec: docs/superpowers/specs/2026-11-05-state-issues-to-admin-design.md (public repo).
//   noise-register  {entries: [{id, view, kind, source, title, detail, word, why, date}]}                      CI appends (POST), the owner forgets one
//   verdict-audit   {audits: [{week, opened, closed, score, items: [{key, word, what, why, where, tick}]}]}    CI opens and closes (PUT), the owner ticks
//   red-main        {at, reds: [{suite, since, sinceAt, run, pr, found, good, tested, candidates, status}]}      CI replaces it (PUT); readable by anyone: public repo data only
import {equal} from '../shared/guard.js';

export const KEYS = ['noise-register', 'verdict-audit', 'red-main'];
const PUBLIC_READ = ['red-main'];
export const NOISE_KEEP = 300, AUDITS_KEEP = 8, MAX_BYTES = 300000;
const JSON_HEADERS = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};

/** The parsed body of `key`, or `fallback` when the row, the table or the JSON is missing (a page must still draw). */
export async function readState(env, key, fallback) {
  try {
    const row = await env.STATS?.prepare('SELECT body FROM ci_state WHERE key = ?').bind(key).first();
    return row ? JSON.parse(row.body) : fallback;
  } catch { return fallback; }
}

/** Stores `value` under `key`; `now` is the stamp. */
export async function writeState(env, key, value, now = new Date()) {
  await env.STATS.prepare('INSERT INTO ci_state (key, body, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, at = excluded.at').bind(key, JSON.stringify(value), now.toISOString()).run();
}

const entriesOf = value => (Array.isArray(value?.entries) ? value.entries : []);
const isId = value => typeof value === 'string' && value.length > 0 && value.length < 200;

/** The register after CI appended `fresh`: an id already there is kept as it was, the newest NOISE_KEEP stay. */
export function appended(state, fresh) {
  const have = new Set(entriesOf(state).map(item => item.id));
  const add = (Array.isArray(fresh) ? fresh : []).filter(item => item && isId(item.id) && !have.has(item.id));
  return {entries: [...entriesOf(state), ...add].slice(-NOISE_KEEP)};
}

/** The owner's "Forget": the entry leaves the register, so the Finder may file that finding again. */
export const forgotten = (state, id) => ({entries: entriesOf(state).filter(item => item.id !== id)});

/** A tick on one audited verdict (value 'right' or 'wrong'; anything else clears it). Only the open audit (newest, not closed) takes ticks. */
export function ticked(state, key, value) {
  const audits = Array.isArray(state?.audits) ? state.audits : [];
  const [latest, ...older] = audits;
  if (!latest || latest.closed || !(latest.items || []).some(item => item.key === key)) return {audits, changed: false};
  const tick = value === 'right' || value === 'wrong' ? value : null;
  return {audits: [{...latest, items: latest.items.map(item => (item.key === key ? {...item, tick} : item))}, ...older], changed: true};
}

const NOT_FOUND = () => new Response('Not found', {status: 404});

/** /ci-state/<key>: GET (CI; red-main for anyone), PUT (CI replaces), POST on noise-register (CI appends). Checked: the key name, the bearer key, the size, JSON. */
export async function route(request, env, key) {
  if (!KEYS.includes(key) || !env.STATS) return NOT_FOUND();
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const authed = !!(env.SELFHEAL_PUBLISH_KEY && equal(given, env.SELFHEAL_PUBLISH_KEY));
  if (request.method === 'GET') {
    if (!authed && !PUBLIC_READ.includes(key)) return NOT_FOUND();
    return new Response(JSON.stringify(await readState(env, key, null)), {headers: JSON_HEADERS});
  }
  if (!authed || !(request.method === 'PUT' || (request.method === 'POST' && key === 'noise-register'))) return NOT_FOUND();
  const text = await request.text();
  if (text.length > MAX_BYTES) return new Response('Too large', {status: 413});
  let data;
  try { data = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return new Response('Unexpected shape', {status: 400});
  if (request.method === 'POST') await writeState(env, key, appended(await readState(env, key, {entries: []}), data.entries));
  else await writeState(env, key, data);
  return new Response(JSON.stringify({ok: true, key}), {headers: JSON_HEADERS});
}
