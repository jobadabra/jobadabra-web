// The evidence bundle of a bug an AI tester (the nightly persona, Claude Desktop in the twin) reported through the app's Send feedback in tester mode (jobadabra spec 2026-11-07-ai-tester-bug-reports-design.md).
// POST /agent/bundle stores one object per bug under bundle/<id>/ in the Lab's private bucket (LAB_FILLS, no new bucket or secret) and answers its id; GET /admin/bug-bundle/<id> and /admin/bug-bundle/<id>/<file> read it.
// Why (7 Nov 2026, owner: GitHub issues are the only bug tracker, "to avoid polluting Admin... to avoid making it a bug/issue tracker"): NO D1 row, no status, no owner, no count of open bugs, and nothing here touches the `feedback`
// table or Telegram. Changed 7 Nov 2026 (owner: "let's add a dedicated page", Admin → Testing → Bug bundles): the evidence has a list page, read from the store itself (`listBundles`), that links each bug to its GitHub issue; the bug's state stays on GitHub. A twin's bundle can hold the owner's real session records and job rows: private bucket, Admin login only, 90 days, never in issue text.
// Guard: test/unit/shared/bug-bundles.test.js (privacy: who writes, who reads, a file name is never a path, nothing reaches the feedback table).
import {equal} from './guard.js';
import {isOwner, viewer} from './auth.js';

