// The "What's new" mail: a greeting, the top changes as cards, the Open button, the other changes grouped and calmer (New / Also improved / Fixed), a thank-you line.
// Email-safe tables and inline styles keep the preview and delivered email consistent; dark mode comes from the frame's jp-* classes. Test copies identify themselves in HTML, text and subject.
// Guard: test/unit/shared/mail/mail-frame.test.js ("the release mail ...").
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
const sentence = title => (/[.!?]$/.test(title) ? title : `${title}.`);
// The calmer groups under the highlights, in this order; a change of an unknown kind counts as improved.
const GROUPS = [['features', 'releaseNew'], ['improvements', 'releaseAlsoImproved'], ['fixes', 'releaseFixed']];
const kindOf = section => (GROUPS.some(([kind]) => kind === section.kind) ? section.kind : 'improvements');
const picture = image => (image?.url ? `<p style="margin:12px 0 0"><img class="jp-line" src="${esc(image.url)}" alt="${esc(image.alt || '')}" width="100%" style="display:block;width:100%;height:auto;border:1px solid ${C.line};border-radius:8px"></p>` : '');
const steps = (list, size) => (list?.length ? `<ol style="margin:6px 0 0;padding-left:22px;font:400 ${size}px/1.5 ${FONT}">${list.map(step => `<li style="margin:0 0 3px;padding-left:3px">${emphasis(step)}</li>`).join('')}</ol>` : '');
const TOP = 3;

/** The key a tick stores for a change: its kind and title (two kinds may share a title: admin/release-mail.js keeps one change per kind and title). */
export const keyOf = section => `${kindOf(section)}|${section.title}`;

/**
 * The changes a mail shows first, at most three. `chosen`: the keys (keyOf; a bare title from a draft saved before 12 Nov 2026 still matches) the owner ticked on the review page (admin/release-mail-page.js); when none of them is still in the
 * mail, the default: each version's first change, newest version first, New before Improved, never a fix.
 * Why (owner, 12 Nov 2026, design A: "Automatic, you can change them"): a changelog leads each version with its biggest change, so the first of each version is the best guess without AI.
 * `sections` arrive oldest version first (admin/release-mail.js stableWindow); a section without a version (an old saved mail) counts as one version.
 */
export function highlightsOf(sections = [], chosen = []) {
  const picked = sections.filter(section => chosen.includes(keyOf(section)) || chosen.includes(section.title));
  if (picked.length) return picked.slice(0, TOP);
  const versions = [...new Set(newestFirst(sections).map(section => section.version ?? ''))];
  const queues = versions.map(version => sections.filter(section => (section.version ?? '') === version && kindOf(section) !== 'fixes')
    .sort((a, b) => (kindOf(a) === 'features' ? 0 : 1) - (kindOf(b) === 'features' ? 0 : 1)));
  const top = [];
  for (let at = 0; top.length < TOP && queues.some(queue => queue[at]); at++) for (const queue of queues) if (queue[at] && top.length < TOP) top.push(queue[at]);
  return top;
}

// The rest under its group's label: newest version first, each version in its changelog order.
const newestFirst = sections => { const versions = [...new Set(sections.map(section => section.version ?? ''))].reverse(); return versions.flatMap(version => sections.filter(section => (section.version ?? '') === version)); };
const restOf = (sections, top) => GROUPS.map(([kind, key]) => [key, newestFirst(sections.filter(section => !top.includes(section) && kindOf(section) === kind))]).filter(([, list]) => list.length);

/** Keeps the version visible in inboxes regardless of the length of any release description. */
export const releaseSubject = ({version, test = false, locale} = {}) => mailText(locale, 'releaseSubject', {test: test ? '[TEST] ' : '', version});

/** The mail's title, under the header every mail has. */
export const releaseTitle = ({version, locale} = {}) => mailText(locale, 'releaseTitle', {version});

// The greeting; the owner's saved introduction, if any, is its own paragraph under it.
const greeting = ({previousStable, locale}) => `${mailText(locale, 'releaseHello')} ${previousStable ? mailText(locale, 'releaseIntroSince', {version: previousStable}) : mailText(locale, 'releaseIntro')}`;

