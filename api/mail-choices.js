// GET / POST /api/mail/choices: the app reads and writes the person's choice per app mail (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md §2 and §4, PR 3;
// the app's switches in Automation and Notifications come in PR 4). Same key as POST /api/notify/email (the install's trial key, or the JPT1 key an Always on repo holds).
// GET -> {ok, rows: [{id, name, when, suggested, choice: 'on' | 'off' | ''}]}; POST {mail, on: boolean} -> {ok} or {ok: false, reason}. Guard: test/unit/api/mail-choices.test.js.
import {accountOf} from '../shared/pro.js';
import {installOfTrialKey} from '../shared/trial-key.js';
import {addrOf} from '../shared/mail.js';
import {choicesOf, setChoice} from '../shared/mail-choices.js';
import {APP_ROWS, mailOf} from '../shared/mail-registry.js';

const json = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function choices(request, env, now = new Date()) {
  const install = (await installOfTrialKey(request.headers.get('x-api-key'), env))?.install;
  if (!install || !env.STATS) return json(401, {ok: false, reason: 'unauthorized'});
  if (!['GET', 'POST'].includes(request.method)) return json(405, {ok: false});
  const account = await accountOf(env, install);
  const rows = (stored = {}) => json(200, {ok: true, rows: APP_ROWS.map(id => { const {name, when, suggested} = mailOf(id); return {id, name, when, suggested, choice: stored[id] || ''}; })});
  if (!account?.email) return request.method === 'GET' ? rows() : json(200, {ok: false, reason: 'no_address'});   // Why (PR 4): the app shows the rows before any address reached the site; the first press saves the address, then the choice
  const addr = await addrOf(account.email);
  if (request.method === 'POST') {
    // Why (review of hr-31): the repo key (JPT1) an Always on repo holds may read, never write: a leaked copy must not turn a person's "off" back on. Only the app's own key (JPF1) writes.
    if (!String(request.headers.get('x-api-key') || '').startsWith('JPF1.')) return json(403, {ok: false, reason: 'app_only'});
    const body = await request.json().catch(() => ({}));
    if (!APP_ROWS.includes(body.mail) || typeof body.on !== 'boolean') return json(400, {ok: false, reason: 'bad_request'});
    try { await setChoice(env, addr, body.mail, body.on, 'app', now); } catch { return json(503, {ok: false, reason: 'not_saved'}); }   // the app keeps the switch where it was and says so
    return json(200, {ok: true});
  }
  let stored;
  try { stored = await choicesOf(env, addr); } catch { return json(503, {ok: false, reason: 'not_read'}); }   // never answer "nothing chosen" when the read failed
  return rows(stored);
}
