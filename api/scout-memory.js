// The central scout's memory (jobs.sqlite, cache, geo.json: the gzipped tar jobadabra-lab's central-scout.yml caches) kept in the private R2 bucket SCOUT_MEMORY.
// Why (6 Nov 2026, owner: "Yes, copy it to R2 (Recommended)"): the memory lived only in the lab repo's GitHub cache; on 2 Nov a repo move left it behind and the data loss followed, and a lost cache
// still costs about a week of AI re-asking. The scout saves after each run (PUT) and reads the newest back when its cache is missing (GET). Bearer INDEX_PUBLISH_KEY, the scout's existing key,
// so no new secret. Never served to installs, never on a page: private learned data. Brief: ~/.claude/coordinator-briefs/brief-gi-scout-memory-r2.md. Guard: test/unit/api/scout-memory.test.js.
import {equal} from '../shared/guard.js';
import {COUNTRIES} from '../shared/pool-tags.js';
import {MAX_CI_ROWS, localCount, searchAddress} from './ci-boards.js';

// Why (6 Nov 2026, brief): the tar is about 3 MB today; 50 MB leaves room to grow and stays well under the Worker's 100 MB request body and 128 MB memory.
export const MAX_BYTES = 50 * 1024 * 1024;
// Why (6 Nov 2026, owner's option: "keep 30 dated copies"; the brief: "Keep the newest 30 days"): 30 days of saves, about 120 at 4 a day of ~3 MB, ~360 MB, inside R2's free 10 GB.
export const KEEP_DAYS = 30;
const PREFIX = 'scout-memory/', DAY = 86400000;
const RUN = /^\d{1,20}(-\d{1,3})?$/;   // a GitHub run id, with its attempt: never a path
const no = (status, error) => Response.json({ok: false, error}, {status, headers: {'Cache-Control': 'no-store'}});

/** Every saved copy, across all list pages. -> [{key, uploaded, size}] */
async function saved(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({prefix: PREFIX, cursor});
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects;
}

/** Drops the copies (listed before this save) older than KEEP_DAYS. -> how many were dropped */
async function trim(bucket, before, now) {
  const old = before.filter(object => now.getTime() - new Date(object.uploaded).getTime() > KEEP_DAYS * DAY).map(object => object.key);
  if (old.length) await bucket.delete(old);
  return old.length;
}

async function save(request, bucket, now) {
  const run = new URL(request.url).searchParams.get('run') || '';
  if (!RUN.test(run)) return no(400, 'run is the GitHub run id');
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return no(413, 'too large');
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.byteLength) return no(400, 'empty');
  if (body.byteLength > MAX_BYTES) return no(413, 'too large');
  if (body[0] !== 0x1f || body[1] !== 0x8b) return no(400, 'a gzipped tar is required');
  // Why (6 Nov 2026, review): a scout whose cache and restore both failed starts empty and saves a small valid tar; as the newest it would be what every later restore reads,
  // the loss this copy exists to prevent. Under half the newest copy is refused, as /api/index refuses a big drop; a wrong refusal costs only freshness, the stored copy is a good memory.
  // Refused before the trim, so refused saves never age the good copies out. A list that fails refuses too: the check cannot run.
  const before = await saved(bucket).catch(() => null);
  if (!before) return no(503, 'could not read the saved copies');
  const newest = latestOf(before);
  if (newest && body.byteLength < newest.size / 2) return no(409, `${body.byteLength} bytes would replace ${newest.size}`);
  const name = `${now.toISOString().slice(0, 10)}-${run}`, key = `${PREFIX}${name}.tgz`;
  await bucket.put(key, body, {httpMetadata: {contentType: 'application/gzip'}, customMetadata: {at: now.toISOString(), run, bytes: String(body.byteLength)}});
  // Why (6 Nov 2026): a failed trim only lets old copies wait for the next save, so the save stands; the answer says "failed" so the scout's log shows it instead of hiding it.
  const dropped = await trim(bucket, before, now).catch(error => { console.log(JSON.stringify({route: 'scout-memory', trim: 'failed', error: String(error?.message || error)})); return 'failed'; });
  return Response.json({ok: true, key: name, bytes: body.byteLength, dropped}, {headers: {'Cache-Control': 'no-store'}});
}

// Why (6 Nov 2026): the newest by upload time, not by name: run ids differ in length, so "9" would sort before "42118339535" on the same day.
const latestOf = objects => [...objects].sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))[0];

async function latest(bucket) {
  const newest = latestOf(await saved(bucket));
  const object = newest && await bucket.get(newest.key);
  if (!object) return no(404, 'none saved');
  return new Response(object.body, {headers: {'Content-Type': 'application/gzip', 'Content-Length': String(object.size), 'X-Scout-Memory': newest.key.slice(PREFIX.length, -4), 'Cache-Control': 'no-store'}});
}

