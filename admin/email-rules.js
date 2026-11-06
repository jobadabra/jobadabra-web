// The Mails card of /admin/growth/email → Settings: every e-mail, grouped by who owns it (shared/mail-registry.js), with the owner's stop per mail
// (owner, 5 Nov 2026: "I can enable/disable every email", then "each users sets his own emails": for the person's own mail the stop is for a broken mail).
// Each row is a form like the Switches card: a role="switch" button posts to /admin/growth/email/rule (owner only, same origin). A stop is one press (it only sends less); turning one of
// Jobadabra's mails back on asks once on the page, as the switches do, because it lets news leave (spec #447: "same press route and confirm as the switches").
// Locked mails (sign-in code, confirm) show a lock instead of a switch. Guard: test/unit/admin/email-rules.test.js.
import {isOwner} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {OWNERS, mailOf, setRule} from '../shared/mail-registry.js';

const PAGE = '/admin/growth/email';

export const RULE_STYLE = `.rule-group{margin:14px 0 2px;font-size:13px;color:#9aa4b2}.rule-group b{color:#e6e9ee;font-size:14px;margin-right:6px}#mails .sw-row{grid-template-columns:46px 4.5em minmax(0,1fr)}.rule-lock{font-size:18px;text-align:center}`;   // one column width for a switch and a lock, so every name starts at the same edge

const day = iso => (iso || '').slice(0, 16).replace('T', ' ');
const note = (row, sent) => [row.when, row.held ? 'the stops could not be read, so it waits' : '', !row.locked && !row.on && row.at ? `stopped ${day(row.at)} UTC` : '',
  sent ? `${sent.sent || 0} sent in the window${sent.last ? `, last ${day(sent.last)}` : ''}` : 'none sent in the window'].filter(Boolean).join(' · ');

/** The card. `rows` = ruleRows(); `byTemplate` = the page's per-template counts for its day window ([{template, sent, last}]). */
export function rulesCard(rows, byTemplate = [], confirm = '') {
  const counts = new Map(byTemplate.map(row => [row.template, row]));
  const groups = OWNERS.map(owner => {
    const list = rows.filter(row => row.owner === owner.id).map(row => {
      const control = row.locked ? `<span class="rule-lock" role="img" aria-label="Locked: always sent">🔒</span><span class="sw-state on">Always</span>`
        : `<form method="post" action="${PAGE}/rule"><input type="hidden" name="id" value="${esc(row.id)}"><input type="hidden" name="state" value="${row.on ? 'off' : 'on'}"><button class="sw" type="submit" role="switch" aria-checked="${row.on}" aria-label="${esc(row.name)}"></button></form><span class="sw-state ${row.on ? 'on' : 'off'}">${row.on ? 'On' : 'Stopped'}</span>`;
      const ask = confirm === row.id && !row.on && !row.locked ? `<div class="sw-ask" role="alert"><form method="post" action="${PAGE}/rule"><input type="hidden" name="id" value="${esc(row.id)}"><input type="hidden" name="state" value="on"><input type="hidden" name="confirmed" value="1"><span>Turn <b>${esc(row.name)}</b> back on? It can then leave for everyone who ticked it.</span><button type="submit">Yes, turn it on</button><a href="${PAGE}?tab=settings#mails">Keep it stopped</a></form></div>` : '';
      return `<div class="sw-row">${control}<span class="sw-name">${esc(row.name)}<span class="sw-says">${esc(note(row, counts.get(row.id)))}</span></span>${ask}</div>`;
    }).join('');
    return `<p class="rule-group"><b>${esc(owner.name)}</b>${esc(owner.says)}</p><div class="sw-list">${list}</div>`;
  }).join('');
  return `<section class="card" id="mails" style="margin-bottom:16px"><h2>Mails</h2>${groups}<span class="muted">A stop holds that one mail for everyone, within seconds; "Why mail was not sent" counts it as rule_off.</span></section>`;
}

// POST /admin/growth/email/rule: id (a template), state ('on' | 'off'). -> a 303 back to the card.
export async function rulePress(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !(await isOwner(request, env)) || request.headers.get('Origin') !== url.origin) return new Response('Not found', {status: 404});
  const form = await request.formData().catch(() => new FormData());
  const id = String(form.get('id') || ''), state = String(form.get('state') || '');
  const mail = mailOf(id);
  if (!mail || mail.locked || !['on', 'off'].includes(state)) return new Response(mail?.locked ? 'This mail is locked: it always goes.' : 'Unknown mail.', {status: 400});
  const ask = state === 'on' && mail.owner === 'jobadabra' && form.get('confirmed') !== '1';
  if (ask) return new Response(null, {status: 303, headers: {Location: `${PAGE}?tab=settings&confirm=${encodeURIComponent(id)}#mails`, 'Cache-Control': 'no-store'}});
  try { await setRule(env, id, state === 'on'); } catch (error) { return new Response(`Not saved: ${error.message}. If the mail_rule table is missing, migration 0138 has not run.`, {status: 503, headers: {'Cache-Control': 'no-store'}}); }
  return new Response(null, {status: 303, headers: {Location: `${PAGE}?tab=settings#mails`, 'Cache-Control': 'no-store'}});
}
