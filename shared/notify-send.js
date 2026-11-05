// How a Worker-side sender tells the owner (owner, 5 Nov 2026; spec docs/superpowers/specs/2026-11-05-ops-notifications-design.md, PR 2/4): ask the switchboard first (shared/notify.js: the owner's switch,
// "when", channel), and if it cannot deliver, post with the sender's OLD bot so an alert is never lost (fail-open); then report that to the switchboard so Admin shows "sent without switchboard".
// A switchboard answer of "held back" (off, same state, not a problem, already today, rate) is final: nothing is posted, via 'switchboard' with sent false. -> {sent, via: 'switchboard' | 'fallback' | 'none', why, id, bot}
// via 'none' with sent false = nothing delivered anywhere: the caller keeps the alert to retry; via 'switchboard' with sent false = held on purpose, done.
// `legacy` = {token, chat} of the bot the sender used before; without it, a switchboard that cannot deliver ends as {sent: false, via: 'none'}.
// The text carries no name or e-mail address (the switchboard replaces an address): say what happened and link to the Admin page.
import {notify, words} from './notify.js';
import {sendMessage} from './notify-telegram.js';

const plain = why => String(why || '').replace(/^telegram: /, '');   // the reason as the old senders wrote it ("400 Bad Request: ...")

export async function alertOwner(env, event, {text, link = '', html = false, state, level, legacy = null, fetcher = fetch, now = new Date()}) {
  let asked = null;
  try { asked = await notify(env, {event, text, link, html, state, level}, {fetcher, now}); } catch { /* fail open below */ }
  if (asked?.status === 200) return {sent: Boolean(asked.body.sent), via: 'switchboard', why: asked.body.why || '', id: asked.body.id, bot: asked.bot || null};
  if (!legacy?.token || !legacy?.chat) return {sent: false, via: 'none', why: plain(asked?.body?.why) || 'no-bot', bot: null};
  // Telegram refused the very bot the old path would use: a second post to it would only fail again (and double the call).
  if (asked?.bot && asked.bot.token === legacy.token && String(asked.bot.chat) === String(legacy.chat)) return {sent: false, via: 'none', why: plain(asked.body.why), bot: null};
  const posted = await sendMessage(fetcher, legacy.token, legacy.chat, words(text, link, html), html ? {parse_mode: 'HTML'} : {});
  if (!posted.ok) return {sent: false, via: 'fallback', why: posted.why, bot: null};
  await notify(env, {event, fallback: true}, {fetcher, now}).catch(() => {});
  return {sent: true, via: 'fallback', why: asked?.body?.why || '', id: posted.result?.message_id, bot: {token: legacy.token, chat: legacy.chat}};
}
