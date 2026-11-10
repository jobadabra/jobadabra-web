// The notification switchboard's store and sender, in shared/ so the admin pages and the Worker's own senders use the same code as the route (api/ops-notify.js). (owner, 5 Nov 2026: "control easily on what I want to get alerted or not"; sketch Xo6tGKuwH7P86VcWq9eBv9, spec docs/superpowers/specs/2026-11-05-ops-notifications-design.md).
// Every owner-facing alert is posted here as {event, text, link}; this checks the registry (shared/notify-registry.js), the owner's switch and its "when", picks the channel's bot and sends.
//   POST /ops/notify   Bearer SELFHEAL_PUBLISH_KEY (the key every CI upload uses)   body {event, text, link?, state?, level?, html?, fallback?}   (html: the text is Telegram HTML)
//     200 {ok:true, sent:true}              sent
//     200 {ok:true, sent:false, why}        held back on purpose (off, same state, not a problem, already today, rate): the sender does nothing more
//     200 {ok:true, logged:true}            `fallback:true`: the sender posted with its old bot because this was unreachable; only Admin's "sent without switchboard" count is told
//     400 {why:'unknown-event'}             not in the registry: it cannot send
//     503 {ok:false, why}                   could not deliver (channel without a bot, Telegram refused): the sender posts with its old bot (fail-open: a red main is never lost)
//   A Worker caller (the site's own senders, PR 2) calls notify(env, ...) in process.
// Invariants: the text is never stored; an e-mail address in it is replaced; a token never leaves this file's helpers (shared/notify-telegram.js hides it from errors).
import {open, seal} from './notify-vault.js';
import {botName, chatTitle, lastChat, sendMessage} from './notify-telegram.js';
import {alertOf, channelOf, effective} from './notify-registry.js';
import {testCard} from './owner-cards.js';

const KEEP_DAYS = 30, MAX_TEXT = 3500, MAX_HTML = 3750;   // Why (5 Nov 2026, code review): feedback HTML is ~3000 text + header + link, and escaping grows it; Telegram allows 4096 with the link
const answer = (status, body) => ({status, body});

/** event -> {enabled, mode, channel} for every alert the owner changed (an unreadable table reads as none: the defaults apply). */
export async function readSettings(env) {
  try { return new Map(((await env.STATS.prepare('SELECT event, enabled, mode, channel FROM notify_settings').all()).results || []).map(row => [row.event, row])); } catch { return new Map(); }
}
/** The owner's change to one alert: any of {enabled: boolean, mode, channel}; a value the registry does not allow is refused (false). */
export async function saveSetting(env, id, patch, now = new Date()) {
  const alert = alertOf(id);
  if (!alert) return false;
  if (patch.mode !== undefined && !alert.modes.includes(patch.mode)) return false;
  if (patch.channel !== undefined && !channelOf(patch.channel)) return false;
  // Why (5 Nov 2026, review): a read-modify-write lost a column when two changes met or when the read failed; each column is set alone, NULL = untouched.
  await env.STATS.prepare('INSERT INTO notify_settings (event, enabled, mode, channel, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event) DO UPDATE SET enabled = COALESCE(excluded.enabled, enabled), mode = COALESCE(excluded.mode, mode), channel = COALESCE(excluded.channel, channel), at = excluded.at')
    .bind(id, patch.enabled === undefined ? null : patch.enabled ? 1 : 0, patch.mode ?? null, patch.channel ?? null, now.toISOString()).run();
  return true;
}

