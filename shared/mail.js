// Our e-mail sender (Cloudflare Email Sending, binding EMAIL): send(env, template, to, data) is the one way any code mails a person. It refuses (never throws) on a bad address,
// a bounce/complaint, a stop from the template's list, news its rules hold back (shared/mail-lists.js), or more than DAILY_MAX mails a day to one address; it adds the footer, the one-click
// unsubscribe link and headers, and logs the mail (hash of the address, never the body) in mail_log. Switch: env.MAIL = "on" (anything else sends nothing). Guard: test/unit/shared/mail/mail.test.js.
import {appVersionOf} from './app-needs.js';
import {digestOf, tokenFor} from './guard.js';
import {frameHtml, frameText, REPLY_TO, SITE} from './mail-frame.js';
import {NEWS, newsFacts, newsRefusal} from './mail-lists.js';
import {TEMPLATES} from './mail-templates.js';

// Per address, per rolling 24 h, every template together: a safety net so a bug of ours (a loop, a schedule firing too often) cannot flood one person into
// pressing "Report spam", which sends everyone's mail to spam. Why (owner, 5 Nov 2026, "10 a day"; was 6 since 16 Oct): the digest alone sends up to 6
// (once every 4 hours), so 6 refused the trial-ending, paused and Test mails on a digest day; 10 sits just above normal use.
export const DAILY_MAX = 10;
const GLOBAL_DAY_MAX = 3000;                // a safety net over every address; env.MAIL_DAY_MAX overrides
const DAY = 24 * 60 * 60 * 1000, CLAIM_MS = 2 * 60 * 1000;
const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const IGOR = 'Igor from Jobadabra <no-reply@jobadabra.top>';
const FROM = {service: 'Jobadabra <no-reply@jobadabra.top>', releases: IGOR, tips: IGOR};   // owner, 26 Oct 2026: "The sender email address should be no-reply@jobadabra.top"; 28 Oct 2026: product news come from "Igor from Jobadabra"

export const clean = to => String(to || '').trim().toLowerCase();
export const validAddress = to => ADDRESS.test(clean(to)) && clean(to).length <= 254;
export const addrOf = to => digestOf(clean(to));   // the key everywhere: pro_accounts.email_hash, mail_log.addr, mail_off.addr

// The one-click link for a list: it stops that type only. Signed, no sign-in.
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
export async function mailAllowed(env, to, list = 'service', {essential = false, test = false, waitlistToo = false} = {}) {
  if (!validAddress(to)) return {ok: false, reason: 'bad_address'};
  const news = NEWS.includes(list);
  if (news && env.MARKETING_MAIL !== 'on') return {ok: false, reason: 'marketing_off'};   // owner, 17 Oct 2026: no promotional mail until he turns it on
  const addr = await addrOf(to);
  const off = await env.STATS.prepare("SELECT list, reason FROM mail_off WHERE addr = ? AND list IN ('all', ?)").bind(addr, list).all();
  for (const row of off.results || []) if (row.list === 'all' || !essential) return {ok: false, reason: row.list === 'all' ? 'suppressed' : 'unsubscribed'};
  const account = await env.STATS.prepare('SELECT service_mail_off_at FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  if (news && !test) {   // a test send goes to the owner's typed address or the test inbox
    const reason = newsRefusal(list, await newsFacts(env, addr, clean(to)), {waitlistToo});
    if (reason) return {ok: false, reason};
  }
  if (list === 'service' && !essential && account?.service_mail_off_at) return {ok: false, reason: 'unsubscribed'};
  return {ok: true};
}

async function record(env, now, addr, list, template, status, id = null) {
  await env.STATS?.prepare('INSERT INTO mail_log (at, addr, list, template, status, message_id) VALUES (?, ?, ?, ?, ?, ?)').bind(now.toISOString(), addr, list, template, status, id).run().catch(() => {});
}

