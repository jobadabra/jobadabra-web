// The central scout's memory (jobs.sqlite, cache, geo.json: the gzipped tar jobadabra-lab's central-scout.yml caches) kept in the private R2 bucket SCOUT_MEMORY.
// Why (6 Nov 2026, owner: "Yes, copy it to R2 (Recommended)"): the memory lived only in the lab repo's GitHub cache; on 2 Nov a repo move left it behind and the data loss followed, and a lost cache
// still costs about a week of AI re-asking. The scout saves after each run (PUT) and reads the newest back when its cache is missing (GET). Bearer INDEX_PUBLISH_KEY, the scout's existing key,
// so no new secret. Never served to installs, never on a page: private learned data. Brief: ~/.claude/coordinator-briefs/brief-gi-scout-memory-r2.md. Guard: test/unit/api/scout-memory.test.js.
import {equal} from '../shared/guard.js';

// Why (6 Nov 2026, brief): the tar is about 3 MB today; 50 MB leaves room to grow and stays well under the Worker's 100 MB request body and 128 MB memory.
export const MAX_BYTES = 50 * 1024 * 1024;
// Why (6 Nov 2026, owner's option: "keep 30 dated copies"): 4 saves a day of ~3 MB is ~360 MB at 30 days, inside R2's free 10 GB.
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

/** Drops the copies older than KEEP_DAYS, never the one just written. -> how many were dropped */
async function trim(bucket, kept, now) {
  const old = (await saved(bucket)).filter(object => object.key !== kept && now.getTime() - new Date(object.uploaded).getTime() > KEEP_DAYS * DAY).map(object => object.key);
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
  const name = `${now.toISOString().slice(0, 10)}-${run}`, key = `${PREFIX}${name}.tgz`;
  await bucket.put(key, body, {httpMetadata: {contentType: 'application/gzip'}, customMetadata: {at: now.toISOString(), run, bytes: String(body.byteLength)}});
  // Why (6 Nov 2026): a failed trim only lets old copies wait for the next save, so the save stands; the answer says "failed" so the scout's log shows it instead of hiding it.
  const dropped = await trim(bucket, key, now).catch(error => { console.log(JSON.stringify({route: 'scout-memory', trim: 'failed', error: String(error?.message || error)})); return 'failed'; });
  return Response.json({ok: true, key: name, bytes: body.byteLength, dropped}, {headers: {'Cache-Control': 'no-store'}});
}

async function latest(bucket) {
  // Why (6 Nov 2026): the newest by upload time, not by name: run ids differ in length, so "9" would sort after "42118339535" on the same day the wrong way.
  const newest = (await saved(bucket)).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))[0];
  const object = newest && await bucket.get(newest.key);
  if (!object) return no(404, 'none saved');
  return new Response(object.body, {headers: {'Content-Type': 'application/gzip', 'Content-Length': String(object.size), 'X-Scout-Memory': newest.key.slice(PREFIX.length, -4), 'Cache-Control': 'no-store'}});
}

/**
 * /api/scout-memory: PUT ?run=<GitHub run id> with the gzipped tar saves it as scout-memory/<YYYY-MM-DD>-<run>.tgz and drops copies older than KEEP_DAYS; GET returns the newest
 * (header X-Scout-Memory = its date and run; 404 when none). A wrong or missing key is a 404, as the other publish keys.
 */
export async function scoutMemory(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.INDEX_PUBLISH_KEY && equal(given, env.INDEX_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  if (!env.SCOUT_MEMORY) return no(503, 'not configured');
  if (request.method === 'GET') return latest(env.SCOUT_MEMORY);
  if (request.method === 'PUT') return save(request, env.SCOUT_MEMORY, now);
  return no(405, 'GET or PUT');
}
