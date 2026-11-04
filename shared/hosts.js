// The site's hosts. workers.dev serves installed apps and old engine tags: its API is never redirected, only its pages move (27 Oct 2026);
// jobpilotto.top is a replaceable alias (owner, 10 Oct 2026): its bare name sends people to www. Guarded by test/unit/shared/hosts.test.js.
export const ALIAS_APEXES = ['jobadabra.top', 'jobpilotto.top'];   // jobadabra.top: the new main address (19 Oct 2026)

// Static pages are served by Workers Assets before this code runs, so the zone's Cloudflare Redirect Rule (<apex>/* -> www, 301, query kept)
// does the redirect for them; this covers the paths the worker answers itself. Neither touches workers.dev.
// A request to the bare alias domain -> a 301 to the same path on www; any other host (workers.dev, www.jobpilotto.top) -> null.
export function apexRedirect(request) {
  const url = new URL(request.url);
  if (!ALIAS_APEXES.includes(url.hostname)) return null;
  url.protocol = 'https:';   // straight to https: one hop, not two
  url.hostname = `www.${url.hostname}`;
  return Response.redirect(url.toString(), 301);
}

// Our own hosts, www stripped: a referrer from any of them is the site linking to itself (api/downloads.js sourceOf).
export const OWN_HOSTS = [...ALIAS_APEXES, 'jobpilotto.workers.dev'];

// The main address is www.jobadabra.top (owner, 19 Oct 2026). The old name keeps answering for ever: installed apps and the engine call
// www.jobpilotto.top/api/*, /report/*, /telemetry with POSTs and auth headers, which a redirect would break. Only the human pages move.
// A page has one address, https://www.jobadabra.top/<page> (Search Console, 25-26 Oct 2026: the http:// copies were served and Google
// saw two of each page): a GET of a page over http, on the old host, or as /<page>.html -> one 301 there, query kept. wrangler.toml's
// run_worker_first lists the same paths (static pages are otherwise served before this code runs); test/unit/shared/hosts.test.js fails when a
// page in public/ is missing from either.
export const MAIN_HOST = 'www.jobadabra.top';
// The old hosts: their pages and /admin pages move to MAIN_HOST, their API stays. The bare jobpilotto.top goes through apexRedirect first.
// The workers.dev name moves too (owner, 27 Oct 2026: "https://www.jobpilotto.workers.dev/ this should always redirect (301 permanently
// moved) to jobadabra.top"); its API stays (central-scout.yml PUTs /api/index there). Its /admin pages go through shared/admin-hop.js.
export const OLD_HOSTS = ['www.jobpilotto.top', 'www.jobpilotto.workers.dev'];
export const PAGE_PATHS = ['/', '/about-you', '/benchmark', '/changelog', '/compare', '/coverage', '/download', '/faq', '/features', '/friends', '/how-it-works', '/intelligence', '/platforms', '/pricing', '/privacy', '/ready-live', '/research', '/terms', '/trust'];
export function pageRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.hostname !== MAIN_HOST && !OLD_HOSTS.includes(url.hostname)) return null;
  const path = url.pathname.replace(/\.html$/, '').replace(/^\/index$/, '/');
  if (!PAGE_PATHS.includes(path)) return null;
  if (url.hostname === MAIN_HOST && url.protocol === 'https:' && path === url.pathname) return null;   // already its one address
  url.protocol = 'https:';
  url.hostname = MAIN_HOST;
  url.pathname = path;
  return Response.redirect(url.toString(), 301);
}
