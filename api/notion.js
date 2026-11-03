// "Connect with Notion" for the desktop app (Notion's public-connection OAuth). The app never holds the connection's secret: it opens /api/notion/start with a random `state`
// it made, Notion sends the user back to /api/notion/callback, this Worker trades the one-time code for the user's token and passes it ON, in that same request, to the app on the
// consenting browser's own machine (shared/oauth-handoff.js). It keeps NOTHING: no store, no endpoint to poll. Configuration: NOTION_CLIENT_ID (var) and NOTION_CLIENT_SECRET
// (secret); see workers/www/wrangler.toml. With the connection's template URL set, Notion copies the Jobadabra template for the user and the token carries
// duplicated_template_id, which the app builds on (desktop/lib/notion-workspace.js). Guarded by test/api/notion.test.js.
import {cardPage} from '../shared/card-page.js';
import {STATE, legacyPoll, legacyStart, toApp} from '../shared/oauth-handoff.js';
export const CALLBACK = '/api/notion/callback';

const page = (title, text, ok) => cardPage({title, body: `<p>${text}</p>`, tone: ok ? 'ok' : 'bad', status: ok ? 200 : 400});   // the site's one card (shared/card-page.js)
const configured = env => env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET;

// GET /api/notion/start?state=… -> Notion's consent page. An installed app's old ?session=… is told to update.
export function start(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!state && url.searchParams.get('session')) return legacyStart();
  if (!configured(env)) return page('Not available yet', 'Connect with Notion isn\'t set up on this server. In the app, use "Paste a token instead".', false);
  if (!STATE.test(state)) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const authorize = new URL('https://api.notion.com/v1/oauth/authorize');
  authorize.search = new URLSearchParams({client_id: env.NOTION_CLIENT_ID, response_type: 'code', owner: 'user',
    redirect_uri: url.origin + CALLBACK, state}).toString();
  return Response.redirect(authorize.toString(), 302);
}

// GET /api/notion/callback?code=…&state=… (from Notion) -> the token, passed on to the app on this browser's machine.
export async function callback(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (url.searchParams.get('error')) return page('Not connected', 'You cancelled on Notion\'s page. Go back to Jobadabra and try again.', false);
  if (!configured(env) || !STATE.test(state) || !url.searchParams.get('code')) return page('Something went wrong', 'Start again from the Jobadabra app.', false);
  const response = await fetcher('https://api.notion.com/v1/oauth/token', {method: 'POST', headers: {
    Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28'},
    body: JSON.stringify({grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: url.origin + CALLBACK})});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return page('Not connected', `Notion said: ${String(data.message || data.error || response.status).slice(0, 200)}. Try again from the app.`, false);
  return toApp('notion-connect', state, {access_token: data.access_token, workspace_name: data.workspace_name || '', workspace_id: data.workspace_id || '',
    duplicated_template_id: data.duplicated_template_id || '', ...(data.refresh_token ? {refresh_token: data.refresh_token} : {})});
}

// POST /api/notion/token: the old poll of installed apps. Nothing is held any more, so it says to update.
export const collect = legacyPoll;
