// The one mark of CI's honest-browser reads of job boards that refuse the plain reader: one read per search page per UTC day across every CI search.
// Design (14 Nov 2026, owner via AskUserQuestion, session rb: "Once per host per day, all CI (Recommended)", then D1 "AI broker's store (Recommended)",
//   D2 "For good (Recommended)", D3 "Once per search page (Recommended)"; sketch https://claude.ai/artifact/MS1uKBkVNm5bh9DyViTuCK). ONE owner: this Durable Object's storage,
//   shared by jobadabra and jobadabra-benchmarks (both sign in with their GitHub run token). States of a page on a day: free -> reading (the first run's reserve)
//   -> opened (its jobs kept) | stopped | waiting. A stop (check, captcha, sign-in, 401/403) is per HOST and for good; a 429 is per host until the next UTC day.
//   A reservation never reported stays reading for the rest of the day (the safe side: nobody asks again). Only counts and public listing fields are kept:
//   no page, no cookie, no session. The desktop app never calls this (its own limits live in src/sources/refused_reads.py).

// Why (14 Nov 2026, sa as coordinator, passed to the owner with D3: "cap it at 5 pages per site per day across all CI; after that, nothing more is sent to that site
//   that day"): the app's own limit is 5 boards a day, each once (src/sources/refused_reads.py DAY_SITES); CI must not be more persistent than a person's app.
export const HOST_PAGES_A_DAY = 5;
export const MAX_JOBS = 200;       // a listing page's jobs kept for reuse; more are dropped (a board page lists 20-50)
const MAX_COUNT = 10_000;           // a page's job count echoed to later searches; outside kept.length..MAX_COUNT it is the jobs kept (Gitar on #656)
const FIELD = 300;                  // characters kept per job field
const OUTCOMES = ['opened', 'stopped', 'waiting'];

/** The UTC day of `now`: "2026-11-14". */
export const dayOf = now => new Date(now).toISOString().slice(0, 10);

/** The host of a search page address, lower case without "www.", or '' for an address that is not http(s). */
export function hostOf(page) {
  try { const u = new URL(String(page)); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; }
}

/**
 * One spelling per search page (Gitar on #656): http(s) only, the host as hostOf, no default port, no fragment, the path and query kept as sent. '' for any other address.
 * Invariant: every key and every host count is built from this form, so "A.com/x", "www.a.com/x#f" and "a.com:443/x" are one page and spend one read.
 */
export function pageOf(page) {
  try {
    const u = new URL(String(page)), host = hostOf(page);
    return host ? `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${u.pathname}${u.search}` : '';
  } catch { return ''; }
}

/** One job's public listing fields, each a trimmed string of at most FIELD characters; null without an http(s) link or a title. */
function cleanJob(job) {
  const text = v => (typeof v === 'string' ? v.trim().slice(0, FIELD) : '');
  const out = {title: text(job?.title), url: text(job?.url), company: text(job?.company), place: text(job?.place), date: text(job?.date)};
  return out.title && hostOf(out.url) ? out : null;
}

/** Storage keys: one per page and day (a page's jobs can be ~15 KB, a value holds 128 KiB), one per host and day (pages reserved, a 429), one per stopped host. */
const pageKey = (day, page) => `board-read:${day}:${page}`;
const hostKey = (day, host) => `board-host:${day}:${host}`;
const stopKey = host => `board-stop:${host}`;

/**
 * reserve: may run `who` load `page` in its browser now? -> {status, reply}. reply.go true only for the first caller of a free page on a host that is neither
 * stopped, waiting nor at HOST_PAGES_A_DAY today. Otherwise go false with state: 'opened' (+ jobs, read_by, read_at: reuse them, send nothing), 'reading',
 * 'stopped', 'waiting' or 'host-full'. Pure over `get`/`put`/`del` (the Durable Object's storage, or a Map in tests).
 */
