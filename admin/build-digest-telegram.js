// The Build Log Telegram post: the day's FINAL digest as HTML messages (Telegram's markdown dislikes plain text), split at group boundaries under its 4096-character limit (spec docs/superpowers/specs/2026-10-16-daily-digest.md).
// A separate bot and chat from the job digest bot and the CI alerts (secrets BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT). Pure + an injected fetch, so tests never reach Telegram. Guard: test/unit/admin/build/build-digest-telegram.test.js.
import {countOf, dayWords} from './build-digest.js';

const LIMIT = 3800;
const LEADS = 1;
const html = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function messages({day, groups, open, numbers}) {
  const {count} = countOf(numbers);
  const intro = count ? `Here's what we achieved on ${html(dayWords(day))} (about ${count} PR${count === 1 ? '' : 's'} merged).` : `Nothing was merged on ${html(dayWords(day))}.`;
  // Why (owner, 29 Oct 2026: "the build log is too detailed. I don't want so many details. It should summarize a day in few lines"): one line per goal, its first
  // bullet lead and "+N more", no PR numbers (the admin Build log page keeps the full list). Cut from the day's own leads: no extra AI call.
  const line = group => { const leads = group.bullets.map(bullet => html(bullet.lead)), more = leads.length - LEADS; return `${html(group.emoji)} <b>${html(group.title)}:</b> ${leads.slice(0, LEADS).join('; ')}${more > 0 ? ` +${more} more` : ''}`; };
  const out = [];
  let current = intro;
  const add = (text, gap) => { if (current.length + text.length + gap.length > LIMIT) { out.push(current.trimEnd()); current = text; } else current += `${gap}${text}`; };
  groups.forEach((group, i) => add(line(group), i ? '\n' : '\n\n'));
  add(`<b>Still open:</b> ${html(open || 'Nothing open.')}`, '\n\n');
  out.push(current.trimEnd());
  return out;
}

// Sends them in order. No token or chat: {skipped} (the digest is still stored; the post is the one thing missing). A Telegram error throws, naming only the status (never the token).
export async function post(result, {token, chat, fetch: doFetch = fetch}) {
  if (!token || !chat) return {skipped: 'BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT are not set'};
  const list = messages(result);
  for (const text of list) {
    const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true})});
    if (!response.ok) throw new Error(`Telegram answered ${response.status}`);
  }
  return {sent: list.length};
}
