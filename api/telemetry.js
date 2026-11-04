// What installed apps call: POST /report/telemetry stores a scrubbed report, GET /telemetry/version answers the canary promote's question.
// The data layer is shared/telemetry.js. Guarded by test/unit/shared/telemetry.test.js.
import {isOwner} from '../shared/auth.js';
import {clean as cleanSearch} from '../shared/search-report.js';
import {KINDS, KEEP_DAYS, MAX_BYTES, MAX_EVENTS, PER_INSTALL_PER_DAY, day, text, scrub, describe, hash} from '../shared/telemetry.js';

// POST /report/telemetry {events: [...]}: checked, limited per install per day, stored.
export async function collect(request, env, now = new Date()) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  if (!env.STATS) return Response.json({ok: false, error: 'not configured'}, {status: 503});
  const body = await request.json().catch(() => ({}));
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, MAX_EVENTS)
    .filter(item => item && KINDS.includes(item.kind) && /^[\w-]{8,64}$/.test(String(item.install || '')));
  if (!events.length) return Response.json({ok: false, error: 'no events'}, {status: 400});
  const today = day(now), country = /^[A-Z]{2}$/.test(request.cf?.country || '') ? request.cf.country : null;   // Cloudflare's country code for the request, never an address
  const kv = env.WAITLIST, countKey = `telemetry:${events[0].install}:${today}`;
  const count = kv ? Number(await kv.get(countKey)) || 0 : 0;
  if (count >= PER_INSTALL_PER_DAY) return Response.json({ok: false, error: 'limit reached for today'}, {status: 429});
  if (kv) await kv.put(countKey, String(count + events.length), {expirationTtl: 2 * 86400});
  for (const item of events) {
    const data = scrub(JSON.stringify(item.kind === 'search' ? cleanSearch(item) : item)).slice(0, MAX_BYTES);
    const {key, summary} = describe(item);
    const row = [today, text(item.at, 30), item.kind, text(item.install, 64), text(item.version, 30), text(item.platform, 20), await hash(key), scrub(summary).slice(0, 300), data];
    await env.STATS.prepare('INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...row, country).run()
      .catch(() => env.STATS.prepare('INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...row).run());   // before migration 0062: no country
  }
  return Response.json({ok: true, stored: events.length});
}

// GET /telemetry/version?v=0.5.3&compare=0.5.1 (the /stats key, as `Authorization: Bearer`):
// positive evidence that a build was used and worked, per exact version, for the canary auto-promote
// (tools/canary_promote.py). Health lines carry runsOk / runsFailed since the previous line (desktop/main.js).
const VERSION = /^[\w.+-]{1,30}$/;
export async function versionEvidence(db, version) {
  const rows = (await db.prepare('SELECT day, at, kind, install, data FROM telemetry WHERE version = ?').bind(version).all()).results || [];
  const health = rows.filter(row => row.kind === 'health');
  const times = list => list.map(row => row.at).filter(at => !Number.isNaN(Date.parse(at))).sort();
  const events = Object.fromEntries(KINDS.map(kind => [kind, rows.filter(row => row.kind === kind).length]));
  let runsOk = 0, runsFailed = 0, runsReported = 0;
  for (const row of health) {
    let data = {};
    try { data = JSON.parse(row.data); } catch {}
    if (typeof data.runsOk !== 'number' && typeof data.runsFailed !== 'number') continue;
    runsReported++;
    runsOk += Number(data.runsOk) || 0;
    runsFailed += Number(data.runsFailed) || 0;
  }
  const all = times(rows), healthTimes = times(health);
  return {version, installs: new Set(rows.map(row => row.install)).size, healthInstalls: new Set(health.map(row => row.install)).size,
    healthDays: new Set(health.map(row => row.day)).size, firstSeen: all[0] || null, lastSeen: all.at(-1) || null,
    healthFirst: healthTimes[0] || null, healthLast: healthTimes.at(-1) || null,
    runs: {ok: runsOk, failed: runsFailed, reports: runsReported}, events};
}
export async function evidence(request, env) {
  if (!await isOwner(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const params = new URL(request.url).searchParams;
  const versions = [params.get('v'), params.get('compare')].filter(Boolean);
  if (!versions.length || !versions.every(v => VERSION.test(v))) return Response.json({ok: false, error: 'give ?v=<app version>'}, {status: 400});
  const result = {};
  for (const v of versions) result[v] = await versionEvidence(env.STATS, v);
  return Response.json({ok: true, keptDays: KEEP_DAYS, versions: result}, {headers: {'Cache-Control': 'no-store'}});
}
