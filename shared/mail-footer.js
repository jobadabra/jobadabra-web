// Why each e-mail came, said in its footer (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md, "Every mail says why it came", PR 5; owner, 5 Nov 2026).
// Why (6 Nov 2026, owner, on the first version: "these footers looks horriable. Loks like essays/novels"): at most two short lines: why, in a few words, then the links.
// Facts that need a sentence (what hosted Always on stores) sit behind a link ("How we keep your data" → /trust), never in the footer.
// One answer per mail, from who owns it (shared/mail-registry.js):
// - Account: no stop link and no List-Unsubscribe header (the person asked for it).
// - Yours: where to change it in the app, and a web stop link for someone who lost the app while their own GitHub keeps mailing them
//   (owner: "there should be a link for us to intervene and stop that email sending").
// - Jobadabra's news: the same for everyone; stop, e-mail settings, and the download line (news also reaches people without the app).
// Every sentence must stay true: a test pins each one (test/unit/shared/mail/mail-footer.test.js).
import {mailOf} from './mail-registry.js';

// Why (6 Nov 2026, owner: "Keep promise, cut extras"): the footer says who chose the mail, never where it was written. Our server keeps nothing once a mail is sent (a mail waiting for the digest waits at most 14 days: /trust).
const YOURS = 'You chose these in the app: Settings → Notifications.';
const ACCOUNT = {
  'account-code': 'A security e-mail, sent even if you stopped others.',
  welcome: 'This address was entered in Jobadabra.',
  'confirm-resend': 'A new link was asked for in Jobadabra.',
  'feedback-update': 'About a report you sent.',
  'always-on-test': 'You pressed Test in the app.',
};
// Why (review of hr-32): pro-launch also reaches people who only joined the Pro list, so not "You ticked this".
const NEWS = 'Same news for everyone. You asked for it.';
const HOSTED = ['digest', 'always-on-paused'];   // written by our servers for hosted Always on: its footer links what we store

/**
 * The footer of `template`: {why, stop, settings, trust, download}. `stop`: a stop link (and the List-Unsubscribe headers); `settings`: the e-mail settings link;
 * `trust`: the "How we keep your data" link; `download`: the "Don't have the app?" line. `fallback`: the old line for a mail this file has no answer for.
 */
export function footerOf(template, fallback = '') {
  const mail = mailOf(template);
  if (mail?.owner === 'account') return {why: ACCOUNT[template] || fallback, stop: false, settings: false, trust: false, download: false};
  if (mail?.owner === 'yours') return {why: YOURS, stop: true, settings: false, trust: HOSTED.includes(template), download: false};
  if (template === 'release' || template === 'pro-launch') return {why: NEWS, stop: true, settings: true, trust: false, download: true};
  return {why: fallback, stop: true, settings: true, trust: false, download: true};   // the trial mails (off: TRIAL_REMINDERS): unchanged until they are redesigned
}