const WHY = {service: 'You set up Jobadabra with this address.', releases: 'You get new-release emails at this address.', tips: 'You ticked Tips and tricks or joined the Pro list.'};

// The subject, text, html and headers of a mail: the template's content inside the frame. `links` = {stop, settings} (none for an essential mail). Also what /admin/growth/email shows (admin/email-preview.js).
// `data.appVersion` (set by send(): the app version the address's installs last reported, or absent) lets a template swap an "Open in Jobadabra" button for "Update Jobadabra" (shared/app-needs.js).
export function compose(template, data = {}, links = null) {
  const spec = TEMPLATES[template];
  const why = spec.essential ? 'A security email, sent even if you stopped other emails.'
    : WHY[spec.list];
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
  let claimed = null;   // the marker of the mail_log row holding this call's room until the provider has answered
  try {
    const verdict = await mailAllowed(env, to, spec.list, {...spec, test});
    const addr = await addrOf(to);
    if (!verdict.ok) { if (verdict.reason !== 'bad_address' && verdict.reason !== 'marketing_off') await record(env, now, addr, spec.list, logged, verdict.reason); return verdict; }
    // Why (jobadabra-web#431; 20 of 20 parallel sends went out in the review of #430): the room under both caps is CLAIMED in one statement before the provider is asked (D1 runs a statement alone,
    // as in sendTestMail), so calls that arrive together cannot all read the same count. A live claim counts like a sent mail; one older than CLAIM_MS is a Worker that died and counts for nothing.
    const since = new Date(now.getTime() - DAY).toISOString(), fresh = new Date(now.getTime() - CLAIM_MS).toISOString();
    // Only send()'s own claims (marked `claim:`) are mail in flight: sendTestMail's day-claim has no marker and must not take a second slot (Gitar on #438).
    const live = "((status = 'sent' AND at >= ?) OR (status = 'claimed' AND message_id LIKE 'claim:%' AND at >= ?))";
    const marker = `claim:${crypto.randomUUID()}`;   // this call's claim row is found again by it (message_id until the provider answers): no driver's row id is needed
    const claim = await env.STATS.prepare(`INSERT INTO mail_log (at, addr, list, template, status, message_id) SELECT ?, ?, ?, ?, 'claimed', ? WHERE (SELECT COUNT(*) FROM mail_log WHERE addr = ? AND template NOT LIKE 'test:%' AND ${live}) < ? AND (SELECT COUNT(*) FROM mail_log WHERE ${live}) < ?`)
      .bind(now.toISOString(), addr, spec.list, logged, marker, addr, since, fresh, test ? Number.MAX_SAFE_INTEGER : DAILY_MAX, since, fresh, Number(env.MAIL_DAY_MAX || GLOBAL_DAY_MAX)).run();   // a test send takes no per-person room; the product-wide cap still counts it
    const changes = claim.meta?.changes ?? claim.changes;
    if (typeof changes !== 'number' && typeof changes !== 'bigint') throw new Error('claim: the database gave no changes count');   // never read an unknown shape as "the cap is full": that would stop every mail without a word
    if (Number(changes) !== 1) { await record(env, now, addr, spec.list, logged, 'rate'); return {ok: false, reason: 'rate'}; }
    claimed = marker;
    const appVersion = await appVersionOf(env, addr);
    const stop = spec.essential ? null : await stopLink(env, to, spec.list);
    const {subject, text, html, headers} = compose(template, {...data, appVersion}, stop && {stop, settings: await settingsLink(env, to)});
    const result = await env.EMAIL.send({from: FROM[spec.list], replyTo: REPLY_TO, to: clean(to), subject, text, html, ...(headers && {headers})});
    const id = result?.messageId || null, mine = claimed;
    claimed = null;   // the mail is gone: whatever happens next, its room is not given back
    // The mail has gone: it must end up counted whatever the settling does (the UPDATE fails, or the claim row was removed meanwhile and it matches nothing).
    try {
      const settled = await env.STATS.prepare("UPDATE mail_log SET status = 'sent', message_id = ? WHERE message_id = ? AND status = 'claimed'").bind(id, mine).run();
      if (Number(settled.meta?.changes ?? settled.changes) === 0) await record(env, now, addr, spec.list, logged, 'sent', id);
    } catch { await record(env, now, addr, spec.list, logged, 'sent', id); }
    return {ok: true, id};
  } catch (error) {
    console.error(`mail ${template}: ${error.message}`);
    // A mail the provider (or anything before it) failed gives its room back: a failure must not eat the person's cap, and 'failed' rows are never counted.
    if (claimed != null) await env.STATS?.prepare("DELETE FROM mail_log WHERE message_id = ? AND status = 'claimed'").bind(claimed).run().catch(() => {});
    await record(env, now, await addrOf(to).catch(() => ''), spec.list, logged, 'failed');
    return {ok: false, reason: 'failed'};
  }
}

