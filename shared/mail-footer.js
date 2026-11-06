// Why each e-mail came, said in its footer (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md, "Every mail says why it came", PR 5; owner, 5 Nov 2026).
// One answer per mail, from who owns it (shared/mail-registry.js):
// - Account: no unsubscribe link and no List-Unsubscribe header (the person asked for it); the confirm mails say where the address came from (their body already says to ignore a mail they did not ask for).
// - Yours: "You chose this in the Jobadabra app." (hosted Always on: what we store and why), then "Change this in the Jobadabra app: Settings → Notifications." and, small, "Can't open the app? Stop these e-mails." (the web stop link:
//   for someone who lost the app while their own GitHub keeps mailing them; owner: "there should be a link for us to intervene and stop that email sending").
// - Jobadabra's news: the same for everyone, nothing from the person's search; one click stops it, and the e-mail settings page is linked.
// Every sentence must stay true: a test pins each one (test/unit/shared/mail/mail-footer.test.js).
import {mailOf} from './mail-registry.js';

// Why (6 Nov 2026, owner: "Keep promise, cut extras"): nobody reads where a mail was written, so app mail says only who chose it; the server still keeps nothing after sending.
// The CHANGE line under it (shared/mail-frame.js) names where to change it, so this line does not repeat "Settings → Notifications".
const YOURS = 'You chose this in the Jobadabra app.';
// Hosted Always on is the one place their data does live on our servers, so its mails say so.
const HOSTED_WHY = 'You get this because you turned on Always on. Your profile is stored encrypted, kept apart per account and deleted when you turn it off. We use it only to run your search, never for marketing.';
const ACCOUNT = {
  'account-code': 'A security email, sent even if you stopped other emails.',
  // Why (6 Nov 2026): their body already says "Didn't ask for this? Ignore this email" (shared/mail-templates.js), so the footer only says where the address came from.
  welcome: 'Someone entered this address in the Jobadabra app.',
  'confirm-resend': 'Someone asked for this link in the Jobadabra app.',
  'feedback-update': 'About a report you sent from the Jobadabra app.',
  'always-on-test': 'You pressed Test in the Jobadabra app.',
};
const NEWS = 'News from Jobadabra, the same for everyone. Nothing here comes from your search or profile. You ticked this, and one click stops it.';
const HOSTED = ['digest', 'always-on-paused'];   // written by our servers for hosted Always on

/**
 * The footer of `template`: {why, stop, settings, change}. `stop`: a stop link (and the List-Unsubscribe headers); `settings`: the e-mail settings link;
 * `change`: the two Yours lines. `fallback`: the old line for a mail this file has no answer for.
 */
export function footerOf(template, fallback = '') {
  const mail = mailOf(template);
  if (mail?.owner === 'account') return {why: ACCOUNT[template] || fallback, stop: false, settings: false, change: false};
  if (mail?.owner === 'yours') return {why: HOSTED.includes(template) ? HOSTED_WHY : YOURS, stop: true, settings: false, change: true};
  if (template === 'release' || template === 'pro-launch') return {why: NEWS, stop: true, settings: true, change: false};
  return {why: fallback, stop: true, settings: true, change: false};   // the trial mails (off: TRIAL_REMINDERS): unchanged until they are redesigned
}
