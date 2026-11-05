// The four Telegram Bot API calls the switchboard makes, for any bot token (shared/telegram.js is the Brain bot's alone). Every answer is {ok, why, ...}: `why` never carries the token.
// `fetcher` is injectable for tests. A call gives up after `ms` (the Notifications page asks three channels at once).
async function call(fetcher, token, method, body, ms = 4000) {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms)});
    const answer = await response.json().catch(() => ({}));
    if (response.ok && answer.ok !== false) return {ok: true, result: answer.result};
    return {ok: false, why: `${response.status} ${String(answer.description || '').split(token).join('<token>')}`.trim()};
  } catch (error) {
    return {ok: false, why: `network ${String(error.message).split(token).join('<token>')}`};
  }
}
/** `extra` = more Bot API fields, e.g. {parse_mode: 'HTML'}. -> {ok, result: {message_id}} or {ok: false, why}. */
export const sendMessage = (fetcher, token, chat, text, extra = {}) => call(fetcher, token, 'sendMessage', {chat_id: chat, text, disable_web_page_preview: true, ...extra});
/** A photo (FormData: chat_id, photo, caption, reply_to_message_id) with the same answers; its call is longer: an upload. */
export async function sendPhoto(fetcher, token, form) {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendPhoto`, {method: 'POST', body: form, signal: AbortSignal.timeout(15000)});
    const answer = await response.json().catch(() => ({}));
    return response.ok && answer.ok !== false ? {ok: true, result: answer.result} : {ok: false, why: `${response.status} ${String(answer.description || '').split(token).join('<token>')}`.trim()};
  } catch (error) { return {ok: false, why: `network ${String(error.message).split(token).join('<token>')}`}; }
}
/** The bot's @name, or why not. */
export async function botName(fetcher, token) {
  const answer = await call(fetcher, token, 'getMe');
  return answer.ok ? {ok: true, name: answer.result?.username ? `@${answer.result.username}` : String(answer.result?.first_name || 'bot')} : answer;
}
/** The chat's title (a person's name for a private chat), or why not. */
export async function chatTitle(fetcher, token, chat) {
  const answer = await call(fetcher, token, 'getChat', {chat_id: chat});
  const r = answer.result || {};
  return answer.ok ? {ok: true, title: String(r.title || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || chat)} : answer;
}
/** The chat the bot last heard from (the owner sent it any message), or why not. A bot with a webhook cannot be asked: the owner types the chat id instead. */
export async function lastChat(fetcher, token) {
  const answer = await call(fetcher, token, 'getUpdates', {limit: 20, timeout: 0});
  if (!answer.ok) return /409/.test(answer.why) ? {ok: false, why: 'This bot has a webhook, so Telegram will not list its messages: type the chat id.'} : answer;
  const last = [...(answer.result || [])].reverse().map(update => (update.message || update.channel_post)?.chat).find(Boolean);
  return last ? {ok: true, chat: String(last.id)} : {ok: false, why: 'The bot has no message yet: send it any message in Telegram, then press Connect again.'};
}