export async function reserve(store, who, address, now) {
  const page = pageOf(address), host = hostOf(page);
  if (!page) return {status: 400, reply: {error: 'page: an http(s) address'}};
  const day = dayOf(now);
  const stop = await store.get(stopKey(host));
  if (stop) return {status: 200, reply: {go: false, state: 'stopped', why: stop.why, since: stop.at}};
  const entry = await store.get(pageKey(day, page));
  if (entry?.state === 'opened') return {status: 200, reply: {go: false, state: 'opened', jobs: entry.jobs, count: entry.count, read_by: entry.who, read_at: entry.at}};
  if (entry) return {status: 200, reply: {go: false, state: entry.state}};
  const today = (await store.get(hostKey(day, host))) || {pages: 0, waiting: false};
  if (today.waiting) return {status: 200, reply: {go: false, state: 'waiting'}};
  if (today.pages >= HOST_PAGES_A_DAY) return {status: 200, reply: {go: false, state: 'host-full', limit: HOST_PAGES_A_DAY}};
  // Invariant: no await but storage between the reads above and these writes, so the object's input gate keeps two reserves from both going.
  await store.put(hostKey(day, host), {...today, pages: today.pages + 1});
  await store.put(pageKey(day, page), {state: 'reading', who, at: new Date(now).toISOString()});
  return {status: 200, reply: {go: true, day, limit: HOST_PAGES_A_DAY, left: HOST_PAGES_A_DAY - today.pages - 1}};
}

/**
 * report: the reserving run says how its read ended. outcome 'opened' keeps `jobs` (public fields only, at most MAX_JOBS) and `count`; 'stopped' stops the host
 * for good for all CI; 'waiting' (a 429) stops the host until the next UTC day. Only the run that reserved `page` today, while it still reads, may report. -> {status, reply}.
 */
export async function report(store, who, address, outcome, {jobs = [], count = null, why = ''} = {}, now) {
  const page = pageOf(address), host = hostOf(page);
  if (!page || !OUTCOMES.includes(outcome)) return {status: 400, reply: {error: `page: an http(s) address; outcome: one of ${OUTCOMES.join(', ')}`}};
  const day = dayOf(now), at = new Date(now).toISOString();
  const entry = await store.get(pageKey(day, page));
  if (!entry || entry.state !== 'reading' || entry.who !== who) return {status: 409, reply: {error: 'not your read: reserve this page first, today, from this run'}};
  const kept = (Array.isArray(jobs) ? jobs : []).map(cleanJob).filter(Boolean).slice(0, MAX_JOBS);
  const reason = String(why || '').slice(0, 80);
  if (outcome === 'stopped') await store.put(stopKey(host), {at, why: reason, page, who});
  if (outcome === 'waiting') await store.put(hostKey(day, host), {...((await store.get(hostKey(day, host))) || {pages: 1}), waiting: true});
  await store.put(pageKey(day, page), outcome === 'opened' ? {state: 'opened', who, at, jobs: kept, count: Number.isInteger(count) && count >= kept.length && count <= MAX_COUNT ? count : kept.length} : {state: outcome, who, at, why: reason});
  return {status: 200, reply: {kept: outcome === 'opened' ? kept.length : 0, state: outcome}};
}

/** Deletes the page and host keys of days before `now`'s (stops are kept for good). Called on a day's first reserve; never fails the caller. */
export async function forgetOldDays(storage, now) {
  const day = dayOf(now);
  if ((await storage.get('board-day')) === day) return 0;
  const old = [];
  for (const prefix of ['board-read:', 'board-host:']) for (const key of (await storage.list({prefix})).keys()) if (!key.startsWith(`${prefix}${day}:`)) old.push(key);
  for (let i = 0; i < old.length; i += 128) await storage.delete(old.slice(i, i + 128));   // Durable Object storage deletes at most 128 keys a call
  await storage.put('board-day', day);
  return old.length;
}

/** What /health shows: today's pages by state and the hosts stopped for good (hosts only, no page, no job). */
export async function boardView(storage, now) {
  const day = dayOf(now), states = {};
  for (const entry of (await storage.list({prefix: `board-read:${day}:`})).values()) states[entry.state] = (states[entry.state] || 0) + 1;
  const stopped = [...(await storage.list({prefix: 'board-stop:'})).keys()].map(key => key.slice('board-stop:'.length));
  return {day, pages: states, stopped, limit: HOST_PAGES_A_DAY};
}

/** The Durable Object's side: POST {op: 'reserve'|'report', page, outcome?, jobs?, count?, why?}; `who` comes from the outer Worker's verified token only. */
export async function boardFetch(storage, request, who, now = Date.now()) {
  let body; try { body = await request.json(); } catch { body = {}; }
  await forgetOldDays(storage, now).catch(() => 0);
  const result = body.op === 'reserve' ? await reserve(storage, who, body.page, now)
    : body.op === 'report' ? await report(storage, who, body.page, body.outcome, body, now)
      : {status: 400, reply: {error: "op: 'reserve' or 'report'"}};
  return Response.json(result.reply, {status: result.status});
}