// The boards installs reported, for the Central Scout only (candidates for its board pass: src/scout_board_candidates.py in jobadabra).
// Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Any reported board (Recommended)"; the option read: "The Scout, our own server job, counts a board even when only 1 install reported it.
// Only the Scout's own count is served to apps, never which install reported it."): k >= 1 here, never in the employer index apps download (k >= 3 there, employers.js SITES_K). Invariant:
// the list holds host, search template, countries and how many installs reported it; never an install id, never a yield or a user's own words (the template is boardOf's: {role}/{place} only).
// Rows of the Scout's own (install `central-scout-*`) are not reports. Route: the Scout's existing key and endpoint (owner via sa: no new key, no new endpoint).
export const REPORT_DAYS = 90, MAX_REPORTED = 1500, SCOUT_PREFIX = 'central-scout-';
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** [{host, url, countries, installs, local, ci?, ci_urls?}] of the boards at least one install reported in the last REPORT_DAYS, most installs first; then the boards only our CI searches read
 * (api/ci-boards.js: url null, installs 0, ci true). `installs` counts real installs only; `ci: true` marks a board our CI read too; `local` is the most jobs a CI search kept from it (0..999, 0 for none; a count, never a person or a run); `ci_urls` {country: address template} is where a CI search read the board in that country (api/ci-boards.js searchAddress, checked again here), absent with none. */
export async function reportedBoards(db, now = new Date()) {
  const since = new Date(now.getTime() - REPORT_DAYS * DAY).toISOString().slice(0, 10);
  const rows = (await db.prepare(`SELECT host, url, body, COUNT(DISTINCT install) AS installs FROM sitefacts WHERE kind = 'board' AND day >= ? AND install NOT LIKE ?
    GROUP BY host, url, body ORDER BY installs DESC, host LIMIT ?`).bind(since, `${SCOUT_PREFIX}%`, MAX_REPORTED).all()).results || [];
  const out = [];
  for (const row of rows) {
    let countries;
    try { countries = (JSON.parse(row.body || '{}').countries || []).filter(code => COUNTRIES.includes(code)); } catch { continue; }
    const url = typeof row.url === 'string' && /^https:\/\/[^\s#]{4,200}$/.test(row.url) ? row.url : null;
    if (!HOST.test(String(row.host)) || !url || !countries.length) continue;
    out.push({host: row.host, url, countries: [...new Set(countries)].sort(), installs: Number(row.installs) || 1, local: 0});
  }
  // Why (13 Nov 2026, owner via sa: "Any install + our CI searches (Recommended)"): CI-read boards are candidates too, marked `ci`, never counted as installs; CI-only ones come last.
  const ci = new Map(), best = new Map(), addresses = new Map();
  for (const row of (await db.prepare('SELECT host, country, local, url FROM ci_boards WHERE day >= ? ORDER BY host, country LIMIT ?').bind(since, MAX_CI_ROWS).all()).results || []) {
    if (HOST.test(String(row.host)) && COUNTRIES.includes(row.country)) {
      ci.set(row.host, [...(ci.get(row.host) || []), row.country]);
      best.set(row.host, Math.max(best.get(row.host) || 0, localCount(row.local)));
      const address = searchAddress(row.url, row.host);
      if (address) addresses.set(row.host, {...addresses.get(row.host), [row.country]: address});
    }
  }
  for (const item of out) if (ci.has(item.host)) { item.ci = true; item.local = best.get(item.host); if (addresses.has(item.host)) item.ci_urls = addresses.get(item.host); item.countries = [...new Set([...item.countries, ...ci.get(item.host)])].sort(); ci.delete(item.host); }
  for (const [host, countries] of ci) out.push({host, url: null, countries, installs: 0, local: best.get(host), ci: true, ...(addresses.has(host) ? {ci_urls: addresses.get(host)} : {})});
  return out.slice(0, MAX_REPORTED);
}

/**
 * /api/scout-memory: PUT ?run=<GitHub run id> with the gzipped tar saves it as scout-memory/<YYYY-MM-DD>-<run>.tgz (409 under half the newest copy) and drops copies older than KEEP_DAYS; GET returns the newest
 * (header X-Scout-Memory = its date and run; 404 when none); GET ?boards=1 returns the reported boards as JSON (reportedBoards). A wrong or missing key is a 404, as the other publish keys.
 */
export async function scoutMemory(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.INDEX_PUBLISH_KEY && equal(given, env.INDEX_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  if (request.method === 'GET' && new URL(request.url).searchParams.get('boards') === '1') {   // the reported boards: JSON from the stats database, not the R2 tar
    if (!env.STATS) return no(503, 'not configured');
    try { return Response.json({ok: true, boards: await reportedBoards(env.STATS, now)}, {headers: {'Cache-Control': 'no-store'}}); } catch { return no(503, 'could not read the reported boards'); }
  }
  if (!env.SCOUT_MEMORY) return no(503, 'not configured');
  if (request.method === 'GET') return latest(env.SCOUT_MEMORY);
  if (request.method === 'PUT') return save(request, env.SCOUT_MEMORY, now);
  return no(405, 'GET or PUT');
}
