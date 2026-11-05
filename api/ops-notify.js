// POST /ops/notify: the switchboard's one door for CI and other Workers' senders (contract and answers: shared/notify.js). Bearer SELFHEAL_PUBLISH_KEY, the key every CI upload uses.
import {equal} from '../shared/guard.js';
import {notify} from '../shared/notify.js';

const MAX_BODY = 8000;
const JSON_HEADERS = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};

/** POST /ops/notify. Anything but a POST with the CI key is a 404, as the other CI uploads answer. */
export async function route(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (request.method !== 'POST' || !env.SELFHEAL_PUBLISH_KEY || !equal(given, env.SELFHEAL_PUBLISH_KEY)) return new Response('Not found', {status: 404});
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response('Too large', {status: 413});
  let payload; try { payload = JSON.parse(text); } catch { return new Response('Not JSON', {status: 400}); }
  const {status, body} = await notify(env, payload);
  return new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
}
