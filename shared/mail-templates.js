// The mails we send, by name. shared/mail.js puts each through the frame (shared/mail-frame.js: logo, title, button, footer with the unsubscribe and settings links) and adds the headers. A template says its list
// ('service', 'releases' or 'tips': shared/mail-lists.js), whether it is `essential` (a sign-in code: not stopped by an unsubscribe), and builds subject, title, content (text and html) and an optional one `button` from plain data. Guard: test/unit/shared/mail/mail.test.js.
import {mailText} from './mail-copy.js';
import {appButton} from './app-needs.js';
import {purchaseCreditWords} from './credit-purchase-words.js';
import {codeBox, esc, jobRows, jobText, link} from './mail-frame.js';
import {LIGHT as C} from './mail-palette.js';
import {releaseHtml, releaseSubject, releaseText, releaseTitle} from './mail-release.js';
import {FREE_APPLICATIONS} from './trial.js';

// A message the app or an Always on run would send on Telegram, in the same layout: data {subject, html, text, buttons: [{text, url}], confirmUrl} (html/text from api/mail-html.js).
// The first button is the frame's one orange button; the others are links under the text.
const moreHtml = (buttons = [], app, locale) => buttons.slice(1).map(b => appButton(b, app, locale)).map(b => `<p>${link(b.url, b.text)}</p>`).join('');
const moreText = (buttons = [], app, locale) => buttons.slice(1).map(b => appButton(b, app, locale)).map(b => `${b.text}: ${b.url}`).join('\n');
const confirmHtml = (url, locale) => (url ? `<p>${mailText(locale, 'confirmReminderHtml', {confirm: link(url, mailText(locale, 'confirmAction'))})}</p>` : '');
const confirmText = (url, locale) => (url ? mailText(locale, 'confirmReminderText', {url}) : '');
const first = (buttons = [], app, locale) => (buttons[0] ? appButton({label: buttons[0].text, url: buttons[0].url}, app, locale) : null);

const SITE = 'https://www.jobadabra.top';
const muted = text => `<p class="jp-muted" style="margin:0 0 14px;color:${C.muted};font-size:13.5px">${esc(text)}</p>`;

