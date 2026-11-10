// The owner's ping when a "Report this form" has waited 2 days and nobody fetched it (Why (10 Nov 2026, owner's Apply assessment R7): the 27 Oct report waited 14 days, because the fetch is by
// hand on the owner's Mac and the only word was the one Telegram line at upload). The sibling of shared/feedback-overdue.js: run by the Worker's 5-minute trigger once an hour (minute 10,
// workers/www/index.js); once per report, the row's own waiting_told_at is the flag, claimed before the send and given back after a real failure. Counts only: the Worker has no host or page.
// Guarded by test/unit/shared/report-waiting.test.js.
import {KEEP_DAYS} from './report-form.js';
import {causeWords} from './report-notify.js';
import {alertOwner} from './notify-send.js';
import {reportWaitingCard} from './owner-cards.js';

export const WAIT_DAYS = 2;
const MAX_ROWS = 50, SUMMARY_FROM = 4;   // past three at once, one line (the overdue ping's rule for a burst)
const dayAgo = (now, days) => new Date(now.getTime() - days * 86400e3).toISOString().slice(0, 10);
const daysSince = (day, now) => Math.floor((Date.parse(dayAgo(now, 0)) - Date.parse(day)) / 86400e3);

/** The reports still waiting whose UTC day is more than WAIT_DAYS ago, still kept (30 days) and not pinged yet, oldest first. */
async function waitingRows(env, now) {
  return (await env.STATS.prepare("SELECT id, day, requests, cause FROM form_reports WHERE status = 'new' AND waiting_told_at = '' AND day < ? AND day >= ? ORDER BY day, id LIMIT ?")
    .bind(dayAgo(now, WAIT_DAYS), dayAgo(now, KEEP_DAYS), MAX_ROWS).all()).results || [];
}

/** Claims one report (compare-and-set on the empty flag); false when another tick took it first. */
async function claim(env, id, now) {
  const done = await env.STATS.prepare("UPDATE form_reports SET waiting_told_at = ? WHERE id = ? AND waiting_told_at = ''").bind(now.toISOString(), id).run();
  return (done?.meta?.changes ?? done?.changes ?? 0) > 0;
}

/** Gives the flag back after a real failure; the owner's switch off ("switchboard") and "nothing configured" are final, as in feedback-overdue.js. */
async function release(env, ids, told) {
  const unconfigured = told?.via === 'none' && ['no-bot', 'channel-not-connected', 'no-store'].includes(told.why);
  if (unconfigured || (told && (told.sent || told.via === 'switchboard'))) return;
  for (const id of ids) await env.STATS.prepare("UPDATE form_reports SET waiting_told_at = '' WHERE id = ?").bind(id).run().catch(() => {});
}

/** One tick: tells the owner once for each report that has waited WAIT_DAYS since the last tick. -> how many were claimed. Up to three get one line each; four or more one summary. */
export async function pingWaitingReports(env, now = new Date(), fetcher = fetch) {
  if (!env.STATS) return 0;
  const claimed = [];
  for (const row of await waitingRows(env, now)) if (await claim(env, row.id, now)) claimed.push(row);
  if (!claimed.length) return 0;
  const legacy = env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null;
  const lines = claimed.length >= SUMMARY_FROM ? [{ids: claimed.map(row => row.id), text: reportWaitingCard({count: claimed.length, days: WAIT_DAYS}).text}]
    : claimed.map(row => ({ids: [row.id], text: reportWaitingCard({days: daysSince(row.day, now), day: row.day, cause: causeWords(row.cause), requests: row.requests}).text}));
  for (const line of lines) {
    const told = await alertOwner(env, 'form-report-waiting', {text: line.text, html: true, fetcher, now, legacy}).catch(() => null);
    await release(env, line.ids, told);
  }
  return claimed.length;
}
