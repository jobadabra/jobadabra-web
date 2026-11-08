// Ready to send, the morning mail (owner, 8 Nov 2026: "an e-mail for every automation"; plan jobadabra docs/superpowers/plans/2026-11-08-mw-automation-mails.md): when a night ends with forms to check, the person's
// own address gets ONE mail saying how many are ready and how many need an answer. Counts only, no job names: the forms and their titles stay sealed in the night's blob.
// It is the person's own mail (row `app-ready`, registry owner Yours): their switch holds it, and it goes through deliver() like every app mail (confirm link, unconfirmed limits, the caps).
// Invariants: once per night (the `mailed_at` claim is one UPDATE, so a night reported twice mails once; the claim is never given back: a mail that did not go (a cap, a stopped or unconfirmed address, a send error) is held for the digest instead, and only the person's own no drops it); never throws (a night's end must not fail on a mail); nothing is read or sent when no form is ready.
// Guard: test/unit/api/ready/ready-mail.test.js.
import {addrOf, heldRefusal} from '../shared/mail.js';
import {mailText} from '../shared/mail-copy.js';
import {recipientNotificationLanguage} from '../shared/notification-preference.js';
import {accountOf} from '../shared/pro.js';
import {SITE} from '../shared/mail-frame.js';
import {deliver, hold} from './mail-held.js';

export const READY_ROW = 'app-ready';

/**
 * The night `batch` ({id, install}) has ended: mails its person once. -> {sent: true} or {skipped: why} ('already', 'nothing', 'no_address') or {skipped: reason} when the mail was refused (a switch off, a cap).
 * `complete`: forms filled with nothing required left ('prepared'); `needs`: filled but something is left for the person ('partial'). A form the person cleared, or one that hit a wall, is not counted.
 */
export async function mailNight(env, batch, now = new Date()) {
  try {
    const counts = await env.STATS.prepare("SELECT SUM(state = 'prepared') AS complete, SUM(state = 'partial') AS needs FROM ready_jobs WHERE batch = ? AND cleared_at IS NULL").bind(batch.id).first();
    const complete = Number(counts?.complete || 0), needs = Number(counts?.needs || 0);
    if (!complete && !needs) return {skipped: 'nothing'};
    const claim = await env.STATS.prepare('UPDATE ready_batches SET mailed_at = ? WHERE id = ? AND mailed_at IS NULL').bind(now.toISOString(), batch.id).run();
    if (!(claim.meta?.changes ?? claim.changes)) return {skipped: 'already'};
    const account = await accountOf(env, batch.install);
    if (!account?.email) return {skipped: 'no_address'};
    const locale = await recipientNotificationLanguage(env, await addrOf(account.email));
    const count = complete + needs;
    const text = [mailText(locale, 'readyIntro'), needs ? mailText(locale, 'readyNeeds', {count: needs}) : ''].filter(Boolean).join('\n\n');
    const html = [mailText(locale, 'readyIntro'), needs ? mailText(locale, 'readyNeeds', {count: needs}) : ''].filter(Boolean).map(line => `<p>${line}</p>`).join('');
    // Why (review of 2/5): /open reaches only 'jobs' and 'sessions'; the forms the night filled are marked in the Jobs list.
    const item = {subject: mailText(locale, 'readySubject', {count}), html, text, buttons: [{text: mailText(locale, 'readyButton'), url: `${SITE}/open?view=jobs`}]};
    const sent = await deliver(env, account, item, now, {row: READY_ROW, locale});
    if (sent.ok) return {sent: true};
    if (['person_off', 'rule_off'].includes(sent.reason)) return {skipped: sent.reason};   // the person's no, or the owner's stop: nothing is held
    // Why (Gitar on #496): nothing retries a night after it ended, so a refusal must not lose the mail: it waits for the digest, as POST /api/notify/email does for an unconfirmed address.
    return {skipped: await toDigest(env, account, item, now) ? 'held' : sent.reason};
  } catch (error) {
    console.error(`ready mail: ${error.message}`);
    return {skipped: 'failed'};
  }
}

// Holds the mail for the digest unless the person's choice for the row says no; true when it was held. Never throws.
async function toDigest(env, account, item, now) {
  try {
    if (await heldRefusal(env, account.email, READY_ROW, now)) return false;
    await hold(env, account, {...item, row: READY_ROW}, now);
    return true;
  } catch { return false; }
}
