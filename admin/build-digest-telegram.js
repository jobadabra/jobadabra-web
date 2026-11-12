// The Build Log Telegram post: the day's FINAL digest as HTML messages (Telegram's markdown dislikes plain text), split at group boundaries under its 4096-character limit (spec docs/superpowers/specs/2026-10-16-daily-digest.md).
// A separate bot and chat from the job digest bot and the CI alerts (secrets BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT). Pure + an injected fetch, so tests never reach Telegram. Guard: test/unit/admin/build/build-digest-telegram.test.js.
import {countOf, dayWords} from './build-digest.js';
import {digestCard} from '../shared/owner-cards.js';


// Why (10 Nov 2026, owner: every message reads like the Central scout one; before that 29 Oct 2026: "the build log is too detailed. I don't want so many details. It should summarize a day in few lines"):
// ONE card (shared/owner-cards.js digestCard): the count in the headline, one row per goal with its first bullet lead (top 3 + N more), what is still open, one link to the Build log page that keeps the full list.
export function messages({day, groups, open, numbers}) {
  const {count} = countOf(numbers);
  return [digestCard({day: dayWords(day), count, open, groups: groups.map(group => ({emoji: group.emoji, title: group.title, lead: group.bullets[0]?.lead || '', more: group.bullets.length - 1}))}).text];
}

// Sends them in order. `send(text)` (the job passes lib/telegram-post.mjs: the owner's switchboard first, this bot when it cannot deliver) -> the line it printed; without it the Build Log bot is called directly.
// Why (12 Nov 2026, owner: "Still getting on old telegram bots: CI Alerts, Build Log ..."): the digest posted with the Build Log bot only, so the owner's Notifications switch (event daily-build-digest) could not stop it.
// No token or chat and no `send`: {skipped} (the digest is still stored; the post is the one thing missing). A Telegram error throws, naming only the status (never the token).
export async function post(result, {token, chat, fetch: doFetch = fetch, send = null}) {
  if (!send && (!token || !chat)) return {skipped: 'BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT are not set'};
  const list = messages(result);
  let sent = 0;
  for (const text of list) {
    if (send) {
      const line = await send(text);
      if (/not sent/.test(line)) return {skipped: line, sent};
      if (!/^telegram: (sent|held)/.test(line)) throw new Error(`Telegram answered: ${String(line).replace(/^telegram: /, '')}`);
      sent += 1;
      continue;
    }
    const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true})});
    if (!response.ok) throw new Error(`Telegram answered ${response.status}`);
    sent += 1;
  }
  return {sent};
}
