// One call to the Telegram Bot API as the owner's Brain bot (env.BRAIN_BOT_TOKEN): -> {why: '', id} when Telegram accepted it, else {why} (never the token).
// Why (3 Nov 2026, owner: "Send me a telegram message everytime a new user… adds his email"): api/feedback.js had the only tidy copy and the new e-mail ping (api/account-email.js) needed it too, so it lives here once.
// TODO(AI): api/brain.js, shared/feedback-impact.js and shared/free-ai.js still carry their own raw copies of this call (3 Nov 2026).
// `body` is a JSON object, or a FormData for a photo. The caller checks BRAIN_CHAT_ID; a missing token answers {why: 'off'} without a call.
export async function telegram(fetcher, env, method, body) {
  if (!env.BRAIN_BOT_TOKEN) return {why: 'off'};   // never post to .../botundefined/ nor split an error text on "undefined"
  try {
    const response = await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/${method}`, body instanceof FormData ? {method: 'POST', body}
      : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const answer = await response.json().catch(() => ({}));
    if (response.ok && answer.ok !== false) return {why: '', id: answer.result?.message_id};
    return {why: `${response.status} ${answer.description || ''}`.trim()};
  } catch (error) {
    return {why: `network ${String(error.message).split(env.BRAIN_BOT_TOKEN).join('<token>')}`};
  }
}
