// The mails we send, by name. shared/mail.js puts each through the frame (shared/mail-frame.js: logo, title, button, footer with the unsubscribe and settings links) and adds the headers. A template says its list
// ('service' or 'marketing'), whether it is `essential` (a sign-in code: not stopped by an unsubscribe), and builds subject, title, content (text and html) and an optional one `button` from plain data. Guard: test/unit/shared/mail/mail.test.js.
import {appButton} from './app-needs.js';
import {purchaseCreditWords} from './credit-purchase-words.js';
import {codeBox, esc, jobRows, jobText, link} from './mail-frame.js';
import {LIGHT as C} from './mail-palette.js';
import {releaseHero, releaseHtml, releaseSubject, releaseText} from './mail-release.js';

// A message the app or an Always on run would send on Telegram, in the same layout: data {subject, html, text, buttons: [{text, url}], confirmUrl} (html/text from api/mail-html.js).
// The first button is the frame's one orange button; the others are links under the text.
const moreHtml = (buttons = [], app) => buttons.slice(1).map(b => appButton(b, app)).map(b => `<p>${link(b.url, b.text)}</p>`).join('');
const moreText = (buttons = [], app) => buttons.slice(1).map(b => appButton(b, app)).map(b => `${b.text}: ${b.url}`).join('\n');
const confirmHtml = url => (url ? `<p>${link(url, 'Confirm your email')} to get every mail at once (until then, one a day).</p>` : '');
const confirmText = url => (url ? `\nConfirm your email to get every mail at once (until then, one a day): ${url}` : '');
const first = (buttons = [], app) => (buttons[0] ? appButton({label: buttons[0].text, url: buttons[0].url}, app) : null);

const SITE = 'https://www.jobadabra.top';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const muted = text => `<p class="jp-muted" style="margin:0 0 14px;color:${C.muted};font-size:13.5px">${esc(text)}</p>`;

