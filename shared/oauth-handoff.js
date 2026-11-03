// The one way a sign-in or connect result gets from this site back to the desktop app (Connect with Notion, Sign in with LinkedIn): the site trades LinkedIn's or Notion's
// code, then redirects THE CONSENTING BROWSER to the app's own socket on that machine (http://127.0.0.1:47111/<flow>/callback) and keeps nothing: no store, no endpoint to poll.
// The app takes the result only for a `state` it made and is still waiting on (desktop/lib/oauth-handoff.js).
// Why (3 Nov 2026, Gitar on web#336; owner: "Both now"): these flows used to file the result under a session id the CALLER picked and give it to whoever asked with that id,
// so the result of one person's consent could be collected by someone else. A result that only ever lands on the machine of the person who consented has no one else to give it to.
// The old poll routes stay as answers that say "update the app" (legacyPoll, legacyStart): an installed app that still polls cannot be told from someone else who knows its id,
// so there is no safe way to keep it working. Guard: test/shared/oauth-handoff.test.js (every flow in FLOWS).
import {cardPage} from './card-page.js';

export const STATE = /^[A-Za-z0-9_-]{32,128}$/;
export const APP_ORIGIN = 'http://127.0.0.1:47111';   // the app's own socket (desktop/lib/server-listen.js DEFAULT_PORT)
export const FLOWS = ['notion-connect', 'linkedin-signin', 'linkedin-import'];
export const UPDATE_TEXT = 'This version of Jobadabra connects in an older way that is no longer offered. Update Jobadabra, then try again.';

/** 302 to the app on the consenting browser's machine with the result in the query; never cached, never sent on as a referrer. */
export function toApp(flow, state, fields) {
  if (!FLOWS.includes(flow)) throw new Error(`unknown hand-off flow: ${flow}`);
  const to = new URL(`${APP_ORIGIN}/${flow}/callback`);
  to.search = new URLSearchParams({state, ...fields}).toString();
  return new Response(null, {status: 302, headers: {Location: to.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});
}

/** An installed app's old poll (POST .../token): nothing is held to hand out, so it says to update. */
export const legacyPoll = () => new Response(JSON.stringify({ok: false, gone: true, error: UPDATE_TEXT}), {status: 410, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

/** An installed app's old start (?session=…, no ?state=…). */
export const legacyStart = () => cardPage({title: 'Update Jobadabra', body: `<p>${UPDATE_TEXT}</p>`, tone: 'bad', status: 410});
