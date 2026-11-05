// Our e-mail sender (Cloudflare Email Sending, binding EMAIL): send(env, template, to, data) is the one way any code mails a person. It refuses (never throws) on a bad address,
// a bounce/complaint, an unsubscribe from the template's list, marketing without an opt-in, or more than DAILY_MAX mails a day to one address; it adds the footer, the one-click
// unsubscribe link and headers, and logs the mail (hash of the address, never the body) in mail_log. Switch: env.MAIL = "on" (anything else sends nothing). Guard: test/unit/shared/mail/mail.test.js.
import {appVersionOf} from './app-needs.js';
import {digestOf, tokenFor} from './guard.js';
import {frameHtml, frameText, REPLY_TO, SITE} from './mail-frame.js';
import {TEMPLATES} from './mail-templates.js';

// Per address, per rolling 24 h, every template together: a safety net so a bug of ours (a loop, a schedule firing too often) cannot flood one person into
// pressing "Report spam", which sends everyone's mail to spam. Why (owner, 5 Nov 2026, "10 a day"; was 6 since 16 Oct): the digest alone sends up to 6
// (once every 4 hours), so 6 refused the trial-ending, paused and Test mails on a digest day; 10 sits just above normal use.
export const DAILY_MAX = 10;
const GLOBAL_DAY_MAX = 3000;                // a safety net over every address; env.MAIL_DAY_MAX overrides
const DAY = 24 * 60 * 60 * 1000;
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const FROM = {service: 'Jobadabra <no-reply@jobadabra.top>', marketing: 'Igor from Jobadabra <no-reply@jobadabra.top>'};   // owner, 26 Oct 2026: "The sender email address should be no-reply@jobadabra.top"; 28 Oct 2026: product news come from "Igor from Jobadabra"

export const clean = to => String(to || '').trim().toLowerCase();
export const validAddress = to => ADDRESS.test(clean(to)) && clean(to).length <= 254;
export const addrOf = to => digestOf(clean(to));   // the key everywhere: pro_accounts.email_hash, mail_log.addr, mail_off.addr

// The one-click link for a list ('service' = stop the daily searches' mail, 'marketing' = stop news). Signed, no sign-in.
// The signed link that confirms an address (the first mail carries it, api/account-email.js).
export async function confirmLink(env, to) {
  const addr = await addrOf(to);
  return `${SITE}/confirm?a=${addr}&t=${await tokenFor(addr, env, 'confirm')}`;
}

export async function stopLink(env, to, list) {
  const addr = await addrOf(to);
  return `${SITE}/unsubscribe?a=${addr}&l=${list}&t=${await tokenFor(addr, env, `unsub-${list}`)}`;
}

// The signed link to the e-mail settings page (api/mail-settings.js): the same token as the service stop link, no sign-in.
export async function settingsLink(env, to) {
  const addr = await addrOf(to);
  return `${SITE}/email-settings?a=${addr}&t=${await tokenFor(addr, env, 'unsub-service')}`;
}