// A top change: its emoji in a soft square, a bold title, its text in full.
// A change without an emoji (an old saved mail) gets no empty square.
const card = section => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr>`
  + (section.emoji ? `<td width="44" valign="top" style="width:44px;padding:0 14px 16px 0"><div class="jp-pill" style="width:44px;height:44px;line-height:44px;text-align:center;font-size:22px;border-radius:12px;background:${C.soft}">${esc(section.emoji)}</div></td>` : '')
  + `<td valign="top" style="padding:0 0 16px;overflow-wrap:anywhere"><p class="jp-ink" style="margin:0 0 2px;font:600 16px/1.35 ${FONT};color:${C.ink}">${esc(section.title)}</p>`
  + `<p class="jp-ink" style="margin:0;font:400 14px/1.5 ${FONT};color:${C.ink}">${emphasis(section.text)}</p>${steps(section.steps, 14)}${picture(section.image)}</td></tr></table>`;

// Any other change: small emoji, bold title, grey text.
const line = section => `<tr><td width="22" valign="top" style="width:22px;padding:0 8px 10px 0;font-size:15px;line-height:1.45">${esc(section.emoji || '•')}</td>`
  + `<td valign="top" style="padding:0 0 10px;font:400 13px/1.45 ${FONT};overflow-wrap:anywhere"><strong class="jp-ink" style="font-weight:600;color:${C.ink}">${esc(sentence(section.title))}</strong> <span class="jp-muted" style="color:${C.muted}">${emphasis(section.text)}</span>${steps(section.steps, 13)}${picture(section.image)}</td></tr>`;

const TABLE = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';

/**
 * Design A (owner, 12 Nov 2026, on "hard to read" and "not welcoming"): greeting, the top three as cards, the button, the rest grouped and calmer, a thank-you.
 * Why (owner, 6 Nov 2026: "having consistent header", "be consistent between dark/light"): the header and the colours stay the frame's, like every mail; a label per group, not per change.
 */
export function releaseHtml({sections = [], highlights = [], appVersion, locale = 'en', test = false, version, hero, ...data} = {}) {
  const top = highlightsOf(sections, highlights);
  const groups = restOf(sections, top).map(([key, list]) => `<tr><td class="jp-line" style="padding:18px 0 4px;border-top:1px solid ${C.line}">`
    + `<p class="jp-muted" style="margin:0 0 8px;font:600 12px/1.4 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${esc(mailText(locale, key))}</p>${TABLE}${list.map(line).join('')}</table></td></tr>`).join('');
  return (test ? `<p class="jp-sig" style="margin:0 0 6px;font:600 12px/1.4 ${FONT};color:${C.signal}">${mailText(locale, 'releaseTest', {version: esc(version)})}</p>` : '')
    + `<p class="jp-ink" style="margin:0 0 20px;font:400 15px/1.55 ${FONT}">${esc(greeting({...data, locale}))}</p>`
    + (data.intro ? `<p class="jp-ink" style="margin:-8px 0 20px;font:400 15px/1.55 ${FONT}">${esc(data.intro)}</p>` : '') + picture(hero)
    + top.map(card).join('')
    + `${TABLE}<tr><td style="padding:0 0 22px">${button(openAction(appVersion, locale)).replace('margin:18px 0 0', 'margin:2px 0 0')}`
    + `<p class="jp-muted" style="margin:8px 0 0;font:400 13px/1.5 ${FONT};color:${C.muted}">${mailText(locale, 'releaseUpdate', {update: `<strong style="font-weight:600">${esc(mailText(locale, 'update'))}</strong>`})}</p></td></tr>`
    + groups + `<tr><td class="jp-line" style="padding:16px 0 0;border-top:1px solid ${C.line}"><p class="jp-ink" style="margin:0;font:400 15px/1.55 ${FONT}">${esc(mailText(locale, 'releaseThanks'))}</p></td></tr></table>`;
}

/** The same mail for clients that display plain text: greeting, top changes, the action, the grouped rest, the thank-you. */
export function releaseText({version, sections = [], highlights = [], test = false, appVersion, locale = 'en', ...data} = {}) {
  const action = openAction(appVersion, locale), top = highlightsOf(sections, highlights);
  const stepLines = section => (section.steps || []).map((step, index) => `${index + 1}. ${plain(step)}`);
  const topText = top.map(section => [`${section.emoji ? `${section.emoji} ` : ''}${section.title}`, plain(section.text), ...stepLines(section)].join('\n'));
  const restText = restOf(sections, top).map(([key, list]) => [mailText(locale, key), ...list.map(section => [`- ${sentence(section.title)} ${plain(section.text)}`, ...stepLines(section)].join('\n'))].join('\n'));
  return [...(test ? [mailText(locale, 'releaseTest', {version}), ''] : []), greeting({...data, locale}), '', ...(data.intro ? [data.intro, ''] : []), ...topText.flatMap(part => [part, '']),
    mailText(locale, 'releaseUpdate', {update: mailText(locale, 'update')}), `${action.label}: ${action.url}`, '', ...restText.flatMap(part => [part, '']), mailText(locale, 'releaseThanks')].join('\n');
}
