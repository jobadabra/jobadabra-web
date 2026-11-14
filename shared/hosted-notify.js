// Hosted Always on, the daily digest e-mail (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §4c): one mail per run, only when it found new matches, at most one every 4 hours,
// through the mail module's send() (limits, unsubscribe and footer are its job). A bounce or complaint turns the email channel off for the schedule. Guard: test/unit/shared/hosted/hosted-notify.test.js.
import {scoreOf} from './hosted.js';
import {addrOf, mailAllowed, send} from './mail.js';

export const DIGEST_GAP_MS = 4 * 60 * 60 * 1000, TOP = 5;

// -> {sent: true} or {sent: false, why}. Never throws: a mail problem must not fail the run's result post.
export async function digest(env, account, matches, now = new Date()) {
  try {
    if (!matches.length) return {sent: false, why: 'empty'};
    const row = await env.STATS.prepare('SELECT a.email, s.email_channel FROM hosted_schedules s JOIN pro_accounts a ON a.id = s.account WHERE s.account = ?').bind(account).first();
    if (!row?.email || !row.email_channel) return {sent: false, why: 'no_channel'};
    const addr = await addrOf(row.email);
    const last = await env.STATS.prepare("SELECT at FROM mail_log WHERE addr = ? AND template = 'digest' AND status = 'sent' ORDER BY at DESC LIMIT 1").bind(addr).first();
    if (last && now.getTime() - Date.parse(last.at) < DIGEST_GAP_MS) return {sent: false, why: 'gap'};
    const allowed = await mailAllowed(env, row.email, 'service');
    if (!allowed.ok) return stop(env, account, allowed.reason);
    // Why (#4375): best score first, a job not scored yet after every scored one, and its row with no score (no chip, shared/mail-frame.js jobRows)
    const top = [...matches].sort((a, b) => (scoreOf(b.fit) ?? -1) - (scoreOf(a.fit) ?? -1)).slice(0, TOP).map(({title, company, fit, url}) => ({title, company, fit: scoreOf(fit), url}));
    const done = await send(env, 'digest', row.email, {matches: top, total: matches.length}, {now});
    return done.ok ? {sent: true} : stop(env, account, done.reason);
  } catch (error) {
    console.error(`hosted digest: ${error.message}`);
    return {sent: false, why: 'failed'};
  }
}

// A bounce or complaint (suppressed) or an unsubscribe turns the email channel off for this schedule; other refusals (off, rate, failed) do not.
async function stop(env, account, why) {
  if (why === 'suppressed' || why === 'unsubscribed') await env.STATS.prepare('UPDATE hosted_schedules SET email_channel = 0 WHERE account = ?').bind(account).run();
  return {sent: false, why};
}
