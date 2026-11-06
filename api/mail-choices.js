// GET / POST /api/mail/choices: the app reads and writes the person's choice per app mail (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md §2 and §4, PR 3;
// the app's switches in Automation and Notifications come in PR 4). Same key as POST /api/notify/email (the install's trial key, or the JPT1 key an Always on repo holds).
// GET -> {ok, rows: [{id, name, when, suggested, choice: 'on' | 'off' | ''}], news: [{id, name, when, on}]}; POST {mail, on: boolean} -> {ok} or {ok: false, reason}. `news`: the "News from Jobadabra" card.
// Guard: test/unit/api/mail-choices.test.js, test/unit/api/mail-news-switches.test.js.
import {readAccount} from '../shared/pro.js';
import {installOfTrialKey} from '../shared/trial-key.js';
import {addrOf} from '../shared/mail.js';
import {choicesOf, setChoice} from '../shared/mail-choices.js';
import {NEWS, NEWS_SWITCHES, newsAnswer, newsFacts, recordNews} from '../shared/mail-lists.js';
import {APP_ROWS, mailOf} from '../shared/mail-registry.js';

const json = (status, body) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function choices(request, env, now = new Date()) {
  const install = (await installOfTrialKey(request.headers.get('x-api-key'), env))?.install;
  if (!install || !env.STATS) return json(401, {ok: false, reason: 'unauthorized'});
  if (!['GET', 'POST'].includes(request.method)) return json(405, {ok: false});
  // Why (review of hr-35): a failed read must never look like "no address, nothing chosen": the app would write its defaults over the person's choices.
  let account;
  try { account = await readAccount(env, install); } catch { return json(503, {ok: false, reason: 'not_read'}); }
  const rows = (stored = {}, facts = null) => json(200, {ok: true, rows: APP_ROWS.map(id => { const {name, when, suggested} = mailOf(id); return {id, name, when, suggested, choice: stored[id] || ''}; }),
    news: NEWS_SWITCHES.map(row => ({...row, on: !!facts && newsAnswer(row.id, facts)}))});
  if (!account?.email) return request.method === 'GET' ? rows() : json(200, {ok: false, reason: 'no_address'});   // Why (PR 4): the app shows the rows before any address reached the site; the first press saves the address, then the choice
  const addr = await addrOf(account.email);
  if (request.method === 'POST') {
    // Why (review of hr-31): the repo key (JPT1) an Always on repo holds may read, never write: a leaked copy must not turn a person's "off" back on. Only the app's own key (JPF1) writes.
    if (!String(request.headers.get('x-api-key') || '').startsWith('JPF1.')) return json(403, {ok: false, reason: 'app_only'});
    const body = await request.json().catch(() => ({}));
    if (![...APP_ROWS, ...NEWS].includes(body.mail) || typeof body.on !== 'boolean') return json(400, {ok: false, reason: 'bad_request'});
    try { await (NEWS.includes(body.mail) ? recordNews(env, account.id, {[body.mail]: body.on}, now) : setChoice(env, addr, body.mail, body.on, 'app', now)); } catch { return json(503, {ok: false, reason: 'not_saved'}); }   // the app keeps the switch where it was and says so
    return json(200, {ok: true});
  }
  let stored, facts;
  try { [stored, facts] = await Promise.all([choicesOf(env, addr), newsFacts(env, addr, account.email)]); } catch { return json(503, {ok: false, reason: 'not_read'}); }   // never answer "nothing chosen" when the read failed
  return rows(stored, facts);
}
