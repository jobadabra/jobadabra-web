// The AI persona's runs (owner, 4 Nov 2026: "a dedicated tab in admin where I'll see all the runs/paths/bugs found… and video recording for each"): CI's agent job uploads each run's record (one small JSON:
// goals, path, notes), its video and the screenshots of its notes (PUT /agent/run?run=<id>&file=<name>, Bearer REPLAYS_PUBLISH_KEY) into the private R2 bucket LAB_FILLS under agent/<run>/; anything older
// than 14 days is dropped on the next upload (no bucket rule to create by hand); only the owner reads them (GET /admin/ai-persona/data, /admin/ai-persona/file; Range so the player scrubs).
// A fake applicant on a fake store, never a real person's data. Same bucket and key as the Lab's fill videos (admin/lab-video.js): no new bucket, no new secret. Guard: test/api/agent-runs.test.js.
import {equal} from '../shared/guard.js';
import {viewer} from '../shared/auth.js';

export const KEEP_DAYS = 14, MAX_RECORD = 1024 * 1024, MAX_VIDEO = 40 * 1024 * 1024, MAX_SHOT = 600 * 1024;
const DAY = 86400000;
const no = (status, error) => new Response(JSON.stringify({ok: false, error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

// What a run may store: its record, its video, and up to 99 note screenshots. Anything else is refused, so a name is never a path.
const FILES = [
  {test: /^run\.json$/, type: 'application/json', max: MAX_RECORD},
  {test: /^video\.webm$/, type: 'video/webm', max: MAX_VIDEO},
  {test: /^shot-([1-9]\d?)\.jpg$/, type: 'image/jpeg', max: MAX_SHOT},
];
const kindOf = name => FILES.find(kind => kind.test.test(name));
const runOf = value => (/^\d{6,15}$/.test(String(value ?? '')) ? String(value) : null);

async function prune(bucket, now) {
  const old = [];
  let cursor;
  do {
    const page = await bucket.list({prefix: 'agent/', cursor});
    for (const object of page.objects) if (now.getTime() - new Date(object.uploaded).getTime() > KEEP_DAYS * DAY) old.push(object.key);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  if (old.length) await bucket.delete(old);
}

// What the run list shows, kept beside the record as small metadata (an R2 object's metadata is capped at 2 KB): never a note's words.
const summaryOf = record => {
  const goals = Array.isArray(record.goals) ? record.goals : [], count = verdict => String(goals.filter(goal => goal?.verdict === verdict).length);
  return {at: String(record.at || '').slice(0, 30), kind: String(record.kind || '').slice(0, 12), commit: String(record.commit || '').slice(0, 12), plan: String(record.plan || '').slice(0, 40),
    worked: count('worked'), bug: count('bug'), doubts: count('doubts'), stuck: count('could-not-finish'), notes: String(Array.isArray(record.notes) ? record.notes.length : 0),
    calls: String(Number(record.cost?.calls) || 0), tokens: String(Number(record.cost?.tokens) || 0), minutes: String(Number(record.cost?.minutes) || 0)};
};

// PUT /agent/run?run=<github run id>&file=<run.json|video.webm|shot-N.jpg>: the raw file as the body. A wrong or missing key is a 404, as the other publish keys.
export async function runIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  if (!env.LAB_FILLS) return no(503, 'not configured');
  const url = new URL(request.url), run = runOf(url.searchParams.get('run')), name = String(url.searchParams.get('file') || ''), kind = kindOf(name);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!run) return no(400, 'run is the numeric id of the run');
  if (!kind) return no(400, 'file is run.json, video.webm or shot-N.jpg');
  if (type !== kind.type) return no(400, `${name} is ${kind.type}`);
  if (Number(request.headers.get('Content-Length')) > kind.max) return no(413, 'too large');
  const body = await request.arrayBuffer();
  if (!body.byteLength) return no(400, 'empty');
  if (body.byteLength > kind.max) return no(413, 'too large');
  let meta = {at: now.toISOString(), bytes: String(body.byteLength)};
  if (name === 'run.json') {
    let record;
    try { record = JSON.parse(new TextDecoder().decode(body)); } catch { return no(400, 'run.json is not JSON'); }
    if (!record || typeof record !== 'object' || Array.isArray(record) || String(record.run) !== run) return no(400, 'run.json is the record of this run');
    meta = {...meta, ...summaryOf(record)};
  }
  await env.LAB_FILLS.put(`agent/${run}/${name}`, body, {httpMetadata: {contentType: type}, customMetadata: meta});
  await prune(env.LAB_FILLS, now).catch(error => console.log(`agent-runs: clean-up failed (${error.message}); the upload stays stored`));
  return Response.json({ok: true, bytes: body.byteLength}, {headers: {'Cache-Control': 'no-store'}});
}

// The run list: one row per run that has a record, newest first, with whether its video and how many screenshots are kept.
async function index(bucket) {
  const runs = new Map();
  let cursor;
  do {
    const page = await bucket.list({prefix: 'agent/', cursor, include: ['customMetadata']});
    for (const object of page.objects) {
      const [, run, name] = object.key.split('/'), row = runs.get(run) || {run, video: false, videoBytes: 0, shots: 0};
      if (name === 'run.json') Object.assign(row, {has: true, ...object.customMetadata});
      else if (name === 'video.webm') Object.assign(row, {video: true, videoBytes: Number(object.customMetadata?.bytes) || 0});
      else row.shots += 1;
      runs.set(run, row);
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return [...runs.values()].filter(row => row.has).map(({has, ...row}) => row).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// GET /admin/ai-persona/data: ?index -> {runs: [...]}; ?run=<id> -> that run's record. Signed out is a 404.
export async function runData(request, env) {
  if (!await viewer(request, env) || !env.LAB_FILLS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('index')) return Response.json({runs: await index(env.LAB_FILLS)}, {headers: {'Cache-Control': 'no-store'}});
  const run = runOf(url.searchParams.get('run')), object = run ? await env.LAB_FILLS.get(`agent/${run}/run.json`) : null;
  if (!object) return new Response('Not found', {status: 404});
  return new Response(object.body, {headers: {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store'}});
}

// GET /admin/ai-persona/file?run=<id>&name=<video.webm|shot-N.jpg>: the file, whole or by Range. Signed out is a 404.
export async function runFile(request, env) {
  if (!await viewer(request, env) || !env.LAB_FILLS) return new Response('Not found', {status: 404});
  const url = new URL(request.url), run = runOf(url.searchParams.get('run')), name = String(url.searchParams.get('name') || '');
  const key = run && name !== 'run.json' && kindOf(name) ? `agent/${run}/${name}` : null;
  const head = key ? await env.LAB_FILLS.head(key) : null, size = Number(head?.size);
  if (!key || !head || !(size > 0)) return new Response('Not found', {status: 404});
  const headers = {'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store'};
  const asked = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!asked) return new Response((await env.LAB_FILLS.get(key)).body, {headers: {...headers, 'Content-Length': String(size)}});
  const start = asked[1] === '' ? size - Number(asked[2]) : Number(asked[1]), end = asked[1] === '' || asked[2] === '' ? size - 1 : Math.min(Number(asked[2]), size - 1);
  if (!(start >= 0 && start < size && end >= start)) return new Response('Range not satisfiable', {status: 416, headers: {'Content-Range': `bytes */${size}`}});
  const part = await env.LAB_FILLS.get(key, {range: {offset: start, length: end - start + 1}});
  return new Response(part.body, {status: 206, headers: {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1)}});
}