/**
 * The alert test mail, at most once a rolling day per address, whatever comes in parallel: {ok: true, at, earlier?} or a refusal; never throws.
 * Every Test that proves "your alerts reach you" goes here (through api/mail-held.js testAlert), so five presses or a stolen repo key get one mail, never five.
 * The list rules run first: an address that bounced or stopped our mail since the last test is told, not "ok". `mail` sends it; the default is the test template.
 * Why (review of hr-23, 5 Nov 2026): a read then a send let 20 parallel calls send 20 mails. One INSERT ... WHERE NOT EXISTS claims the day (D1 runs a statement alone);
 * send() logs 'sent' before the claim goes, so a later call always sees one of the two.
 */
export async function sendTestMail(env, to, now = new Date(), mail = () => send(env, 'always-on-test', to, {}, {now, test: true})) {
  if (env.MAIL !== 'on' || !env.EMAIL || !env.STATS) return {ok: false, reason: 'off'};
  try {
    const spec = TEMPLATES['always-on-test'];
    const allowed = await mailAllowed(env, to, spec.list, spec);
    if (!allowed.ok) return allowed;
    const addr = await addrOf(to), since = new Date(now.getTime() - DAY).toISOString();
    const fresh = new Date(now.getTime() - CLAIM_MS).toISOString();   // Why (Gitar on #430): a Worker that dies leaves its claim; past this it is no call at work and no mail sent
    const claim = await env.STATS.prepare("INSERT INTO mail_log (at, addr, list, template, status) SELECT ?, ?, ?, 'test:always-on-test', 'claimed' WHERE NOT EXISTS (SELECT 1 FROM mail_log WHERE addr = ? AND template = 'test:always-on-test' AND ((status = 'sent' AND at >= ?) OR (status = 'claimed' AND at >= ?)))")
      .bind(now.toISOString(), addr, spec.list, addr, since, fresh).run();
    if ((claim.meta?.changes ?? claim.changes) !== 1) {
      const today = await env.STATS.prepare("SELECT at FROM mail_log WHERE addr = ? AND template = 'test:always-on-test' AND ((status = 'sent' AND at >= ?) OR (status = 'claimed' AND at >= ?)) ORDER BY at LIMIT 1").bind(addr, since, fresh).first();
      return {ok: true, at: today?.at || now.toISOString(), earlier: true};
    }
    try {
      const sent = await mail();
      return sent.ok ? {...sent, at: now.toISOString()} : sent;
    } finally {
      await env.STATS.prepare("DELETE FROM mail_log WHERE addr = ? AND template = 'test:always-on-test' AND status = 'claimed'").bind(addr).run();
    }
  } catch (error) {
    console.error(`mail test: ${error.message}`);
    return {ok: false, reason: 'failed'};
  }
}

// Daily: the mail log keeps 90 days (the per-address limit only reads the last day).
export async function purge(env, now = new Date()) {
  await env.STATS?.prepare('DELETE FROM mail_log WHERE at < ?').bind(new Date(now.getTime() - 90 * DAY).toISOString()).run();
}
