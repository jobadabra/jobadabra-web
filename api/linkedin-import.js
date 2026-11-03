// "Import your profile from LinkedIn" for the desktop app (LinkedIn Member Data Portability API, 3rd party; spec in the public repo,
// docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md). The app never holds the client secret (public repo), so the site runs the
// consent: /start sends the person to LinkedIn's own page with scope r_dma_portability_3rd_party; /callback trades the one-time code for an access
// token and keeps ONLY that token, AES-GCM encrypted, 10 minutes, under a hash of the app's session id (the key is derived from the session id,
// which is never stored, so a reader of the store cannot decrypt it); the app collects it once with POST /token (deleted on read). The site never
// fetches the person's profile: the app calls api.linkedin.com itself, so the profile data does not pass through this server. POST /revoke asks
// LinkedIn to revoke a token the app is disconnecting, keeps nothing. This is the LinkedIn app "Jobadabra" (264991117), not the sign-in one
// (api/linkedin.js, 264977227): a different scope, and a new scope on one app would invalidate the other's tokens. Nothing here is about LinkedIn jobs.
// Configuration: LINKEDIN_IMPORT_CLIENT_ID (var) and LINKEDIN_IMPORT_CLIENT_SECRET (secret), see wrangler.toml. Guarded by test/api/linkedin-import.test.js.
import {cardPage} from '../shared/card-page.js';

const TTL = 600;
const SESSION = /^[A-Za-z0-9_-]{32,128}$/;
const SCOPE = 'r_dma_portability_3rd_party';
export const CALLBACK = '/api/linkedin-import/callback';

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const page = (title, text, ok) => cardPage({title, body: `<p>${text}</p>`, tone: ok ? 'ok' : 'bad', status: ok ? 200 : 400});
const configured = env => env.LINKEDIN_IMPORT_CLIENT_ID && env.LINKEDIN_IMPORT_CLIENT_SECRET && env.WAITLIST;
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const bytes = text => new TextEncoder().encode(text);
const b64 = array => btoa(String.fromCharCode(...new Uint8Array(array)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', bytes(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Why (3 Nov 2026): the store key is sha256(session), so the AES key must come from something else of the session; a store reader sees neither.
const keyOf = async session => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes(`linkedin-import-key:${session}`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(session, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await keyOf(session), bytes(JSON.stringify(value)));
  return JSON.stringify({iv: b64(iv), data: b64(sealed)});
}
async function open(session, kept) {
  const {iv, data} = JSON.parse(kept);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, await keyOf(session), unb64(data))));
}

// GET /api/linkedin-import/start?session=… -> LinkedIn's consent page.
export function start(request, env) {
  const url = new URL(request.url);
  const session = url.searchParams.get('session') || '';
  if (!configured(env)) return page('Not available yet', 'Importing from LinkedIn isn\'t set up on this server yet.', false);
  if (!SESSION.test(session)) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_IMPORT_CLIENT_ID, redirect_uri: url.origin + CALLBACK, state: session, scope: SCOPE}).toString();
  return Response.redirect(authorize.toString(), 302);
}

// GET /api/linkedin-import/callback?code=…&state=… (from LinkedIn) -> the access token, sealed for the app to collect. Nothing else is read from LinkedIn.
export async function callback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const session = url.searchParams.get('state') || '';
  if (!configured(env)) return page('Not available yet', 'Importing from LinkedIn isn\'t set up on this server yet.', false);
  if (url.searchParams.get('error')) {
    const why = escapeHtml(String(url.searchParams.get('error_description') || url.searchParams.get('error')).slice(0, 200));
    return page('Not imported', `LinkedIn said: ${why}. Importing works for LinkedIn members in the EU, EEA and Switzerland. Go back to Jobadabra: you can use your LinkedIn data file instead.`, false);
  }
  if (!SESSION.test(session) || !url.searchParams.get('code')) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const response = await fetcher('https://www.linkedin.com/oauth/v2/accessToken', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: url.origin + CALLBACK,
      client_id: env.LINKEDIN_IMPORT_CLIENT_ID, client_secret: env.LINKEDIN_IMPORT_CLIENT_SECRET}).toString()});
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) return page('Not imported', `LinkedIn said: ${escapeHtml(String(token.error_description || token.error || response.status).slice(0, 200))}. Try again from the app.`, false);
  await env.WAITLIST.put(`linkedin-import:${await sha256(session)}`, await seal(session, {access_token: token.access_token, expires_in: Number(token.expires_in) || 0}), {expirationTtl: TTL});
  return page('Connected to LinkedIn ✓', 'Go back to Jobadabra: it takes it from here. You can close this tab.', true);
}

// POST /api/linkedin-import/token {session} -> {ok, pending} until the person has approved, then {ok, access_token, expires_in} (once).
export async function collect(request, env) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let body = {};
  try { body = await request.json(); } catch {}
  const session = String(body.session || '');
  if (!SESSION.test(session)) return json(400, {ok: false, error: 'Bad session'});
  if (!configured(env)) return json(503, {ok: false, error: 'Importing from LinkedIn is not set up on this server'});
  const key = `linkedin-import:${await sha256(session)}`;
  const kept = await env.WAITLIST.get(key);
  if (!kept) return json(200, {ok: false, pending: true});
  await env.WAITLIST.delete(key);
  try { return json(200, {ok: true, ...await open(session, kept)}); } catch { return json(200, {ok: false, pending: true}); }
}

// POST /api/linkedin-import/revoke {token} -> {ok}: Disconnect in the app asks LinkedIn to end the grant's token (LinkedIn's revoke call needs the secret). Kept: nothing.
export async function revoke(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let body = {};
  try { body = await request.json(); } catch {}
  const token = String(body.token || '');
  if (token.length < 20 || token.length > 4096) return json(400, {ok: false, error: 'Bad token'});
  if (!configured(env)) return json(503, {ok: false, error: 'Importing from LinkedIn is not set up on this server'});
  const response = await fetcher('https://www.linkedin.com/oauth/v2/revoke', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: env.LINKEDIN_IMPORT_CLIENT_ID, client_secret: env.LINKEDIN_IMPORT_CLIENT_SECRET, token}).toString()}).catch(() => null);
  return json(200, {ok: !!response?.ok});
}