/** The bot behind a channel: the one connected in Admin, else the channel's old Worker secrets (Users: the Brain bot). -> {token, chat, source, name, title} or null. */
export async function botOf(env, id) {
  const row = await env.STATS?.prepare('SELECT token_enc, chat_id, bot_name, chat_title FROM notify_channels WHERE channel = ?').bind(id).first().catch(() => null);
  const token = row ? await open(env, row.token_enc) : null;
  if (row && token) return {token, chat: row.chat_id, source: 'admin', name: row.bot_name, title: row.chat_title};
  const [tokenVar, chatVar] = channelOf(id)?.env || [];
  return tokenVar && env[tokenVar] && env[chatVar] ? {token: env[tokenVar], chat: String(env[chatVar]), source: 'secret', name: '', title: ''} : null;
}
/** "Change bot": checks the token with Telegram, finds the chat (typed, else the one that last wrote to the bot), stores the token sealed. -> {ok, name, title} or {ok:false, why}. */
export async function connect(env, id, token, chat, fetcher = fetch, now = new Date()) {
  if (!channelOf(id)) return {ok: false, why: 'Unknown channel.'};
  token = String(token || '').trim(); chat = String(chat || '').trim();
  if (!/^\d{5,}:[\w-]{20,}$/.test(token)) return {ok: false, why: 'That is not a bot token (it looks like 123456:ABC…, from @BotFather).'};
  if (!env.NOTIFY_SECRET) return {ok: false, why: 'The Worker secret NOTIFY_SECRET is not set, so a token cannot be kept safely yet.'};
  const bot = await botName(fetcher, token);
  if (!bot.ok) return {ok: false, why: `Telegram did not accept this token (${bot.why}).`};
  if (!chat) { const found = await lastChat(fetcher, token); if (!found.ok) return found; chat = found.chat; }
  const title = await chatTitle(fetcher, token, chat);
  if (!title.ok) return {ok: false, why: `The bot cannot see that chat (${title.why}). Add it to the chat, or send it a message.`};
  await env.STATS.prepare('INSERT INTO notify_channels (channel, token_enc, chat_id, bot_name, chat_title, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET token_enc = excluded.token_enc, chat_id = excluded.chat_id, bot_name = excluded.bot_name, chat_title = excluded.chat_title, at = excluded.at')
    .bind(id, await seal(env, token), chat, bot.name, title.title, now.toISOString()).run();
  return {ok: true, name: bot.name, title: title.title};
}
/** What the page shows for a channel, read live from Telegram (getMe, getChat) and, if Telegram does not answer, from what was kept. -> {connected, source, name, title, live, why} */
export async function channelStatus(env, id, fetcher = fetch) {
  const bot = await botOf(env, id);
  if (!bot) return {connected: false};
  const [me, chat] = await Promise.all([botName(fetcher, bot.token), chatTitle(fetcher, bot.token, bot.chat)]);
  return {connected: true, source: bot.source, live: me.ok && chat.ok, name: me.ok ? me.name : bot.name, title: chat.ok ? chat.title : bot.title, why: me.ok ? (chat.ok ? '' : chat.why) : me.why};
}
/** "Send test": one message to the channel's chat; not an alert, so not in any alert's last sent. -> {ok, why} */
export async function sendTest(env, id, fetcher = fetch, now = new Date()) {
  const bot = await botOf(env, id);
  if (!bot) return {ok: false, why: 'No bot connected to this channel yet.'};
  const sent = await sendMessage(fetcher, bot.token, bot.chat, testCard(channelOf(id).name).text, {parse_mode: 'HTML'});
  await log(env, {event: '_test', at: now, channel: id, sent: sent.ok ? 1 : 0, reason: sent.ok ? '' : sent.why});
  return sent.ok ? {ok: true} : {ok: false, why: sent.why};
}

