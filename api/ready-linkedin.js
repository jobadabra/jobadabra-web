// The `linkedin` night of the cloud runner (spec jobadabra docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6; owner, 11 Nov 2026: "Prove one cloud read first"): the owner's install posts ONE LinkedIn Jobs search address and a LinkedIn session
// (li_at, JSESSIONID); the session is sealed in the batch blob like the user's own AI key, handed only to that batch's night token (GET /api/ready/batch), and removed the moment the night reports (api/ready.js result), whatever it reports.
// The night's read ({status, path, cards, go, word}: what LinkedIn answered, never the session) is sealed and taken like a readiness read (api/ready-read.js). Only the owner's install may start it; an Always on install never can (that is 5/6, after the owner's yes).
// Invariants: the session is never in an error, a log, a row or an event; one address, one job; anything else is refused before anything is stored. Guard: test/unit/api/ready/ready-linkedin.test.js.
const TOKEN = /^[\x21-\x7e]{1,2048}$/;   // one printable token, as the app's own check (desktop/lib/linkedin-session.js)
export const PROBE_JOB = 'probe', PROBE_HOST = 'www.linkedin.com';

/** Pure: the batch a `linkedin` night is made from. -> {session: {li_at, JSESSIONID?}} when it is exactly one https LinkedIn Jobs search address and a well-formed session, else {error} (a word, never the session). */
export function checkProbe(given) {
  const jobs = given?.jobs;
  if (!Array.isArray(jobs) || jobs.length !== 1 || jobs[0]?.id !== PROBE_JOB) return {error: 'bad probe'};
  let url;
  try { url = new URL(String(jobs[0].url)); } catch { return {error: 'bad probe'}; }
  if (url.protocol !== 'https:' || url.hostname !== PROBE_HOST || !/^\/jobs\/search\/?$/.test(url.pathname)) return {error: 'bad probe'};
  const session = given.linkedin;
  if (!session || typeof session.li_at !== 'string' || !TOKEN.test(session.li_at)) return {error: 'bad session'};
  if (session.JSESSIONID !== undefined && !(typeof session.JSESSIONID === 'string' && TOKEN.test(session.JSESSIONID))) return {error: 'bad session'};
  return {session: {li_at: session.li_at, ...(session.JSESSIONID ? {JSESSIONID: session.JSESSIONID} : {})}};
}

/** Pure: the word the night reports for the row (`wall`): a-z only, at most 20 characters ("ok", "check", "limited", ...). */
export const wordOf = given => String(given?.why || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
