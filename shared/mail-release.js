// Compact release emails: a prominent version, dated header and complete New / Improved / Fixed changelog rows.
// Email-safe tables and inline styles keep the preview and delivered email consistent. Test copies identify themselves in HTML, text and subject.
import {appButton} from './app-needs.js';
import {button, esc, SITE} from './mail-frame.js';
import {LIGHT as C} from './mail-palette.js';

const FONT = '-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif';
const emphasis = text => esc(text).replace(/\*([^*]+)\*/g, '<strong style="font-weight:600">$1</strong>');
// Why (5 Nov 2026, owner): recipients already have the app; opening it is primary, downloading stays in the footer.
const OPEN_APP = `${SITE}/open?view=jobs`;
// An app known to be too old is sent to the download page instead (shared/app-needs.js).
const openAction = version => appButton({label: 'Open Jobadabra App', url: OPEN_APP}, version);
const plain = text => String(text ?? '').replace(/\*([^*]+)\*/g, '$1');
const LABELS = {features: 'New', improvements: 'Improved', fixes: 'Fixed'};
const labelOf = section => LABELS[section.kind] || 'Improved';
const picture = image => (image?.url ? `<p style="margin:12px 0 0"><img src="${esc(image.url)}" alt="${esc(image.alt || '')}" width="100%" style="display:block;width:100%;height:auto;border:1px solid ${C.line};border-radius:8px"></p>` : '');

/** Keeps the version visible in inboxes regardless of the length of any release description. */
export const releaseSubject = ({version, test = false}) => `${test ? '[TEST] ' : ''}Jobadabra ${version} · What's new`;

/** Renders a short version heading; only an explicitly saved introduction adds introductory prose. */
export function releaseHero({version, previousStable, month, intro, hero, test = false}) {
  return `<tr><td style="background:${C.hero};padding:24px 26px;color:${C.onHero};border-radius:12px 12px 0 0">`
    + (test ? `<p style="margin:0 0 12px;color:${C.onHero};font-weight:700">Test email · Release ${esc(version)} · Sent only to your test address</p>` : '')
    + `<p style="margin:0 0 12px;font-size:13px;color:${C.onHeroMuted}"><img src="${SITE}/images/logo-mark.png" width="22" height="19" alt="" style="vertical-align:middle;border:0"> &nbsp;What's new in Jobadabra</p>`
    + `<h1 style="margin:0;font:700 28px/1.2 ${FONT};color:${C.onHero}">Version ${esc(version)}</h1>`
    + `<p style="margin:8px 0 0;font-size:13px;color:${C.onHeroMuted}">${esc(month)}</p>`
    + (previousStable ? `<p style="margin:8px 0 0;font-size:13px;color:${C.onHeroMuted}">Changes since version ${esc(previousStable)}</p>` : '')
    + (intro ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:${C.onHero}">${esc(intro)}</p>` : '')
    + picture(hero) + '</td></tr>';
}

/** Separates change headings, descriptions and ordered instructions for comfortable email reading. */
export function releaseHtml({sections = [], appVersion}) {
  const rows = sections.map((section, index) => `<tr><td style="padding:${index ? 22 : 0}px 0 22px;${index ? `border-top:1px solid ${C.line};` : ''}" class="jp-line">`
    + `<p class="jp-sig" style="margin:0 0 6px;font:600 12px/1.4 ${FONT};color:${C.signal}">${labelOf(section)}</p>`
    + `<h2 class="jp-ink" style="margin:0 0 8px;font:600 18px/1.35 ${FONT};color:${C.ink}">${esc(section.title).replace(/\.$/, '')}</h2>`
    + `<p style="margin:0;font:400 15px/1.65 ${FONT};overflow-wrap:anywhere">${emphasis(section.text)}</p>`
    + (section.steps?.length ? `<ol style="margin:12px 0 0;padding-left:22px;font:400 14px/1.65 ${FONT}">${section.steps.map(step => `<li style="margin:0 0 5px;padding-left:3px">${emphasis(step)}</li>`).join('')}</ol>` : '')
    + picture(section.image) + '</td></tr>').join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rows}</table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="jp-line" style="padding-top:20px;border-top:1px solid ${C.line}">`
    + `<p class="jp-muted" style="margin:0;font:400 14px/1.6 ${FONT};color:${C.muted}">Open Jobadabra and choose <strong style="font-weight:600">Update</strong> to get this release.</p>`
    + button(openAction(appVersion)) + '</td></tr></table>';
}

/** Provides the same version, categories and changes to clients that display plain text. */
export function releaseText({version, previousStable, month, intro, sections = [], test = false, appVersion}) {
  const action = openAction(appVersion);
  const parts = sections.map(section => [`${labelOf(section)}: ${section.title}. ${plain(section.text)}`, ...(section.steps || []).map((step, index) => `${index + 1}. ${plain(step)}`)].join('\n'));
  return [...(test ? [`Test email · Release ${version} · Sent only to your test address`, ''] : []), `What's new in Jobadabra · Version ${version}`, month, ...(previousStable ? [`Changes since version ${previousStable}`] : []), '', ...(intro ? [intro, ''] : []), ...parts.flatMap(part => [part, '']),
    'Open Jobadabra and choose Update to get this release.', `${action.label}: ${action.url}`].join('\n');
}
