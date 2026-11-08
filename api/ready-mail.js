// Ready to send, the morning mail (owner, 8 Nov 2026: "an e-mail for every automation"; plan jobadabra docs/superpowers/plans/2026-11-08-mw-automation-mails.md): when a night ends with forms to check, the person's
// own address gets ONE mail saying how many are ready and how many need an answer. Counts only, no job names: the forms and their titles stay sealed in the night's blob.
// It is the person's own mail (row `app-ready`, registry owner Yours): their switch holds it, and it goes through deliver() like every app mail (confirm link, unconfirmed limits, the caps).
// Invariants: once per night (the `mailed_at` claim is one UPDATE, so a night reported twice mails once; the claim is kept only when the mail went, was held for the digest, or the person's own switch said no, and is given back on any other refusal); never throws (a night's end must not fail on a mail); nothing is read or sent when no form is ready.
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
    if (sent.reason === 'unconfirmed') {   // as POST /api/notify/email: today's one mail to an unconfirmed address went, so this one waits for the digest, never dropped
      if (!await heldRefusal(env, account.email, READY_ROW, now)) await hold(env, account, {...item, row: READY_ROW}, now);
      return {skipped: 'held'};
    }
    if (!['person_off', 'rule_off'].includes(sent.reason)) await release(env, batch.id);   // a cap, a stopped address or a send error: not the person's no
    return {skipped: sent.reason};
  } catch (error) {
    console.error(`ready mail: ${error.message}`);
    await release(env, batch.id);
    return {skipped: 'failed'};
  }
}

// Gives the claim back (never throws): a night whose mail did not go may be mailed by a later end (a capped night's tick).
const release = async (env, id) => { try { await env.STATS.prepare('UPDATE ready_batches SET mailed_at = NULL WHERE id = ?').bind(id).run(); } catch { /* the claim stays: better no mail than a failed night */ } };
