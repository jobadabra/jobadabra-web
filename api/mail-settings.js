// The e-mail settings page a mail's footer links to (owner, 17 Oct 2026): service mail on/off, the digest daily or weekly, What's new and News and tips on/off. No sign-in: the signed link is the one the stop link uses
// (tokenFor(address digest, 'unsub-service')). GET shows the form (a mail scanner opening the link changes nothing); POST saves. Both news boxes show off and locked while env.MARKETING_MAIL is not "on". Guard: test/unit/api/mail-settings.test.js.
import {equal, tokenFor} from '../shared/guard.js';
import {esc} from '../shared/mail-frame.js';
import {NEWS, NEWS_SWITCHES, newsAnswer, newsFacts, sayYes} from '../shared/mail-lists.js';
import {CADENCES} from './mail-held.js';
import {page, switchOff} from './mail-unsub.js';

const OFF = 'Off. We are not sending any of these right now.';
const bad = () => page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
const row = (name, checked, label, note, disabled = false) => `<p><label><input type="checkbox" name="${name}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}> <b>${label}</b></label><br><small>${note}</small></p>`;

async function stateOf(env, addr) {
  const off = (await env.STATS.prepare("SELECT list FROM mail_off WHERE addr = ? AND list IN ('all', 'service')").bind(addr).all()).results || [];
  const account = await env.STATS.prepare('SELECT email, plan, email_confirmed_at, service_mail_off_at, digest_cadence FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  const lists = new Set(off.map(r => r.list));
  // Why (5 Nov 2026): an address with no account has no confirm step to wait for (the waitlist); an account's address counts once it is confirmed, like the sender reads it (shared/mail-lists.js).
  const held = await newsFacts(env, addr, account?.email || null);
  // Why (review of hr-36): the link holds only a digest, so a waitlist entry cannot be looked up here. An address with no account got its link as a waitlist signup: show What's new on, or the person could not stop it on this page.
  const facts = {...held, confirmed: !account || !!account.email_confirmed_at || account.plan === 'pro', signup: account ? held.signup : 'news'};
  return {blocked: lists.has('all'), service: !lists.has('service') && !account?.service_mail_off_at, cadence: account?.digest_cadence || 'daily', news: Object.fromEntries(NEWS.map(list => [list, newsAnswer(list, facts)])), account};
}

export async function settings(request, env, now = new Date()) {
  if (!env.STATS) return page('Not available', '', 503);
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !equal(token, await tokenFor(addr, env, 'unsub-service'))) return bad();
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => new FormData());
    const before = await stateOf(env, addr);
    if (!before.blocked) {
      if (form.get('service')) {
        await env.STATS.prepare("DELETE FROM mail_off WHERE addr = ? AND list = 'service'").bind(addr).run();
        await env.STATS.prepare('UPDATE pro_accounts SET service_mail_off_at = NULL WHERE email_hash = ?').bind(addr).run();
      } else await switchOff(env, addr, 'service', 'settings', now);
    }
    if (CADENCES.includes(form.get('cadence'))) await env.STATS.prepare('UPDATE pro_accounts SET digest_cadence = ? WHERE email_hash = ?').bind(form.get('cadence'), addr).run();
    if (env.MARKETING_MAIL === 'on' && !before.blocked) {   // news can be changed only while the owner has it on
      for (const list of NEWS) {   // only a changed box is an answer: a default left alone stays a default
        if (form.get(list) && !before.news[list]) await sayYes(env, addr, list, 'mail-settings', now);
        else if (!form.get(list) && before.news[list]) await switchOff(env, addr, list, 'settings', now);
      }
    }
    return page('Saved', `<p>Your email settings are saved.</p><p><a href="${esc(url.pathname + url.search)}">Back to the settings</a></p>`);
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  const st = await stateOf(env, addr), marketingOn = env.MARKETING_MAIL === 'on';
  const body = `${st.blocked ? '<p><b>Mail to this address is stopped</b> after a bounce or a complaint. Write to hello@jobadabra.top to turn it back on.</p>' : ''}`
    + `<form method="post" class="fields">${row('service', st.service, 'Jobadabra emails', 'New matches, your digest and account notices.', st.blocked)}`
    + `<p><label><b>Digest</b><br><select name="cadence"${st.blocked ? ' disabled' : ''}>${CADENCES.map(c => `<option value="${c}"${st.cadence === c ? ' selected' : ''}>${c === 'daily' ? 'One email a day' : 'One email a week (Mondays)'}</option>`).join('')}</select></label><br><small>Everything except new matches, which arrive at once.</small></p>`
    + NEWS_SWITCHES.map(({id, name, when}) => row(id, marketingOn && st.news[id], name, marketingOn ? `${when}.` : OFF, !marketingOn || st.blocked)).join('')
    + `<button${st.blocked ? ' disabled' : ''}>Save</button></form>`;
  return page('Email settings', body);
}