export const TEMPLATES = {
  'message': {list: 'service',
    subject: ({subject}) => String(subject || 'Jobadabra').slice(0, 150),
    title: ({subject}) => String(subject || 'Jobadabra').slice(0, 150),
    button: ({buttons, appVersion}) => first(buttons, appVersion),
    text: ({text, buttons, confirmUrl, appVersion}) => [text, moreText(buttons, appVersion)].filter(Boolean).join('\n\n') + confirmText(confirmUrl),
    html: ({html, buttons, confirmUrl, appVersion}) => `${html}${moreHtml(buttons, appVersion)}${confirmHtml(confirmUrl)}`},
  // The first mail to a new or changed address (api/account-email.js, once per address ever; owner, 26 Oct 2026: "Can we send an welcome email?"). Data: {confirmUrl}.
  'welcome': {list: 'service',
    subject: () => 'Confirm your email for Jobadabra',
    title: () => 'Your job matches will come here',
    button: ({confirmUrl}) => (confirmUrl ? {label: 'Confirm your email', url: confirmUrl} : null),
    text: () => "New job matches, reminders and answers from Jobadabra will come to this address. Confirm it to get every mail at once; until then we send at most one a day.\n\nDidn't ask for this? Ignore this email.",
    html: () => `<p>New job matches, reminders and answers from Jobadabra will come to this address. Confirm it to get every mail at once; until then we send at most one a day.</p>${muted("Didn't ask for this? Ignore this email.")}`},
  // The confirm link again, when the person presses Resend in the app (api/account-email.js resend; owner, 2 Nov 2026: "Keep it, make it painless"). Essential: it must reach an address whose mail
  // the 14-day stop holds back (that stop is lifted by this very confirmation). Data: {confirmUrl}.
  'confirm-resend': {list: 'service', essential: true,
    subject: () => 'Confirm your email for Jobadabra',
    title: () => 'Confirm your email',
    button: ({confirmUrl}) => (confirmUrl ? {label: 'Confirm your email', url: confirmUrl} : null),
    text: () => "You asked for the confirm link again. Press it and your Jobadabra mails reach you.\n\nDidn't ask for this? Ignore this email; nothing changes.",
    html: () => `<p>You asked for the confirm link again. Press it and your Jobadabra mails reach you.</p>${muted("Didn't ask for this? Ignore this email; nothing changes.")}`},
  // The owner's answer to a feedback the person sent from the app (shared/feedback-reply.js, owner 3 Nov 2026): "fixed" or "we saw it and parked it". Only when the person gave this address and the owner ticked it.
  // A service mail (never a promotion). Data: {kind: 'fixed' | 'deferred', on: 'YYYY-MM-DD', excerpt, message}.
  'feedback-update': {list: 'service',
    subject: () => 'About your feedback',
    title: ({kind}) => (kind === 'fixed' ? 'Your feedback is fixed' : 'Thanks for your feedback'),
    text: ({on, excerpt, message}) => `You wrote on ${on}: "${excerpt}"\n\n${message}`,
    html: ({on, excerpt, message}) => `${muted(`You wrote on ${on}: "${excerpt}"`)}<p>${esc(message)}</p>`},
  // Account mail: the code that proves an address (Pro device codes, sign-in). Data: {code}.
  'account-code': {list: 'service', essential: true,
    subject: () => 'Your Jobadabra code',
    title: () => 'Your sign-in code',
    text: ({code}) => `Your Jobadabra code is ${code}.\n\nType it in the app within 10 minutes. If you did not ask for it, ignore this email; nothing changes.`,
    html: ({code}) => `${codeBox(code)}${muted("Type it in the app within 10 minutes. If you didn't ask for it, ignore this email; nothing changes.")}`},
  // The new-matches mail, one per run. Data: {matches: [{title, company, place, mode, fit, url}], total, openUrl?}. A service mail: never a promotion.
  'digest': {list: 'service',
    subject: ({total, matches = []}) => `${total ?? matches.length} new job match${(total ?? matches.length) === 1 ? '' : 'es'}`,
    title: ({total, matches = []}) => ((total ?? matches.length) === 1 ? '1 new match' : `${total ?? matches.length} new matches`),
    button: ({openUrl, appVersion}) => appButton({label: 'Open in Jobadabra', url: openUrl || `${SITE}/open?view=jobs`}, appVersion),
    text: ({matches = []}) => jobText(matches),
    html: ({matches = [], total}) => `${(total ?? matches.length) > matches.length ? muted(`The top ${matches.length} of ${total}.`) : ''}${jobRows(matches)}`},
  // Trial reminders (admin/mail-lifecycle.js): service mails, facts only, no promotion. Data: {left} / {days}. Off unless env.TRIAL_REMINDERS = "on".
  'trial-left': {list: 'service',
    subject: ({left}) => `${plural(left, 'free application')} left`,
    title: ({left}) => `${plural(left, 'free application')} left`,
    text: ({left}) => `You have ${plural(left, 'application')} left in your free Jobadabra trial (20 applications or 60 days, whichever lasts longer).\nSearches, tracking and your data keep working as they are.`,
    html: ({left}) => `<p>You have <b>${esc(left)}</b> ${left === 1 ? 'application' : 'applications'} left in your free Jobadabra trial (20 applications or 60 days, whichever lasts longer).</p><p>Searches, tracking and your data keep working as they are.</p>`},
  'trial-ending': {list: 'service',
    subject: ({days}) => `Your free trial ends in ${plural(days, 'day')}`,
    title: ({days}) => `Your free trial ends in ${plural(days, 'day')}`,
    button: ({pricingUrl}) => ({label: 'See the details', url: pricingUrl}),
    text: ({days}) => `Your free Jobadabra trial ends in ${plural(days, 'day')}. After that new searches and drafts pause; your data stays yours.`,
    html: ({days}) => `<p>Your free Jobadabra trial ends in <b>${esc(days)}</b> ${days === 1 ? 'day' : 'days'}. After that new searches and drafts pause; your data stays yours.</p>`},
  // Always on paused (hosted spec §4b). Data: {reason: 'trial-over' | 'inactive', pricingUrl, pro}. Purely functional; the Pro button shows only when `pro` (the owner's marketing flag) is on.
  'always-on-paused': {list: 'service',
    subject: ({reason}) => (reason === 'inactive' ? 'Always on paused: open the app to resume' : 'Always on paused: your free trial has ended'),
    title: ({reason}) => (reason === 'inactive' ? 'Always on is paused' : 'Always on is paused: your free trial has ended'),
    button: ({reason, pricingUrl, pro}) => (reason !== 'inactive' && pro ? {label: 'Get Pro to keep it running', url: pricingUrl} : null),
    text: ({reason}) => (reason === 'inactive' ? "You haven't opened Jobadabra for 14 days, so the daily searches stopped. Open the app to resume." : 'Your free trial has ended, so the daily searches stopped.'),
    html: ({reason}) => (reason === 'inactive' ? "<p>You haven't opened Jobadabra for 14 days, so the daily searches stopped. Open the app to resume.</p>" : '<p>Your free trial has ended, so the daily searches stopped.</p>')},
  // The marketing list: sent by hand (admin/mail-lifecycle.js launch), only to opted-in addresses and only with env.MARKETING_MAIL = "on". Data: {pro, proAi, pricingUrl} (euro prices from shared/pro-packages.js).
  'pro-launch': {list: 'marketing',
    subject: () => 'Jobadabra Pro is out',
    title: () => 'Jobadabra Pro is out',
    button: ({pricingUrl}) => ({label: 'See Pro', url: pricingUrl}),
    text: ({pro, proAi}) => `One payment, no subscription: Pro €${pro}, or Pro + AI €${proAi} with ${purchaseCreditWords('pro-ai')} VAT included.`,
    html: ({pro, proAi}) => `<p>One payment, no subscription: Pro €${esc(pro)}, or Pro + AI €${esc(proAi)} with ${purchaseCreditWords('pro-ai')} VAT included.</p>`},
  // The "What's new" mail at a stable release (shared/mail-release.js), held as a draft on /admin/growth/email until the owner clicks "Send to everyone". Data: see mail-release.js.
  'release': {list: 'marketing',
    subject: releaseSubject,
    title: releaseSubject,
    hero: releaseHero,
    text: releaseText,
    html: releaseHtml},
};
