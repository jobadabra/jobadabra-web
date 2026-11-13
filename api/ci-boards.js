// The job boards our own CI searches read, reported as names for the Central Scout's board pass (jobadabra tools/persona-search/report_boards.py).
// Why (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Any install + our CI searches (Recommended)"; "Let's fix it" about the missing feed): Jobeka and Trabajo.org gave a Madrid
// electrician 19 and 16 right jobs in CI searches and no source ever told the Scout. Design: a report is marked by its install id `ci-search-<run>` (the raw id; pool.js hashes real installs,
// so this prefix is told before hashing) and goes to its own table `ci_boards` (host, country, day): never into sitefacts, so no install count, no k >= 3 fact and no yield number an app
// is served can ever include CI. Only names: no person, no job, no title, no template. Faking the mark gains nothing: it can only add a candidate name for the Scout, which counts it itself.
import {COUNTRIES} from '../shared/pool-tags.js';

// Why (13 Nov 2026, Gitar on web #643: the door is public, so every limit is on one fixed bucket and none on the id, which anyone can rotate): a share holds at most MAX_CI_BOARDS hosts with
// MAX_COUNTRIES countries each; at most PER_HOUR shares an hour; at most DAILY_ROWS rows touched a day. A genuine CI run sends tens of names a day; a flood stops at the daily cap, and the
// table keeps the newest MAX_CI_ROWS (oldest day first out, never one day's rows evicting another's by name).
export const CI_INSTALL = /^ci-search-[\w-]{0,50}$/, MAX_CI_BOARDS = 150, MAX_COUNTRIES = 3, MAX_CI_ROWS = 6000, CI_DAYS = 90, PER_HOUR = 30, DAILY_ROWS = 1500;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

// Why (13 Nov 2026, owner via sa: "send that number with the host (a count, fixed shape, validator both ends, capped), the site keeps the highest seen"): `local` is how many jobs the search kept from the
// board in the person's place, a count 0..MAX_LOCAL. Anything else (a string, a negative, a fraction, past the cap) is 0: not reported, never a rejected share. The Scout reads boards that gave jobs first.
export const MAX_LOCAL = 999;
/** The count a CI item reports: an integer 0..MAX_LOCAL, else 0. Also used by api/scout-memory.js on what it reads back. */
export const localCount = value => Number.isInteger(value) && value >= 0 && value <= MAX_LOCAL ? value : 0;

/** Handles a share from a CI run: {v, install: 'ci-search-…', ci_boards: [{host, countries, local?}]}; stores each (host, country) once, today, with the highest `local` seen. */
export async function ciBoards(body, env, now = new Date()) {
  const today = now.toISOString().slice(0, 10), rows = [], seen = new Map();
  let dropped = 0;
  for (const item of (Array.isArray(body.ci_boards) ? body.ci_boards : []).slice(0, MAX_CI_BOARDS)) {
    const host = typeof item?.host === 'string' && HOST.test(item.host) && item.host.length <= 100 && !/^e2e/.test(item.host) ? item.host : null;
    const countries = [...new Set((Array.isArray(item?.countries) ? item.countries : []).filter(code => COUNTRIES.includes(code)))].sort().slice(0, MAX_COUNTRIES);
    if (!host || !countries.length) { dropped += 1; continue; }
    const local = localCount(item.local);
    for (const country of countries) {
      const known = seen.get(`${host}|${country}`);
      if (known) known[2] = Math.max(known[2], local); else { const row = [host, country, local]; seen.set(`${host}|${country}`, row); rows.push(row); }
    }
  }
  if (!rows.length) return Response.json({ok: false, error: 'no valid boards'}, {status: 400});
  const kv = env.WAITLIST, hour = `ci-boards:${Math.floor(now.getTime() / 3_600_000)}`, used = kv ? Number(await kv.get(hour)) || 0 : 0;
  const todays = Number((await env.STATS.prepare('SELECT COUNT(*) AS n FROM ci_boards WHERE day = ?').bind(today).first())?.n) || 0;
  if (used >= PER_HOUR || todays + rows.length > DAILY_ROWS) return Response.json({ok: false, error: 'too many CI shares'}, {status: 429});
  if (kv) await kv.put(hour, String(used + 1), {expirationTtl: 7200});
  await env.STATS.batch(rows.map(([host, country, local]) => env.STATS.prepare('INSERT INTO ci_boards (host, country, day, local) VALUES (?, ?, ?, ?) ON CONFLICT(host, country) DO UPDATE SET day = excluded.day, local = MAX(local, excluded.local)').bind(host, country, today, local)));
  const oldest = new Date(now.getTime() - CI_DAYS * 86_400_000).toISOString().slice(0, 10);
  await env.STATS.prepare('DELETE FROM ci_boards WHERE day < ? OR rowid IN (SELECT rowid FROM ci_boards ORDER BY day DESC, rowid DESC LIMIT -1 OFFSET ?)').bind(oldest, MAX_CI_ROWS).run();
  return Response.json({ok: true, stored: rows.length, ...(dropped ? {dropped: {ci_boards: dropped}} : {})});
}
