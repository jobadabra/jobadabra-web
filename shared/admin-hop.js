// Moves a browser's /admin page view from an old host (www.jobpilotto.top, www.jobpilotto.workers.dev) to the same page on the main one.
// Signed in: the sign-in is carried over (cookies are per host): www.jobadabra.top/admin/hop with a 60-second, one-use token; that route
// sets the same session cookie there and lands on the same page. Signed out: a plain 302 to the same path there. No key is ever shown.
// Scripts, the pages' own fetches, signed report files and writes stay answered where they are. Anything wrong with a token is the usual 404.
// Guards: test/unit/shared/admin-hop.test.js, test/unit/shared/old-hosts.test.js (every old host × every kind of request).
import {SESSION_COOKIE, SESSION_DAYS, same, sessionToken, sign, validSession} from './auth.js';
import {MAIN_HOST, OLD_HOSTS} from './hosts.js';

const HOP_SECONDS = 60;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const notFound = () => new Response('Not found', {status: 404});
// Same-origin admin paths only: no scheme, no //, no backslash, nothing that is not an /admin page.
export const safeTo = to => /^\/admin(\/[\w\-./]*)?(\?[\w\-.~%=&+,:]*)?$/.test(String(to || '')) && !String(to).includes('//') && !String(to).includes('/../');
const cookieOf = request => (request.headers.get('Cookie') || '').split(/;\s*/).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || '';

// Old host, a browser's /admin page view (Accept text/html, no Bearer, no ?key, no X-Caller) -> 302 to the main host: through the hop when
// signed in, straight to the same path when not. 302, never 301: a cached 301 would skip the hop on a later signed-in visit. Else null.
export async function hopOut(request, env, now = Date.now()) {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !env.STATS_KEY) return null;
  const url = new URL(request.url);
  if (!OLD_HOSTS.includes(url.hostname) || !(url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return null;
  if (/^\/admin\/(join|hop|(?:operations\/)?e2e\/report\/)/.test(url.pathname) || request.headers.get('Authorization') || url.searchParams.has('key')) return null;
  if (!(request.headers.get('Accept') || '').includes('text/html') || request.headers.get('X-Caller')) return null;
  const to = url.pathname + url.search;
  if (!safeTo(to)) return null;
  if (!await validSession(env, cookieOf(request), now))
    return new Response(null, {status: 302, headers: {'Cache-Control': 'no-store', Location: `https://${MAIN_HOST}${to}`}});
  const exp = Math.floor(now / 1000) + HOP_SECONDS, nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const token = `h1.${exp}.${nonce}.${await sign(env.STATS_KEY, `hop|${exp}|${nonce}|${to}`)}`;
  return new Response(null, {status: 302, headers: {'Cache-Control': 'no-store',
    Location: `https://${MAIN_HOST}/admin/hop?t=${encodeURIComponent(token)}&to=${encodeURIComponent(to)}`}});
}

// GET /admin/hop?t=…&to=…: a good, unused, unexpired token for exactly that path -> the session cookie and a 302 to it. Else 404.
export async function hopIn(request, env, now = Date.now()) {
  const url = new URL(request.url), to = url.searchParams.get('to') || '';
  const match = /^h1\.(\d{10})\.([\w-]{16,32})\.([\w-]{40,})$/.exec(url.searchParams.get('t') || '');
  if (!match || !env.STATS_KEY || !env.WAITLIST || !safeTo(to) || Number(match[1]) * 1000 < now) return notFound();
  if (!same(match[3], await sign(env.STATS_KEY, `hop|${match[1]}|${match[2]}|${to}`))) return notFound();
  const slot = `admin-hop:${match[2]}`;
  if (await env.WAITLIST.get(slot)) return notFound();   // already used
  await env.WAITLIST.put(slot, '1', {expirationTtl: 120});
  return new Response(null, {status: 302, headers: {Location: to, 'Cache-Control': 'no-store',
    'Set-Cookie': `${SESSION_COOKIE}=${await sessionToken(env, now)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`}});
}