export const TEMPLATES = {
  message: {list: 'service',
    subject: ({subject} = {}) => String(subject || 'Jobadabra').slice(0, 150),
    title: ({subject} = {}) => String(subject || 'Jobadabra').slice(0, 150),
    button: ({buttons, appVersion, locale} = {}) => first(buttons, appVersion, locale),
    text: ({text, buttons, confirmUrl, appVersion, locale} = {}) => [text, moreText(buttons, appVersion, locale)].filter(Boolean).join('\n\n') + confirmText(confirmUrl, locale),
    html: ({html, buttons, confirmUrl, appVersion, locale} = {}) => `${html}${moreHtml(buttons, appVersion, locale)}${confirmHtml(confirmUrl, locale)}`},
  welcome: {list: 'service',
    subject: ({locale} = {}) => mailText(locale, 'welcomeSubject'),
    title: ({locale} = {}) => mailText(locale, 'welcomeTitle'),
    button: ({confirmUrl, locale} = {}) => (confirmUrl ? {label: mailText(locale, 'confirmAction'), url: confirmUrl} : null),
    text: ({locale} = {}) => `${mailText(locale, 'welcomeBody')}\n\n${mailText(locale, 'welcomeIgnore')}`,
    html: ({locale} = {}) => `<p>${mailText(locale, 'welcomeBody')}</p>${muted(mailText(locale, 'welcomeIgnore'))}`},
  'confirm-resend': {list: 'service', essential: true,
    subject: ({locale} = {}) => mailText(locale, 'welcomeSubject'),
    title: ({locale} = {}) => mailText(locale, 'confirmAction'),
    button: ({confirmUrl, locale} = {}) => (confirmUrl ? {label: mailText(locale, 'confirmAction'), url: confirmUrl} : null),
    text: ({locale} = {}) => `${mailText(locale, 'resendBody')}\n\n${mailText(locale, 'resendIgnore')}`,
    html: ({locale} = {}) => `<p>${mailText(locale, 'resendBody')}</p>${muted(mailText(locale, 'resendIgnore'))}`},
  'feedback-update': {list: 'service', heldByStops: true,
    subject: ({locale} = {}) => mailText(locale, 'feedbackSubject'),
    title: ({kind, locale} = {}) => mailText(locale, kind === 'fixed' ? 'feedbackFixedTitle' : 'feedbackThanksTitle'),
    text: ({on, excerpt, message, locale} = {}) => `${mailText(locale, 'feedbackQuoted', {on, excerpt})}\n\n${message}`,
    html: ({on, excerpt, message, locale} = {}) => `${muted(mailText(locale, 'feedbackQuoted', {on, excerpt}))}<p>${esc(message)}</p>`},
  'account-code': {list: 'service', essential: true,
    subject: ({locale} = {}) => mailText(locale, 'codeSubject'),
    title: ({locale} = {}) => mailText(locale, 'codeTitle'),
    text: ({code, locale} = {}) => `${mailText(locale, 'codeLine', {code})}\n\n${mailText(locale, 'codeInstructions')}`,
    html: ({code, locale} = {}) => `${codeBox(code)}${muted(mailText(locale, 'codeInstructionsHtml'))}`},
  digest: {list: 'service',
    subject: ({total, matches = [], locale} = {}) => mailText(locale, 'digestSubject', {count: total ?? matches.length}),
    title: ({total, matches = [], locale} = {}) => mailText(locale, 'digestTitle', {count: total ?? matches.length}),
    button: ({openUrl, appVersion, locale} = {}) => appButton({label: mailText(locale, 'openInApp'), url: openUrl || `${SITE}/open?view=jobs`}, appVersion, locale),
    text: ({matches = [], locale} = {}) => jobText(matches, locale),
    html: ({matches = [], total, locale} = {}) => `${(total ?? matches.length) > matches.length ? muted(mailText(locale, 'topMatches', {shown: matches.length, total})) : ''}${jobRows(matches, locale)}`},
  'trial-left': {list: 'service',
    subject: ({left, locale} = {}) => mailText(locale, 'trialLeft', {count: left}),
    title: ({left, locale} = {}) => mailText(locale, 'trialLeft', {count: left}),
    text: ({left, limit = FREE_APPLICATIONS, locale} = {}) => `${mailText(locale, 'trialOpening', {count: left, number: left, limit})}\n${mailText(locale, 'trialClosing')}`,   // limit: the person's own number (30 on their own AI, shared/trial.js)
    html: ({left, limit = FREE_APPLICATIONS, locale} = {}) => `<p>${mailText(locale, 'trialOpening', {count: left, number: `<b>${esc(left)}</b>`, limit})}</p><p>${mailText(locale, 'trialClosing')}</p>`},
  'trial-ending': {list: 'service',
    subject: ({days, locale} = {}) => mailText(locale, 'trialEndingSubject', {count: days}),
    title: ({days, locale} = {}) => mailText(locale, 'trialEndingSubject', {count: days}),
    button: ({pricingUrl, locale} = {}) => ({label: mailText(locale, 'seeDetails'), url: pricingUrl}),
    text: ({days, locale} = {}) => mailText(locale, 'trialEndingBody', {count: days, number: days}),
    html: ({days, locale} = {}) => `<p>${mailText(locale, 'trialEndingBody', {count: days, number: `<b>${esc(days)}</b>`})}</p>`},
  'always-on-paused': {list: 'service',
    subject: ({reason, locale} = {}) => mailText(locale, reason === 'inactive' ? 'pausedSubjectInactive' : 'pausedSubjectExpired'),
    title: ({reason, locale} = {}) => mailText(locale, reason === 'inactive' ? 'pausedTitleInactive' : 'pausedTitleExpired'),
    button: ({reason, pricingUrl, pro, locale} = {}) => (reason !== 'inactive' && pro ? {label: mailText(locale, 'keepRunning'), url: pricingUrl} : null),
    text: ({reason, locale} = {}) => mailText(locale, reason === 'inactive' ? 'pausedBodyInactive' : 'pausedBodyExpired'),
    html: ({reason, locale} = {}) => `<p>${mailText(locale, reason === 'inactive' ? 'pausedBodyInactive' : 'pausedBodyExpired')}</p>`},
  'always-on-test': {list: 'service', heldByStops: true,   // Why (review of hr-32): it measures whether alerts reach the person, so every stop alerts obey holds it too
    subject: ({locale} = {}) => mailText(locale, 'testSubject'),
    title: ({locale} = {}) => mailText(locale, 'testTitle'),
    text: ({locale} = {}) => mailText(locale, 'testBody'),
    html: ({locale} = {}) => `<p>${mailText(locale, 'testBody')}</p>`},
  'pro-launch': {list: 'tips', waitlistToo: true,
    subject: ({locale} = {}) => mailText(locale, 'proSubject'),
    title: ({locale} = {}) => mailText(locale, 'proSubject'),
    button: ({pricingUrl, locale} = {}) => ({label: mailText(locale, 'seePro'), url: pricingUrl}),
    text: ({pro, proAi, locale} = {}) => mailText(locale, 'proBody', {pro, proAi, credit: purchaseCreditWords('pro-ai', locale)}),
    html: ({pro, proAi, locale} = {}) => `<p>${mailText(locale, 'proBody', {pro: esc(pro), proAi: esc(proAi), credit: purchaseCreditWords('pro-ai', locale)})}</p>`},
  release: {list: 'releases', subject: releaseSubject, title: releaseTitle, text: releaseText, html: releaseHtml},
};
