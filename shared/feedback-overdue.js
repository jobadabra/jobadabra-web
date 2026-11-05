// The owner's ping when a report is 24 hours old and nobody has answered it (docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md in jobadabra, PR 1/7; the promise is "within 24 hours").
// Run by the Worker's hourly tick. Once per report: the row's own overdue_told_at is the flag (it survives a KV eviction), claimed before the send. The text carries no name, e-mail or words of the reporter.
// Guarded by test/unit/shared/feedback/feedback-receipt.test.js.
import {CLOCK_DAYS, REPLY_HOURS, UNANSWERED} from './feedback-reply.js';
import {alertOwner} from './notify-send.js';

const MAX_ROWS = 50, SUMMARY_FROM = 4;   // past three overdue at once (an outage), one line: nt's rule for a burst

/** The reports 24 h old or older, within 7 days, with no reply (the clock rule of shared/feedback-reply.js as SQL) and not pinged yet, oldest first. */
async function overdueRows(env, now) {
  const late = new Date(now.getTime() - REPLY_HOURS * 3600000).toISOString(), from = new Date(now.getTime() - CLOCK_DAYS * 86400000).toISOString();
  return (await env.STATS.prepare(`SELECT ref, version FROM feedback WHERE ref != '' AND overdue_told_at = '' AND at < ? AND at >= ? AND ${UNANSWERED} ORDER BY at LIMIT ?`)
    .bind(late, from, MAX_ROWS).all()).results || [];
}

/** Claims one report (compare-and-set on the empty flag); false when another tick took it first. */
async function claim(env, ref, now) {
  const done = await env.STATS.prepare("UPDATE feedback SET overdue_told_at = ? WHERE ref = ? AND overdue_told_at = ''").bind(now.toISOString(), ref).run();
  return (done?.meta?.changes ?? done?.changes ?? 0) > 0;
}

/** Gives the flag back after a real failure so the next tick tries again; a hold by the switchboard (the owner switched the alert off) and "nothing configured" are final (Gitar on #429, free-ai.js tellSpend). */
async function release(env, refs, told) {
  const unconfigured = told?.via === 'none' && ['no-bot', 'channel-not-connected', 'no-store'].includes(told.why);
  if (unconfigured || (told && (told.sent || told.via === 'switchboard'))) return;
  for (const ref of refs) await env.STATS.prepare("UPDATE feedback SET overdue_told_at = '' WHERE ref = ?").bind(ref).run().catch(() => {});
}

/**
 * One tick: pings the owner once for each report that went overdue since the last one. -> how many reports were claimed.
 * Up to three get one line each; four or more get one summary line ("N feedbacks overdue"), all of them claimed.
 */
export async function pingOverdue(env, now = new Date(), fetcher = fetch) {
  if (!env.STATS) return 0;
  const claimed = [];
  for (const row of await overdueRows(env, now)) if (await claim(env, row.ref, now)) claimed.push(row);
  if (!claimed.length) return 0;
  const legacy = env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null;
  const lines = claimed.length >= SUMMARY_FROM
    ? [{refs: claimed.map(row => row.ref), text: `⏰ ${claimed.length} feedbacks have had no reply for 24 h.`, link: '/admin/feedback/inbox'}]
    : claimed.map(row => ({refs: [row.ref], text: `⏰ Feedback ${row.ref} from v${row.version} has had no reply for 24 h.`, link: `/admin/feedback/inbox#${row.ref}`}));
  for (const line of lines) {
    const told = await alertOwner(env, 'feedback-overdue', {text: line.text, link: line.link, fetcher, now, legacy}).catch(() => null);
    await release(env, line.refs, told);
  }
  return claimed.length;
}
