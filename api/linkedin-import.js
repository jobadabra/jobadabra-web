// "Import your profile from LinkedIn" for the desktop app (LinkedIn Member Data Portability API, 3rd party; spec in the public repo,
// docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md). The app cannot hold the client secret (public repo), so the site runs the consent:
// /start sends the person to LinkedIn's own page with scope r_dma_portability_3rd_party; LinkedIn returns to /callback (HTTPS, registered in the app); this
// Worker trades the one-time code for an access token and passes it ON, in that same request, to the app listening on THE CONSENTING BROWSER'S OWN machine
// (a form POSTed to http://127.0.0.1:47111/linkedin-import/callback, shared/oauth-handoff.js). It keeps NOTHING: no store, no polling endpoint.
// Why (3 Nov 2026, Gitar on web#336): the first design held the token under an id the app chose and gave it to whoever polled with that id, so an attacker's
// /start link with the attacker's id made a victim's consent hand the victim's 60-day token to the attacker. Now the token can only land on the machine of the
// person who consented, and the app accepts it only for a state it made itself (lib/linkedin-import.js). The site never fetches the person's profile: the app
// calls api.linkedin.com itself. POST /revoke asks LinkedIn to revoke a token the app is disconnecting, keeps nothing. This is the LinkedIn app "Jobadabra"
// (264991117), not the sign-in one (api/linkedin.js, 264977227): a different scope, and a new scope on one app would invalidate the other's tokens.
// Nothing here is about LinkedIn jobs. Configuration: LINKEDIN_IMPORT_CLIENT_ID (var) and LINKEDIN_IMPORT_CLIENT_SECRET (secret), see wrangler.toml.
// Guarded by test/unit/api/linkedin-import.test.js.
import {cardPage} from '../shared/card-page.js';
import {STATE, toApp} from '../shared/oauth-handoff.js';

const SCOPE = 'r_dma_portability_3rd_party';
export const CALLBACK = '/api/linkedin-import/callback';

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const page = (title, text, ok) => cardPage({title, body: `<p>${text}</p>`, tone: ok ? 'ok' : 'bad', status: ok ? 200 : 400});
const configured = env => env.LINKEDIN_IMPORT_CLIENT_ID && env.LINKEDIN_IMPORT_CLIENT_SECRET;
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const notSetUp = () => page('Not available yet', 'Importing from LinkedIn isn\'t set up on this server yet.', false);

// GET /api/linkedin-import/start?state=… -> LinkedIn's consent page. `state` is the app's own random value; it comes back to the app, never to anyone else.
export function start(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!configured(env)) return notSetUp();
  if (!STATE.test(state)) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_IMPORT_CLIENT_ID, redirect_uri: url.origin + CALLBACK, state, scope: SCOPE}).toString();
  return Response.redirect(authorize.toString(), 302);
}

// GET /api/linkedin-import/callback?code=…&state=… (from LinkedIn) -> the access token, passed on to the app on this browser's machine. Nothing else is read from LinkedIn.
export async function callback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!configured(env)) return notSetUp();
  if (url.searchParams.get('error')) {
    const why = escapeHtml(String(url.searchParams.get('error_description') || url.searchParams.get('error')).slice(0, 200));
    return page('Not imported', `LinkedIn said: ${why}. Importing works for LinkedIn members in the EU, EEA and Switzerland. Go back to Jobadabra: you can use your LinkedIn data file instead.`, false);
  }
  if (!STATE.test(state) || !url.searchParams.get('code')) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const response = await fetcher('https://www.linkedin.com/oauth/v2/accessToken', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: url.origin + CALLBACK,
      client_id: env.LINKEDIN_IMPORT_CLIENT_ID, client_secret: env.LINKEDIN_IMPORT_CLIENT_SECRET}).toString()});
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) return page('Not imported', `LinkedIn said: ${escapeHtml(String(token.error_description || token.error || response.status).slice(0, 200))}. Try again from the app.`, false);
  return toApp('linkedin-import', state, {access_token: token.access_token, expires_in: String(Number(token.expires_in) || 0)});
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