export const KEEP_DAYS = 90, MAX_REPORT = 20 * 1024, MAX_TEXT = 200 * 1024, MAX_SHOT = 1800 * 1024, MAX_BODY = 6 * 1024 * 1024;
export const SOURCES = ['persona', 'desktop-tester'], SEVERITIES = ['high', 'medium', 'low'];
const DAY = 86400000;
const no = (status, error) => new Response(JSON.stringify({ok: false, error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const hex = () => [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// What a bundle may hold. A name outside this table is refused, so a name is never a path.
const TEXT = {'logs.txt': 'text/plain; charset=utf-8', 'state.json': 'application/json; charset=utf-8', 'env.json': 'application/json; charset=utf-8'};
const SHOTS = {'app.jpg': 'image/jpeg', 'tab.jpg': 'image/jpeg'};
export const FILE_TYPES = {'report.json': 'application/json; charset=utf-8', ...TEXT, ...SHOTS};
export const idOf = value => (/^[0-9a-f]{16}$/.test(String(value ?? '')) ? String(value) : null);
const clip = (value, max) => String(value ?? '').trim().slice(0, max);

/** The report a tester wrote, made safe to store and draw: known fields only, each cut. -> {report} | {error} */
export function cleanReport(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {error: 'report is an object'};
  if (!SOURCES.includes(source)) return {error: `source is ${SOURCES.join(' or ')}`};
  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : null;
  if (!severity) return {error: 'severity is high, medium or low'};
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 30).map(step => clip(step, 300)).filter(Boolean);
  const report = {source, journey: clip(raw.journey, 60), severity, expected: clip(raw.expected, 1500), seen: clip(raw.seen, 1500), steps, at: clip(raw.at, 40), title: clip(raw.title, 120)};
  if (!report.expected || !report.seen) return {error: 'expected and seen are both needed'};
  return {report};
}

/** Drops every object under bundle/ older than KEEP_DAYS (on each upload, and daily from the Worker's schedule so an idle store is cleaned too). */
export async function prune(bucket, now = new Date()) {
  const old = [];
  let cursor;
  do {
    const page = await bucket.list({prefix: 'bundle/', cursor});
    for (const object of page.objects) if (now.getTime() - new Date(object.uploaded).getTime() > KEEP_DAYS * DAY) old.push(object.key);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  for (let i = 0; i < old.length; i += 1000) await bucket.delete(old.slice(i, i + 1000));
}

const JPEG = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
/** A JPEG data URL as bytes, or null (not a JPEG data URL, or over MAX_SHOT; the base64 length is checked first so a huge body is never decoded). */
export function decodeJpeg(value) {
  const match = JPEG.exec(String(value ?? ''));
  if (!match || match[1].length * 3 / 4 > MAX_SHOT + 3) return null;
  let binary;
  try { binary = atob(match[1]); } catch { return null; }   // Why (7 Nov 2026, code review): the pattern lets through a length atob refuses ("AAAAA"); that is a file left out, never a 500 that drops the report
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return bytes.length <= MAX_SHOT ? bytes : null;
}

/**
 * POST /agent/bundle, JSON {source, report, files: {logs.txt, state.json, env.json: text, app.jpg, tab.jpg: JPEG data URL}}. Allowed: CI (Bearer REPLAYS_PUBLISH_KEY) or the owner's scripts (their Bearer admin key, for the twin on the
 * owner's Mac). Anyone else gets a 404 as the other publish routes. A file that is too big or not what its name says is left out and named in `skipped`; the report is always kept. -> {ok, id, url, skipped?}
 */
export async function bundleIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const allowed = (env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY)) || await isOwner(request, env, now.getTime());
  if (!allowed) return new Response('Not found', {status: 404});
  if (!env.LAB_FILLS) return no(503, 'not configured');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return no(413, 'too large');
  const text = await request.text();
  if (text.length > MAX_BODY) return no(413, 'too large');
  let body;
  try { body = JSON.parse(text); } catch { return no(400, 'the body is JSON'); }
  const cleaned = cleanReport(body?.report, body?.source);
  if (cleaned.error) return no(400, cleaned.error);
  const id = hex(), meta = {at: now.toISOString(), source: cleaned.report.source}, skipped = [], put = (name, value, type) => env.LAB_FILLS.put(`bundle/${id}/${name}`, value, {httpMetadata: {contentType: type}, customMetadata: meta});
  const report = JSON.stringify(cleaned.report);
  if (report.length > MAX_REPORT) return no(413, 'report too large');
  const files = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : {};
  for (const [name, value] of Object.entries(files)) {
    if (Object.hasOwn(TEXT, name)) {
      if (typeof value === 'string' && new TextEncoder().encode(value).length <= MAX_TEXT) await put(name, value, TEXT[name]); else skipped.push(name);
    } else if (Object.hasOwn(SHOTS, name)) {
      const bytes = decodeJpeg(value);
      if (bytes) await put(name, bytes, SHOTS[name]); else skipped.push(name);
    } else skipped.push(name);
  }
  await put('report.json', report, FILE_TYPES['report.json']);   // the report goes LAST: a bundle with no report is not listed as a bundle, and a failed file never leaves a half page
  await prune(env.LAB_FILLS, now).catch(error => console.log(`bug-bundles: clean-up failed (${error.message}); the upload stays stored`));
  return Response.json({ok: true, id, url: `https://www.jobadabra.top/admin/bug-bundle/${id}`, ...(skipped.length ? {skipped} : {})}, {headers: {'Cache-Control': 'no-store'}});
}

/** One bundle's report, or null when it is not kept. */
export async function readReport(bucket, id) {
  const object = idOf(id) ? await bucket.get(`bundle/${id}/report.json`) : null;
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

/** GET /admin/bug-bundle/<id>/<file>: a kept file for the page and for the twin's replay (the owner's Bearer key works). Signed out is a 404, like every admin file. */
export async function bundleFile(request, env, id, name) {
  if (!await viewer(request, env) || !env.LAB_FILLS) return new Response('Not found', {status: 404});
  const key = idOf(id) && Object.hasOwn(FILE_TYPES, name) ? `bundle/${id}/${name}` : null, object = key ? await env.LAB_FILLS.get(key) : null;
  if (!object) return new Response('Not found', {status: 404});
  return new Response(object.body, {headers: {'Content-Type': FILE_TYPES[name], 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff'}});
}

/**
 * The kept bundles, newest first, for the Admin list: [{id, uploaded, report}]. Read from the store itself (the report objects, written last), no index and no D1 row; at most `limit` reports are read.
 * A report that cannot be read is left out.
 */
export async function listBundles(bucket, limit = 100) {
  const found = [];
  let cursor;
  do {
    const page = await bucket.list({prefix: 'bundle/', cursor});
    for (const object of page.objects) {
      const [, id, name] = object.key.split('/');
      if (name === 'report.json' && idOf(id)) found.push({id, uploaded: new Date(object.uploaded).getTime() || 0});
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  found.sort((a, b) => b.uploaded - a.uploaded);
  const kept = [];
  for (let i = 0; i < found.length && kept.length < limit; i += limit) {   // an unreadable report is skipped without costing a place in the list
    const batch = await Promise.all(found.slice(i, i + limit).map(async entry => ({...entry, report: await readReport(bucket, entry.id)})));
    kept.push(...batch.filter(entry => entry.report && typeof entry.report === 'object' && !Array.isArray(entry.report)));
  }
  return kept.slice(0, limit);
}
