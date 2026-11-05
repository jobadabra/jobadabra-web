// Unsubscribe and bounces for shared/mail.js. GET /unsubscribe?a=<address digest>&l=<service|releases|tips>&t=<signed token> shows a one-button page (a mail scanner opening the link changes nothing);
// POST on the same URL (the button, or a mail client's one-click List-Unsubscribe-Post) turns that list off. Bounce/complaint events from the Email Sending queue turn every list off.
// A service stop also sets pro_accounts.service_mail_off_at; a news stop replaces that type's yes (shared/mail-lists.js). Guard: test/unit/shared/mail/mail.test.js.
import {cardPage} from '../shared/card-page.js';
import {digestOf, equal, tokenFor} from '../shared/guard.js';
import {OPT_IN, switchOff} from '../shared/mail-lists.js';

export {switchOff};   // moved to shared/mail-lists.js so shared/hosted.js can use it; api callers keep this import

const LISTS = ['service', ...OPT_IN, 'marketing'];   // 'marketing': the link in a mail sent before the three types; its box named both news types
export const page = (title, body, status = 200) => cardPage({title, body, status, tone: status >= 400 ? 'bad' : ''});   // the site's one card (shared/card-page.js)
const MEANING = {service: 'the daily search mails (new matches, reminders)', jobdigest: 'the job digest', releases: 'new-release emails', tips: 'tips and tricks', marketing: 'new-release emails and tips and tricks'};

export async function unsubscribe(request, env, now = new Date()) {
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', list = url.searchParams.get('l') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !LISTS.includes(list) || !equal(token, await tokenFor(addr, env, `unsub-${list}`))) return page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
  if (request.method === 'POST') {
    await switchOff(env, addr, list, 'unsubscribe', now);
    return page('Done', `<p>You will get no more mail about ${MEANING[list]}.</p>`);
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  return page('Stop these mails?', `<p>This stops ${MEANING[list]}.</p><form method="post"><button>Stop these mails</button></form>`);
}

// One Email Sending event (queue message body): a hard bounce or a complaint turns the address off for good.
export async function handleEvent(env, event, now = new Date()) {
  const recipient = String(event?.payload?.recipient || '').trim().toLowerCase();
  const complaint = event?.type === 'cf.email.sending.message.complained';
  const hard = event?.type === 'cf.email.sending.message.bounced' && event.payload?.bounce?.type === 'hard';
  if (!recipient || !(complaint || hard)) return false;
  await switchOff(env, await digestOf(recipient), 'all', complaint ? 'complaint' : 'bounce', now);
  return true;
}

// The Worker's queue() handler for the Email Sending events subscription.
export async function consume(batch, env) {
  for (const message of batch.messages) {
    try { await handleEvent(env, message.body); message.ack(); }
    catch (error) { console.error(`mail event: ${error.message}`); message.retry(); }
  }
}
