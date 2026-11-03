// The one way a sign-in or connect result gets from this site back to the desktop app (Connect with Notion, Sign in with LinkedIn, Import from LinkedIn): the site trades the provider's
// code, then answers THE CONSENTING BROWSER with a page that POSTs the result to the app's own socket on that machine (http://127.0.0.1:47111/<flow>/callback), and keeps nothing: no store,
// no endpoint to poll. The app takes the result only for a `state` it made and is still waiting on (desktop/lib/oauth-handoff.js).
// Why (3 Nov 2026, Gitar on web#336; owner: "Both now"): these flows used to file the result under a session id the CALLER picked and give it to whoever asked with that id, so the result of
// one person's consent could be collected by someone else. A result that only ever lands on the machine of the person who consented has no one else to give it to.
// Why a POST body, not a redirect with the result in the address (independent review, 3 Nov 2026): the browser records the address of every page it opens, so a token in a query string stays in
// the person's history (and history sync); a form body does not. The old poll routes stay as answers that say "update the app" (legacyPoll, legacyStart): an installed app that still polls cannot
// be told from someone else who knows its id, so there is no safe way to keep it working. Guard: test/shared/oauth-handoff.test.js (every flow in FLOWS).
import {cardPage} from './card-page.js';

export const STATE = /^[A-Za-z0-9_-]{32,128}$/;
export const APP_ORIGIN = 'http://127.0.0.1:47111';   // the app's own socket (desktop/lib/server-listen.js DEFAULT_PORT)
export const FLOWS = ['notion-connect', 'linkedin-signin', 'linkedin-import'];
export const UPDATE_TEXT = 'This version of Jobadabra connects in an older way that is no longer offered. Update Jobadabra, then try again.';

const attr = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};

/**
 * The page that hands the result to the app on the consenting browser's machine: a form POSTed to the app's socket at once (a button when scripts are off). The result is in the form body,
 * never in an address. Not cached, not sent on as a referrer.
 */
export function toApp(flow, state, fields) {
  if (!FLOWS.includes(flow)) throw new Error(`unknown hand-off flow: ${flow}`);
  const inputs = Object.entries({state, ...fields}).map(([name, value]) => `<input type="hidden" name="${attr(name)}" value="${attr(value)}">`).join('');
  const body = `<p>Passing it to Jobadabra on this computer…</p><form method="post" action="${APP_ORIGIN}/${flow}/callback">${inputs}<noscript><button type="submit">Continue to Jobadabra</button></noscript></form>`
    + '<script>document.forms[0].submit()</script>';
  const response = cardPage({title: 'Opening Jobadabra', body});
  for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value);
  return response;
}

/** An installed app's old poll (POST .../token): nothing is held to hand out, so it says to update. */
export const legacyPoll = () => new Response(JSON.stringify({ok: false, gone: true, error: UPDATE_TEXT}), {status: 410, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

/** An installed app's old start (?session=…, no ?state=…). */
export const legacyStart = () => cardPage({title: 'Update Jobadabra', body: `<p>${UPDATE_TEXT}</p>`, tone: 'bad', status: 410});
