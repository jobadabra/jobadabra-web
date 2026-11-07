// The e-mail digest of everything that is not a new-matches mail (owner, 17 Oct 2026): mail-check results, insights, finished jobs wait here, and the daily cron sends each account
// ONE mail (weekly on Mondays for an account that chose weekly). New matches and interview notices never wait: api/account-email.js sends them at once. Guard: test/unit/api/account-email.test.js.
import {addrOf, confirmLink, heldRefusal, send, sendTestMail} from '../shared/mail.js';
import {mailText} from '../shared/mail-copy.js';
import {notificationLocale} from '../shared/notification-language.js';
import {recipientNotificationLanguage} from '../shared/notification-preference.js';
import {choiceRefusal} from '../shared/mail-choices.js';
import {TEMPLATES} from '../shared/mail-templates.js';
import {ruleRefusal} from '../shared/mail-registry.js';

const HOLD_MAX = 100;            // per account: a stuck mailbox cannot grow the table
const KEEP_DAYS = 14;
const UNCONFIRMED_PER_DAY = 1;   // an unconfirmed address gets one mail a UTC day, each with the confirm link; the rest waits for the digest (owner, 26 Oct 2026: "Soften it", was 2 mails ever)
const UNCONFIRMED_DAYS = 14;     // after the first mail, an address still unconfirmed gets no more (owner, 26 Oct 2026: "Stop after 14 days"); confirming lifts it (api/account-email.js)
export const CADENCES = ['daily', 'weekly'];

// One mail to the account's address, with the confirm link while the address is unconfirmed. `row`: which app mail it is (shared/mail-registry.js APP_ROWS). -> {ok} or {ok: false, reason}.
export async function deliver(env, account, {subject, html, text, buttons = []}, now = new Date(), {row = '', locale} = {}) {
  let confirmUrl = null;
  if (!account.email_confirmed_at) {
    const addr = await addrOf(account.email);
    const first = await env.STATS.prepare("SELECT MIN(at) AS at FROM mail_log WHERE addr = ? AND template IN ('welcome', 'message') AND status = 'sent'").bind(addr).first();
    if (first?.at && now.getTime() - new Date(first.at).getTime() > UNCONFIRMED_DAYS * 86400000) {   // kept in mail_off: mail_log forgets after 90 days, this does not
      await env.STATS.prepare("INSERT OR IGNORE INTO mail_off (addr, list, reason, at) VALUES (?, 'service', 'unconfirmed', ?)").bind(addr, now.toISOString()).run();
      return {ok: false, reason: 'unconfirmed_stopped'};
    }
    const day = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;   // a calendar day, so the morning digest is never blocked by yesterday evening's mail
    const {n} = await env.STATS.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE addr = ? AND template = 'message' AND status = 'sent' AND at >= ?").bind(addr, day).first();
    if (n >= UNCONFIRMED_PER_DAY) return {ok: false, reason: 'unconfirmed'};
    confirmUrl = await confirmLink(env, account.email);
  }
  return send(env, 'message', account.email, {subject: String(subject || '').slice(0, 150), html, text, buttons, confirmUrl}, {now, row, locale});
}

/**
 * The Test's alert mail for `account` ({email, email_confirmed_at}): {ok: true, at, earlier?} or a refusal. Once a day (shared/mail.js sendTestMail).
 * Why (review of hr-23, 5 Nov 2026): an address nobody confirmed may be a stranger's, so it gets the test through deliver(): the confirm link, one mail a day, the 14-day stop.
 */
export async function testAlert(env, account, now = new Date(), {locale} = {}) {
  const ruled = await ruleRefusal(env, 'always-on-test');   // Why (review of hr-29): an unconfirmed address gets the test as a 'message' mail below, so the owner's stop on the test is asked here, for both paths
  if (ruled) return {ok: false, reason: ruled};
  if (account.email_confirmed_at) return sendTestMail(env, account.email, now, () => send(env, 'always-on-test', account.email, {}, {now, test: true, locale}));
  const spec = TEMPLATES['always-on-test'];
  const data = {locale: locale === undefined ? await recipientNotificationLanguage(env, await addrOf(account.email)) : notificationLocale(locale)};
  const sent = await sendTestMail(env, account.email, now, () => deliver(env, account, {subject: spec.subject(data), html: spec.html(data), text: spec.text(data)}, now, {locale: data.locale}));
  return sent.reason === 'unconfirmed' ? {ok: true, at: now.toISOString(), earlier: true} : sent;   // today's one mail with the confirm link already went
}

