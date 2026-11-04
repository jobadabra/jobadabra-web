// "Connect with LinkedIn" for the desktop app (Sign In with LinkedIn using OpenID Connect: name, email, LinkedIn id; nothing else, LinkedIn gives
// positions and skills only to registered companies). The app never holds the secret. It opens /api/linkedin/start with a random `state` it made; LinkedIn sends the user back to
// /api/linkedin/callback; this Worker trades the one-time code for a token, reads the member's OpenID profile ONCE, drops the token, and passes only that profile ON, in that same
// request, to the app on the consenting browser's own machine (shared/oauth-handoff.js). It keeps NOTHING: no store, no endpoint to poll. Configuration: LINKEDIN_CLIENT_ID (var)
// and LINKEDIN_CLIENT_SECRET (secret), see wrangler.toml. Guarded by test/unit/api/linkedin.test.js.
import {cardPage} from '../shared/card-page.js';
import {STATE, legacyPoll, legacyStart, toApp} from '../shared/oauth-handoff.js';
export const CALLBACK = '/api/linkedin/callback';
const SCOPE = 'openid profile email';

const page = (title, text, ok) => cardPage({title, body: `<p>${text}</p>`, tone: ok ? 'ok' : 'bad', status: ok ? 200 : 400});   // the site's one card (shared/card-page.js)
const configured = env => env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET;

// GET /api/linkedin/start?state=… -> LinkedIn's consent page. An installed app's old ?session=… is told to update.
export function start(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!state && url.searchParams.get('session')) return legacyStart();
  if (!configured(env)) return page('Not available yet', 'Connect with LinkedIn isn\'t set up on this server yet.', false);
  if (!STATE.test(state)) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorize.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: url.origin + CALLBACK,
    state, scope: SCOPE}).toString();
  return Response.redirect(authorize.toString(), 302);
}

// GET /api/linkedin/callback?code=…&state=… (from LinkedIn) -> the member's OpenID profile, passed on to the app on this browser's machine. The token is not kept.
export async function callback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (url.searchParams.get('error')) return page('Not connected', 'You cancelled on LinkedIn\'s page. Go back to Jobadabra and try again.', false);
  if (!configured(env) || !STATE.test(state) || !url.searchParams.get('code')) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const tokenResponse = await fetcher('https://www.linkedin.com/oauth/v2/accessToken', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: url.origin + CALLBACK,
      client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET}).toString()});
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.access_token) return page('Not connected', `LinkedIn said: ${String(token.error_description || token.error || tokenResponse.status).slice(0, 200)}. Try again from the app.`, false);
  const infoResponse = await fetcher('https://api.linkedin.com/v2/userinfo', {headers: {Authorization: `Bearer ${token.access_token}`}});
  const info = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || !info.sub) return page('Not connected', 'LinkedIn did not share your profile. Try again from the app.', false);
  return toApp('linkedin-signin', state, {sub: String(info.sub), name: info.name || '', given_name: info.given_name || '', family_name: info.family_name || '',
    email: info.email_verified === false ? '' : info.email || '', locale: typeof info.locale === 'string' ? info.locale : (info.locale?.language || '')});
}

// POST /api/linkedin/token: the old poll of installed apps. Nothing is held any more, so it says to update.
export const collect = legacyPoll;
