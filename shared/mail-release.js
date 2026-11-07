// Compact release emails: the frame's header and title, then the complete changes grouped under New / Improved / Fixed.
// Email-safe tables and inline styles keep the preview and delivered email consistent. Test copies identify themselves in HTML, text and subject.
import {mailText} from './mail-copy.js';
import {appButton, fromMail} from './app-needs.js';
import {button, esc, SITE} from './mail-frame.js';
import {LIGHT as C} from './mail-palette.js';

const FONT = '-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif';
const emphasis = text => esc(text).replace(/\*([^*]+)\*/g, '<strong style="font-weight:600">$1</strong>');
// Why (5 Nov 2026, owner): recipients already have the app; opening it is primary, downloading stays in the footer.
const OPEN_APP = `${SITE}/open?view=jobs`;
// An app known to be too old is sent to the download page instead (shared/app-needs.js).
// Why (7 Nov 2026, preserving hr-39): the body action retains its release click attribution; only its label follows the explicit recipient locale.
const openAction = (version, locale) => appButton(fromMail({label: mailText(locale, 'openJobadabra'), url: OPEN_APP}, 'release'), version, locale);
const plain = text => String(text ?? '').replace(/\*([^*]+)\*/g, '$1');
const LABELS = {features: 'releaseNew', improvements: 'releaseImproved', fixes: 'releaseFixed'};
const labelOf = (section, locale) => mailText(locale, LABELS[section.kind] || LABELS.improvements);
const picture = image => (image?.url ? `<p style="margin:12px 0 0"><img class="jp-line" src="${esc(image.url)}" alt="${esc(image.alt || '')}" width="100%" style="display:block;width:100%;height:auto;border:1px solid ${C.line};border-radius:8px"></p>` : '');

/** Keeps the version visible in inboxes regardless of the length of any release description. */
export const releaseSubject = ({version, test = false, locale} = {}) => mailText(locale, 'releaseSubject', {test: test ? '[TEST] ' : '', version});

/** The mail's title, under the header every mail has. */
export const releaseTitle = ({version, locale} = {}) => mailText(locale, 'releaseTitle', {version});

// One short line under the title, then an explicitly saved introduction and picture, if any.
const opening = ({version, previousStable, month, intro, hero, test = false, locale}) => (test ? `<p class="jp-sig" style="margin:0 0 6px;font:600 12px/1.4 ${FONT};color:${C.signal}">${mailText(locale, 'releaseTest', {version: esc(version)})}</p>` : '')
  + `<p class="jp-muted" style="margin:0;font:400 13px/1.5 ${FONT};color:${C.muted}">${[month, previousStable && mailText(locale, 'changesSince', {version: previousStable})].filter(Boolean).map(part => esc(part)).join(' · ')}</p>`
  + (intro ? `<p style="margin:12px 0 0;font:400 14px/1.5 ${FONT}">${esc(intro)}</p>` : '') + picture(hero);

// One change: its title and text run together, so a short change takes one or two lines.
const change = section => `<p style="margin:0 0 8px;font:400 14px/1.5 ${FONT};overflow-wrap:anywhere"><strong style="font-weight:600">${esc(/[.!?]$/.test(section.title) ? section.title : `${section.title}.`)}</strong> ${emphasis(section.text)}</p>`
  + (section.steps?.length ? `<ol style="margin:0 0 8px;padding-left:22px;font:400 14px/1.5 ${FONT}">${section.steps.map(step => `<li style="margin:0 0 3px;padding-left:3px">${emphasis(step)}</li>`).join('')}</ol>` : '')
  + picture(section.image);

/**
 * The changes grouped under New, Improved and Fixed.
 * Why (owner, 6 Nov 2026: "make this one more compact", "having consistent header", "be consistent between dark/light"): the header and the colours are the frame's, like every mail; a label per group, not per change.
 */
export function releaseHtml({sections = [], appVersion, locale = 'en', ...data} = {}) {
  const rows = Object.values(LABELS).map(key => [mailText(locale, key), sections.filter(section => labelOf(section, locale) === mailText(locale, key))]).filter(([, list]) => list.length)
    .map(([label, list]) => `<tr><td class="jp-line" style="padding:12px 0 4px;border-top:1px solid ${C.line}"><p class="jp-sig" style="margin:0 0 6px;font:600 12px/1.4 ${FONT};color:${C.signal}">${label}</p>${list.map(change).join('')}</td></tr>`).join('');
  return opening({...data, locale}) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;margin-top:14px">${rows}</table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="jp-line" style="padding-top:12px;border-top:1px solid ${C.line}">`
    + `<p class="jp-muted" style="margin:0;font:400 13px/1.5 ${FONT};color:${C.muted}">${mailText(locale, 'releaseUpdate', {update: `<strong style="font-weight:600">${esc(mailText(locale, 'update'))}</strong>`})}</p>`
    + button(openAction(appVersion, locale)) + '</td></tr></table>';
}

/** Provides the same version, categories and changes to clients that display plain text. */
export function releaseText({version, previousStable, month, intro, sections = [], test = false, appVersion, locale = 'en'} = {}) {
  const action = openAction(appVersion, locale);
  const parts = sections.map(section => [`${labelOf(section, locale)}: ${section.title}. ${plain(section.text)}`, ...(section.steps || []).map((step, index) => `${index + 1}. ${plain(step)}`)].join('\n'));
  return [...(test ? [mailText(locale, 'releaseTest', {version}), ''] : []), mailText(locale, 'releaseVersion', {version}), month, ...(previousStable ? [mailText(locale, 'changesSince', {version: previousStable})] : []), '', ...(intro ? [intro, ''] : []), ...parts.flatMap(part => [part, '']),
    mailText(locale, 'releaseUpdate', {update: mailText(locale, 'update')}), `${action.label}: ${action.url}`].join('\n');
}