export async function hold(env, account, item, now = new Date()) {
  const {n} = await env.STATS.prepare('SELECT COUNT(*) AS n FROM mail_held WHERE account = ?').bind(account.id).first();
  if (n >= HOLD_MAX) return {ok: false, reason: 'full'};
  // Why (spec PR 5): `mail_row` is written only when the mail names its row, so a deploy whose migration did not apply (site.yml only warns) never loses a mail from today's app.
  const column = item.row ? ', mail_row' : '', slot = item.row ? ', ?' : '', values = [account.id, now.toISOString(), item.subject, item.html, item.text, JSON.stringify(item.buttons || []), ...(item.row ? [item.row] : [])];
  await env.STATS.prepare(`INSERT INTO mail_held (account, at, subject, html, text, buttons${column}) VALUES (?, ?, ?, ?, ?, ?${slot})`).bind(...values).run();
  return {ok: true, held: true};
}

// Each app mail among `rows` -> the person's verdict on it now ('' = still wanted): they may have turned it off after it was held (owner, 6 Nov 2026: "Keep promise, cut extras", in place of a digest kept on the Mac).
async function verdicts(env, account, rows, now) {
  const found = new Map(), addr = await addrOf(account.email);
  for (const id of new Set(rows.map(row => row.mail_row).filter(Boolean))) {
    const reason = await choiceRefusal(env, addr, id);
    if (reason === 'person_off') await heldRefusal(env, account.email, id, now);   // Why (Gitar on #463): only a dropped mail is logged; a digest that waits for a failed read was refused nothing
    found.set(id, reason);
  }
  return found;
}

/** The digest of `rows`, oldest first. A mail held twice with the same words is printed once, and counts once. */
function digestOf(rows, locale = 'en') {
  // Why (6 Nov 2026, the owner's inbox): the Focus reminders of 11:00, 15:00 and 19:00 said the same, and the mail printed the block three times under "3 items". Here, not in hold(): installed apps keep sending them.
  const once = [...new Map(rows.map(row => [JSON.stringify([row.subject, row.text]), row])).values()];
  const subject = once.length === 1 ? once[0].subject : mailText(locale, 'heldDigestSubject', {count: once.length});
  const buttons = once.flatMap(row => JSON.parse(row.buttons || '[]')).slice(0, 6);
  return {subject, html: once.map(row => row.html).join('<hr>'), text: once.map(row => row.text).join('\n\n---\n\n'), buttons};
}

// -> {sent, kept}: accounts mailed and accounts whose digest waits (weekly day not reached, or the sender refused).
export async function sendDigests(env, now = new Date()) {
  const done = {sent: 0, kept: 0};
  if (!env.STATS) return done;
  await env.STATS.prepare('DELETE FROM mail_held WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString()).run();
  const accounts = (await env.STATS.prepare("SELECT a.id, a.email, a.email_confirmed_at, a.digest_cadence FROM pro_accounts a WHERE EXISTS (SELECT 1 FROM mail_held h WHERE h.account = a.id) LIMIT 500").all()).results || [];
  for (const account of accounts) {
    if (account.digest_cadence === 'weekly' && now.getUTCDay() !== 1) { done.kept++; continue; }
    const held = (await env.STATS.prepare('SELECT * FROM mail_held WHERE account = ? ORDER BY id LIMIT 30').bind(account.id).all()).results || [];
    const refused = await verdicts(env, account, held, now);
    if ([...refused.values()].includes('choice_held')) { done.kept++; continue; }   // a failed read never sends more than the person chose: the digest waits for the next run
    for (const [id, reason] of refused) if (reason) await env.STATS.prepare('DELETE FROM mail_held WHERE account = ? AND mail_row = ?').bind(account.id, id).run();
    const rows = held.filter(row => !refused.get(row.mail_row));
    if (!rows.length) continue;
    const locale = await recipientNotificationLanguage(env, await addrOf(account.email));
    const result = await deliver(env, account, digestOf(rows, locale), now, {locale});
    if (result.ok || ['unsubscribed', 'suppressed', 'unconfirmed_stopped'].includes(result.reason)) {   // sent, or the person does not want it: either way it is not held again
      await env.STATS.prepare(`DELETE FROM mail_held WHERE account = ? AND id <= ?`).bind(account.id, rows[rows.length - 1].id).run();
      if (result.ok) done.sent++;
    } else done.kept++;
  }
  return done;
}