// Why (5 Nov 2026, review): a failed log write after Telegram accepted the message made notify() answer 503, and the sender then posted it a second time with its old bot; the log never decides the answer.
async function log(env, row) {
  await env.STATS.prepare('INSERT INTO notify_log (event, at, channel, sent, reason, state, via) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.event, row.at.toISOString(), row.channel || '', row.sent, String(row.reason || '').slice(0, 200), row.state || '', row.via || 'switchboard').run().catch(() => {});
}
/** Per alert: last sent, sends in 7 days, sends the sender made without the switchboard in 7 days. event -> {last, week, fallback}. Unreadable = empty. */
export async function stats(env, now = new Date()) {
  const out = new Map();
  try {
    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    for (const row of (await env.STATS.prepare('SELECT event, MAX(at) AS last, SUM(CASE WHEN via = ? THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN via = ? THEN 1 ELSE 0 END) AS fallback FROM notify_log WHERE sent = 1 AND at >= ? GROUP BY event').bind('switchboard', 'fallback', since).all()).results || []) out.set(row.event, {last: row.last, week: row.week, fallback: row.fallback});
    for (const row of (await env.STATS.prepare('SELECT event, MAX(at) AS last FROM notify_log WHERE sent = 1 GROUP BY event').all()).results || []) out.set(row.event, {week: 0, fallback: 0, ...out.get(row.event), last: row.last});
  } catch { /* the page draws without numbers */ }
  return out;
}
// Why (10 Nov 2026, owner: the same alert came twice while a channel was down): a message the owner got through the sender's old bot counts as sent, with its state, for "changes only", "daily" and the hourly limit. Admin's "sent without switchboard" count still reads via.
const lastSent = (env, event) => env.STATS.prepare('SELECT at, state FROM notify_log WHERE event = ? AND sent = 1 ORDER BY id DESC LIMIT 1').bind(event).first();
const sentSince = async (env, event, since) => Number((await env.STATS.prepare('SELECT COUNT(*) AS n FROM notify_log WHERE event = ? AND sent = 1 AND at >= ?').bind(event, since.toISOString()).first())?.n) || 0;

/** The text as sent: an e-mail address replaced (an alert never carries personal data), cut to Telegram's size, the Admin link last. */
export function words(text, link, html = false) {
  const scrub = value => String(value || '').replace(/[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/g, '[e-mail]');
  const cut = scrub(text).trim().slice(0, html ? MAX_HTML : MAX_TEXT), body = html ? cut.replace(/<[^>]*$/, '').replace(/&[#\w]*$/, '') : cut, url = String(link || '').replace(/[?#].*$/, rest => (/@|%40/i.test(rest) ? '' : rest));   // a link keeps its address; a query that carries an e-mail address is cut
  return /^https:\/\/[^\s]{1,300}$/.test(url) ? `${body}\n${url}` : body;
}
/** One alert asked to go out. -> {status, body} as documented above; a send also carries `bot` (the bot that delivered it) for an in-process caller, never in the body the route returns. */
export async function notify(env, payload, {now = new Date(), fetcher = fetch} = {}) {
  const alert = alertOf(payload?.event);
  if (!alert) return answer(400, {ok: false, why: 'unknown-event'});
  if (!env.STATS) return answer(503, {ok: false, why: 'no-store'});
  try {
    if (payload.fallback === true) { await log(env, {event: alert.id, at: now, channel: alert.channel, sent: 1, via: 'fallback', state: String(payload.state || '').slice(0, 60)}); return answer(200, {ok: true, sent: false, logged: true}); }
    const mine = effective(alert, (await readSettings(env)).get(alert.id));
    const held = why => answer(200, {ok: true, sent: false, why});
    if (!mine.on) return held('off');
    if (mine.mode === 'problems' && payload.level === 'ok') return held('not-a-problem');
    const state = String(payload.state || '').slice(0, 60), before = mine.mode === 'changes' || mine.mode === 'daily' || alert.maxPerHour ? await lastSent(env, alert.id) : null;
    if (mine.mode === 'changes' && state && before?.state === state) return held('same-state');
    if (mine.mode === 'daily' && before && before.at.slice(0, 10) === now.toISOString().slice(0, 10)) return held('already-today');
    if (alert.maxPerHour && await sentSince(env, alert.id, new Date(now.getTime() - 3600000)) >= alert.maxPerHour) return held('rate');
    const bot = await botOf(env, mine.channel);
    if (!bot) { await log(env, {event: alert.id, at: now, channel: mine.channel, sent: 0, reason: 'channel-not-connected', state}); return answer(503, {ok: false, why: 'channel-not-connected'}); }
    const sent = await sendMessage(fetcher, bot.token, bot.chat, words(payload.text, payload.link, payload.html), payload.html ? {parse_mode: 'HTML'} : {});
    await log(env, {event: alert.id, at: now, channel: mine.channel, sent: sent.ok ? 1 : 0, reason: sent.ok ? '' : sent.why, state});
    await env.STATS.prepare('DELETE FROM notify_log WHERE at < ?').bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString()).run().catch(() => {});
    return sent.ok ? {...answer(200, {ok: true, sent: true, id: sent.result?.message_id}), bot} : {...answer(503, {ok: false, why: `telegram: ${sent.why}`}), bot};   // bot: in-process callers only (shared/notify-send.js skips a second try on the same bot)
  } catch (error) {
    return answer(503, {ok: false, why: `error: ${String(error.message).slice(0, 120)}`});
  }
}
