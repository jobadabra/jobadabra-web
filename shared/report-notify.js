// The owner's Telegram message for each "Report this form" the Worker stores (docs/superpowers/specs/2026-10-15-report-this-form.md §6): counts only (the cause word, the number of page
// responses, a short install digest, the time), never a host, page or value: the Worker has none. Same bot and chat as the feedback message (BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, Worker secrets).
// After 10 messages in a UTC day one "more reports today" line replaces the rest, so a burst is not a storm. A failure to tell never fails the upload. Guarded by test/unit/shared/report-form.test.js.
import {alertOwner} from './notify-send.js';
import {formReportedCard, formsMoreCard} from './owner-cards.js';

export const TELL_PER_DAY = 10;

// The cause in plain words, for the message and for /admin/form-filling/reports. The app sends a word (X-Report-Meta cause; the Worker keeps a-z, 0-9, _ and -): the ladder's signals get a sentence,
// any other word is spelled out (wrong_page -> "Wrong page"), none is "No cause given". A new word needs no change here.
const CAUSES = {person: 'Reported by the person', stalled: 'Stalled on the form', failed: 'The fill failed', contradicted: 'Answer contradicted the page', unsure: 'Not sure how to fill', blind: 'Could not read the page', refused: 'A control refused the value'};
export const causeWords = cause => CAUSES[cause] || (cause ? cause.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'No cause given');

// Why (10 Nov 2026, owner: every message reads like the Central scout one): one card each (shared/owner-cards.js).
export function reportMessage({cause, requests, who, now}) {
  return formReportedCard({cause: causeWords(cause), requests, who, time: now.toISOString().slice(11, 16)}).text;
}
export const moreMessage = () => formsMoreCard().text;

// `count` = this report's place in the day (1 = the first). Returns true when a message went out; never throws.
export async function tellOwner(env, report, count, fetcher = fetch) {
  if (count > TELL_PER_DAY + 1) return false;
  const text = count > TELL_PER_DAY ? moreMessage() : reportMessage(report);
  try {
    const legacy = env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null;
    return (await alertOwner(env, 'form-reported', {text, html: true, legacy, fetcher})).sent;
  } catch (error) { console.log('report notify failed', error.message); return false; }
}
