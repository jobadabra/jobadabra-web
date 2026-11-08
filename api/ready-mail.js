// Ready to send, the morning mail (owner, 8 Nov 2026: "an e-mail for every automation"; plan jobadabra docs/superpowers/plans/2026-11-08-mw-automation-mails.md): when a night ends with forms to check, the person's
// own address gets ONE mail saying how many are ready and how many need an answer. Counts only, no job names: the forms and their titles stay sealed in the night's blob.
// It is the person's own mail (row `app-ready`, registry owner Yours): their switch holds it, and it goes through deliver() like every app mail (confirm link, unconfirmed limits, the caps).
// Invariants: once per night (the `mailed_at` claim is one UPDATE, so a night reported twice mails once); never throws (a night's end must not fail on a mail); nothing is read or sent when no form is ready.
// Guard: test/unit/api/ready/ready-mail.test.js.
import {addrOf} from '../shared/mail.js';
import {mailText} from '../shared/mail-copy.js';
import {recipientNotificationLanguage} from '../shared/notification-preference.js';
import {accountOf} from '../shared/pro.js';
import {SITE} from '../shared/mail-frame.js';
import {deliver} from './mail-held.js';

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
    const sent = await deliver(env, account, {subject: mailText(locale, 'readySubject', {count}), html, text, buttons: [{text: mailText(locale, 'readyButton'), url: `${SITE}/open?view=actions`}]}, now, {row: READY_ROW, locale});
    return sent.ok ? {sent: true} : {skipped: sent.reason};
  } catch (error) {
    console.error(`ready mail: ${error.message}`);
    return {skipped: 'failed'};
  }
}