// -> {ok: true} or {ok: false, reason}. For a caller that builds an expensive mail (the digest) and wants to know first.
export async function mailAllowed(env, to, list = 'service', {essential = false} = {}) {
  if (!validAddress(to)) return {ok: false, reason: 'bad_address'};
  if (list === 'marketing' && env.MARKETING_MAIL !== 'on') return {ok: false, reason: 'marketing_off'};   // owner, 17 Oct 2026: no promotional mail until he turns it on
  const addr = await addrOf(to);
  const off = await env.STATS.prepare("SELECT list, reason FROM mail_off WHERE addr = ? AND list IN ('all', ?)").bind(addr, list).all();
  for (const row of off.results || []) if (row.list === 'all' || !essential) return {ok: false, reason: row.list === 'all' ? 'suppressed' : 'unsubscribed'};
  const account = await env.STATS.prepare('SELECT marketing_opt_in, service_mail_off_at FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  // Why (28 Oct 2026, owner): news go to every address that has not turned them off (mail_off above): a waitlist signup or an address given in the wizard agrees to product news. No opt-in column is read.
  if (list === 'service' && !essential && account?.service_mail_off_at) return {ok: false, reason: 'unsubscribed'};
  return {ok: true};
}

async function record(env, now, addr, list, template, status, id = null) {
  await env.STATS?.prepare('INSERT INTO mail_log (at, addr, list, template, status, message_id) VALUES (?, ?, ?, ?, ?, ?)').bind(now.toISOString(), addr, list, template, status, id).run().catch(() => {});
}

// The subject, text, html and headers of a mail: the template's content inside the frame. `links` = {stop, settings} (none for an essential mail). Also what /admin/growth/email shows (admin/email-preview.js).
// `data.appVersion` (set by send(): the app version the address's installs last reported, or absent) lets a template swap an "Open in Jobadabra" button for "Update Jobadabra" (shared/app-needs.js).
export function compose(template, data = {}, links = null) {
  const spec = TEMPLATES[template];
  const why = spec.essential ? 'A security email, sent even if you stopped other emails.'
    : spec.list === 'marketing' ? 'You joined the waitlist or set up Jobadabra.' : 'You set up Jobadabra with this address.';
  const frame = {title: spec.title(data), why, button: spec.button?.(data) || null, links};
  const headers = links ? {'List-Unsubscribe': `<${links.stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'} : undefined;
  return {subject: spec.subject(data), text: frameText({...frame, body: spec.text(data)}), html: frameHtml({...frame, body: spec.html(data), hero: spec.hero?.(data)}), headers};
}

/**
 * Mails `template` to `to` through every rule above; never throws. {ok, id} or {ok: false, reason}.
 * `test`: a test send (a Test press, the admin page's test buttons). Why (owner, 5 Nov 2026: "test emmail are aside of this cap"): it is logged as `test:<template>`,
 * never refused by DAILY_MAX and never takes its room; GLOBAL_DAY_MAX still counts it. A mark in the template name, not a new column: a failed migration only warns
 * (site.yml), and a missing column would stop every mail.
 */
export async function send(env, template, to, data = {}, {now = new Date(), test = false} = {}) {
  const spec = TEMPLATES[template];
  const logged = test ? `test:${template}` : template;
  if (!spec) return {ok: false, reason: 'bad_template'};
  if (env.MAIL !== 'on' || !env.EMAIL || !env.STATS) return {ok: false, reason: 'off'};
  try {
    const verdict = await mailAllowed(env, to, spec.list, spec);
    const addr = await addrOf(to);
    if (!verdict.ok) { if (verdict.reason !== 'bad_address' && verdict.reason !== 'marketing_off') await record(env, now, addr, spec.list, logged, verdict.reason); return verdict; }
    const since = new Date(now.getTime() - DAY).toISOString();
    const mine = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND status = 'sent' AND at >= ? AND template NOT LIKE 'test:%'").bind(addr, since).first();
    const all = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE status = 'sent' AND at >= ?").bind(since).first();
    if ((!test && mine.n >= DAILY_MAX) || all.n >= Number(env.MAIL_DAY_MAX || GLOBAL_DAY_MAX)) { await record(env, now, addr, spec.list, logged, 'rate'); return {ok: false, reason: 'rate'}; }
    const appVersion = await appVersionOf(env, addr);
    const stop = spec.essential ? null : await stopLink(env, to, spec.list);
    const {subject, text, html, headers} = compose(template, {...data, appVersion}, stop && {stop, settings: await settingsLink(env, to)});
    const result = await env.EMAIL.send({from: FROM[spec.list], replyTo: REPLY_TO, to: clean(to), subject, text, html, ...(headers && {headers})});
    await record(env, now, addr, spec.list, logged, 'sent', result?.messageId || null);
    return {ok: true, id: result?.messageId || null};
  } catch (error) {
    console.error(`mail ${template}: ${error.message}`);
    await record(env, now, await addrOf(to).catch(() => ''), spec.list, logged, 'failed');
    return {ok: false, reason: 'failed'};
  }
}

/**
 * The alert test mail ('always-on-test') to `to`, at most once a rolling day per address: {ok: true, at, earlier?} or send()'s refusal.
 * Every Test that proves "your alerts reach you" uses it (our servers: api/hosted-test.js; the person's GitHub: POST /api/notify/email kind 'test'),
 * so five presses send one mail, never five.
 */
export async function sendTestMail(env, to, now = new Date()) {
  const today = env.STATS && validAddress(to) ? await env.STATS.prepare("SELECT at FROM mail_log WHERE addr = ? AND template = 'test:always-on-test' AND status = 'sent' AND at >= ? LIMIT 1")
    .bind(await addrOf(to), new Date(now.getTime() - DAY).toISOString()).first() : null;
  if (today) return {ok: true, at: today.at, earlier: true};
  const sent = await send(env, 'always-on-test', to, {}, {now, test: true});
  return sent.ok ? {...sent, at: now.toISOString()} : sent;
}

// Daily: the mail log keeps 90 days (the per-address limit only reads the last day).
export async function purge(env, now = new Date()) {
  await env.STATS?.prepare('DELETE FROM mail_log WHERE at < ?').bind(new Date(now.getTime() - 90 * DAY).toISOString()).run();
}
