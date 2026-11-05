// Compact release emails: a prominent version, dated header and complete New / Improved / Fixed changelog rows.
// Email-safe tables and inline styles keep the preview and delivered email consistent. Test copies identify themselves in HTML, text and subject.
import {button, esc, SITE} from './mail-frame.js';
import {LIGHT as C} from './mail-palette.js';

const FONT = '-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif';
const pill = text => `<span class="jp-pill" style="background:${C.soft};color:${C.softInk};border-radius:4px;padding:1px 6px;font-weight:600;white-space:nowrap">${esc(text)}</span>`;
export const withPills = text => esc(text).replace(/\*([^*]+)\*/g, (_, word) => pill(word.replace(/&amp;/g, '&')));
const plain = text => String(text ?? '').replace(/\*([^*]+)\*/g, '$1');
const LABELS = {features: 'New', improvements: 'Improved', fixes: 'Fixed'};
const labelOf = section => LABELS[section.kind] || 'Improved';
const picture = image => (image?.url ? `<p style="margin:12px 0 0"><img src="${esc(image.url)}" alt="${esc(image.alt || '')}" width="100%" style="display:block;width:100%;height:auto;border:1px solid ${C.line};border-radius:8px"></p>` : '');

/** Keeps the version visible in inboxes regardless of the length of any release description. */
export const releaseSubject = ({version, test = false}) => `${test ? '[TEST] ' : ''}Jobadabra ${version} · What's new`;

/** Renders a short version heading; only an explicitly saved introduction adds introductory prose. */
export function releaseHero({version, month, intro, hero, test = false}) {
  return `<tr><td style="background:${C.hero};padding:24px;color:${C.onHero};border-radius:12px 12px 0 0">`
    + (test ? `<p style="margin:0 0 12px;color:${C.onHero};font-weight:700">Test email · Release ${esc(version)} · Sent only to your test address</p>` : '')
    + `<p style="margin:0 0 12px;font-size:13px;color:${C.onHeroMuted}"><img src="${SITE}/images/logo-mark.png" width="22" height="19" alt="" style="vertical-align:middle;border:0"> &nbsp;What's new in Jobadabra</p>`
    + `<h1 style="margin:0;font:700 24px/1.25 ${FONT};color:${C.onHero}">Version ${esc(version)}</h1>`
    + `<p style="margin:8px 0 0;font-size:13px;color:${C.onHeroMuted}">${esc(month)}</p>`
    + (intro ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:${C.onHero}">${esc(intro)}</p>` : '')
    + picture(hero) + '</td></tr>';
}

/** Lists every change with its category, keeping long text within the email's table width. */
export function releaseHtml({sections = [], updateUrl}) {
  const rows = sections.map(section => `<tr><td width="78" style="width:78px;padding:3px 12px 18px 0;vertical-align:top;font:700 11px ${FONT};color:${C.signal}">${labelOf(section)}</td><td style="padding:0 0 18px;vertical-align:top">`
    + `<p style="margin:0;line-height:1.6;overflow-wrap:anywhere"><b>${esc(section.title)}.</b> ${withPills(section.text)}</p>`
    + (section.steps?.length ? `<p style="margin:8px 0 0;line-height:1.6">${section.steps.map(step => withPills(step)).join('<br>')}</p>` : '')
    + picture(section.image) + '</td></tr>').join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rows}</table>`
    + `<p style="margin:8px 0 0;line-height:1.6">Open Jobadabra and choose <b>Update</b>, or download the new version below. Your searches and settings stay as they are.</p>`
    + (updateUrl ? button({label: 'Download latest version', url: updateUrl}) : '');
}

/** Provides the same version, categories and changes to clients that display plain text. */
export function releaseText({version, month, intro, sections = [], updateUrl, test = false}) {
  const parts = sections.map(section => [`${labelOf(section)}: ${section.title}. ${plain(section.text)}`, ...(section.steps || []).map(plain)].join('\n'));
  return [...(test ? [`Test email · Release ${version} · Sent only to your test address`, ''] : []), `What's new in Jobadabra · Version ${version}`, month, '', ...(intro ? [intro, ''] : []), ...parts.flatMap(part => [part, '']),
    'Open Jobadabra and choose Update from the menu.', updateUrl ? `Or download it: ${updateUrl}` : ''].join('\n');
}
