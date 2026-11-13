// The job boards our own CI searches read, reported as names for the Central Scout's board pass (jobadabra tools/persona-search/report_boards.py).
// Why (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Any install + our CI searches (Recommended)"; "Let's fix it" about the missing feed): Jobeka and Trabajo.org gave a Madrid
// electrician 19 and 16 right jobs in CI searches and no source ever told the Scout. Design: a report is marked by its install id `ci-search-<run>` (the raw id; pool.js hashes real installs,
// so this prefix is told before hashing) and goes to its own table `ci_boards` (host, country, day): never into sitefacts, so no install count, no k >= 3 fact and no yield number an app
// is served can ever include CI. Only names: no person, no job, no title, no template. Faking the mark gains nothing: it can only add a candidate name for the Scout, which counts it itself.
import {COUNTRIES} from '../shared/pool-tags.js';

export const CI_INSTALL = /^ci-search-[\w-]{0,50}$/, MAX_CI_BOARDS = 300, MAX_CI_ROWS = 6000, CI_DAYS = 90;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Handles a share from a CI run: {v, install: 'ci-search-…', ci_boards: [{host, countries}]}; stores each (host, country) once, today. */
export async function ciBoards(body, env, now = new Date()) {
  const today = now.toISOString().slice(0, 10), rows = [], seen = new Set();
  let dropped = 0;
  for (const item of (Array.isArray(body.ci_boards) ? body.ci_boards : []).slice(0, MAX_CI_BOARDS)) {
    const host = typeof item?.host === 'string' && HOST.test(item.host) && item.host.length <= 100 && !/^e2e/.test(item.host) ? item.host : null;
    const countries = [...new Set((Array.isArray(item?.countries) ? item.countries : []).filter(code => COUNTRIES.includes(code)))].sort();
    if (!host || !countries.length) { dropped += 1; continue; }
    for (const country of countries) if (!seen.has(`${host}|${country}`)) { seen.add(`${host}|${country}`); rows.push([host, country]); }
  }
  if (!rows.length) return Response.json({ok: false, error: 'no valid boards'}, {status: 400});
  await env.STATS.batch(rows.map(([host, country]) => env.STATS.prepare('INSERT INTO ci_boards (host, country, day) VALUES (?, ?, ?) ON CONFLICT(host, country) DO UPDATE SET day = excluded.day').bind(host, country, today)));
  const oldest = new Date(now.getTime() - CI_DAYS * 86_400_000).toISOString().slice(0, 10);
  await env.STATS.prepare('DELETE FROM ci_boards WHERE day < ? OR rowid IN (SELECT rowid FROM ci_boards ORDER BY day DESC, host LIMIT -1 OFFSET ?)').bind(oldest, MAX_CI_ROWS).run();
  return Response.json({ok: true, stored: rows.length, ...(dropped ? {dropped: {ci_boards: dropped}} : {})});
}
