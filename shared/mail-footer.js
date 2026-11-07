// Why each e-mail came, said in its footer (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md, "Every mail says why it came", PR 5; owner, 5 Nov 2026).
// Why (6 Nov 2026, owner, on the first version: "these footers looks horriable. Loks like essays/novels"): at most two short lines: why, in a few words, then the links.
// Facts that need a sentence (what hosted Always on stores) sit behind a link ("How we keep your data" → /trust), never in the footer.
// One answer per mail, from who owns it (shared/mail-registry.js):
// - Account: no stop link and no List-Unsubscribe header (the person asked for it).
// - Yours: where to change it in the app, and a web stop link for someone who lost the app while their own GitHub keeps mailing them
//   (owner: "there should be a link for us to intervene and stop that email sending").
// - Jobadabra's news: the same for everyone; stop, e-mail settings, and the download line (news also reaches people without the app).
// Every sentence must stay true: a test pins each one (test/unit/shared/mail/mail-footer.test.js).
import {mailText} from './mail-copy.js';
import {mailOf} from './mail-registry.js';

// Why (7 Nov 2026, preserving the 6 Nov owner rule): keep the same chooser/storage promises and policy flags; resolve their bundled copy per recipient.
const YOURS = 'footerYours';
const ACCOUNT = {
  'account-code': 'footerSecurity',
  welcome: 'footerWelcome',
  'confirm-resend': 'footerResend',
  'feedback-update': 'footerFeedback',
  'always-on-test': 'footerTest',
};
// Why (7 Nov 2026, preserving hr-32): the Pro-list audience still gets the same truthful news explanation, selected from bundled locale copy.
const NEWS = 'footerNews';
const HOSTED = ['digest', 'always-on-paused'];   // written by our servers for hosted Always on: its footer links what we store

/**
 * The footer of `template`: {why, stop, settings, trust, download}. `stop`: a stop link (and the List-Unsubscribe headers); `settings`: the e-mail settings link;
 * `trust`: the "How we keep your data" link; `download`: the "Don't have the app?" line. `fallback`: the old line for a mail this file has no answer for.
 */
export function footerOf(template, fallback = '', locale = 'en', fallbackKey = '') {
  // Why (7 Nov 2026, approved notification design): only typed bundled fallback IDs localize; arbitrary supplied fallback stays content.
  const trustedFallback = ['footerService', 'footerJobDigest', 'footerReleases', 'footerTips'].includes(fallbackKey) ? mailText(locale, fallbackKey) : fallback;
  const mail = mailOf(template);
  if (mail?.owner === 'account') return {why: ACCOUNT[template] ? mailText(locale, ACCOUNT[template]) : trustedFallback, stop: false, settings: false, trust: false, download: false};
  if (mail?.owner === 'yours') return {why: mailText(locale, YOURS), stop: true, settings: false, trust: HOSTED.includes(template), download: false};
  if (template === 'release' || template === 'pro-launch') return {why: mailText(locale, NEWS), stop: true, settings: true, trust: false, download: true};
  return {why: trustedFallback, stop: true, settings: true, trust: false, download: true};   // the trial mails (off: TRIAL_REMINDERS): unchanged until they are redesigned
}
