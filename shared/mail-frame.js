// The one frame every e-mail goes through (owner, 17 Oct 2026): a branded card with the logo, a title, the content, at most one yellow button and a footer saying why the person gets it,
// in at most two short lines (why, then the links its owner allows: shared/mail-footer.js). Email-safe: a table layout, inline styles, a hosted https logo, light colours inline with a dark-mode override in <style>.
// shared/mail.js applies it in send(), so no template can skip it; each template supplies only its content. A plain-text twin comes from frameText(). Guard: test/unit/shared/mail/mail-frame.test.js.
import {DARK, LIGHT as C} from './mail-palette.js';
export const SITE = 'https://www.jobadabra.top';
const LOGO = `${SITE}/images/logo-mark.png`;
/** Where replies go and who answers (owner, 5 Nov 2026: "Questions? Just reply to this email. It comes straight to me."; support@ is forwarded to his inbox by Cloudflare Email Routing). shared/mail.js sends REPLY_TO as Reply-To. */
export const REPLY_TO = 'support@jobadabra.top';
const ASK = 'Questions? Just reply to this email. It comes straight to me.', SIGNED = 'Igor, builder of Jobadabra · Geneva';
const PHOTO = `${SITE}/images/igor-footer.png`;   // 96 px round PNG, shown at 48 px (sharp on a phone)
export const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
export const link = (url, label) => `<a href="${esc(url)}" class="jp-link" style="color:${C.signal}">${esc(label)}</a>`;

const FONT = '-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif';
const STYLE = `<style>
@media (prefers-color-scheme: dark) {
  .jp-bg { background:${DARK.bg} !important; } .jp-card { background:${DARK.card} !important; border-color:${DARK.line} !important; }
  .jp-ink { color:${DARK.ink} !important; } .jp-muted, .jp-muted a { color:${DARK.muted} !important; } .jp-line { border-color:${DARK.line} !important; }
  .jp-link { color:${DARK.signal} !important; } .jp-sig { color:${DARK.signal} !important; } .jp-pill { background:${DARK.soft} !important; color:${DARK.softInk} !important; }
  .jp-box { background:${DARK.quiet} !important; } .jp-fit { background:${DARK.goodSoft} !important; color:${DARK.good} !important; }
}
@media only screen and (max-width: 520px) { .jp-pad { padding:18px !important; } }
</style>`;

export const button = ({label, url}) => `<p style="margin:18px 0 0"><a href="${esc(url)}" style="display:inline-block;background:${C.fill};color:${C.onFill};text-decoration:none;font-weight:600;border-radius:8px;padding:11px 18px">${esc(label)}</a></p>`;

// The job rows of a digest: title, "company · place · mode" and a fit chip. rows: [{title, company, place, mode, fit, url}].
export function jobRows(rows = []) {
  return rows.map(job => {
    const meta = [job.company, job.place, job.mode].filter(Boolean).join(' · ');
    const title = job.url ? `<a href="${esc(job.url)}" style="color:inherit;text-decoration:none">${esc(job.title)}</a>` : esc(job.title);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="jp-line" style="border-top:1px solid ${C.line}"><tr>`
      + `<td style="padding:12px 0"><b class="jp-ink" style="display:block">${title}</b>${meta ? `<span class="jp-muted" style="color:${C.muted};font-size:13px">${esc(meta)}</span>` : ''}</td>`
      + `${job.fit != null ? `<td align="right" valign="middle" style="padding:12px 0 12px 12px"><span class="jp-fit" style="font:600 12px ui-monospace,Menlo,monospace;background:${C.goodSoft};color:${C.good};border-radius:999px;padding:3px 9px">${esc(job.fit)}</span></td>` : ''}</tr></table>`;
  }).join('');
}
export const jobText = (rows = []) => rows.map(job => `- ${job.title}${[job.company, job.place, job.mode].filter(Boolean).length ? ` (${[job.company, job.place, job.mode].filter(Boolean).join(' · ')})` : ''}${job.fit != null ? ` fit ${job.fit}` : ''}${job.url ? `\n  ${job.url}` : ''}`).join('\n');

export const codeBox = code => `<p class="jp-box jp-ink" style="font:700 30px ui-monospace,Menlo,monospace;letter-spacing:.3em;background:${C.quiet};border-radius:10px;padding:14px;text-align:center;margin:8px 0 14px">${esc(code)}</p>`;

// The owner's personal footer: a round photo and a line, under the card of every mail (a table, no CSS a mail client may drop). Its text twin is frameText's "--" block.
const personalHtml = () => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:18px auto 0"><tr><td align="center">`
  + `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>`
  + `<td width="48" valign="middle" style="width:48px;padding:0 12px 0 0"><img src="${PHOTO}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border:0;border-radius:50%"></td>`
  + `<td valign="middle" style="text-align:left"><p class="jp-ink" style="margin:0;color:${C.ink};font:14px/1.45 ${FONT}">${ASK}</p>`
  + `<p class="jp-muted" style="margin:1px 0 0;color:${C.muted};font:13px/1.4 ${FONT}">${SIGNED}</p></td></tr></table></td></tr></table>`;

// html: {title, body (html), button: {label, url} | null, why, links: {stop, settings} | null, trust, download}. links null = nothing to stop (an Account mail).
// The footer is two short lines (owner, 6 Nov 2026: "Loks like essays/novels"): `why`, then the links joined by " · "; `download` adds "Don't have the app?" (news only:
// owner, 6 Nov 2026: "we shouldn't show Downlaod on user app email notifications. Of course they have the app"). `trust` links what hosted Always on stores.
const footLinks = (links, trust) => [links && ['Stop these emails', links.stop], links?.settings && ['Email settings', links.settings], trust && ['How we keep your data', `${SITE}/trust`], ['jobadabra.top', SITE]].filter(Boolean);
export function frameHtml({title, body, button: action, why, links, hero, trust = false, download = false}) {
  const foot = footLinks(links, trust).map(([label, url]) => link(url, label)).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>${STYLE}</head>`
    + `<body class="jp-bg" style="margin:0;background:${C.bg}"><table role="presentation" data-jp-frame="1" width="100%" cellpadding="0" cellspacing="0" class="jp-bg" style="background:${C.bg}"><tr><td align="center" style="padding:22px 14px">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" class="jp-card" style="width:100%;max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:12px;font:15px/1.55 ${FONT};color:${C.ink}">`
    + (hero || `<tr><td class="jp-line" style="padding:16px 22px;border-bottom:1px solid ${C.line}"><img src="${LOGO}" width="32" height="28" alt="" style="vertical-align:middle;border:0"> <b class="jp-ink" style="vertical-align:middle;margin-left:8px;font-size:15px">Jobadabra</b></td></tr>`)
    + `<tr><td class="jp-pad jp-ink" style="padding:22px">${hero ? '' : `<h1 class="jp-ink" style="margin:0 0 10px;font-size:20px;line-height:1.3">${esc(title)}</h1>`}${body}${action ? button(action) : ''}</td></tr></table>`
    + personalHtml()
    + `<p class="jp-muted" style="max-width:560px;margin:10px auto 0;color:${C.muted};font:12px/1.5 ${FONT};text-align:center">${why ? `${esc(why)}<br>` : ''}${foot}${download ? `<br>Don't have the app? ${link(`${SITE}/download`, 'Download Jobadabra')}` : ''}</p>`
    + `</td></tr></table></body></html>`;
}

export function frameText({title, body, button: action, why, links, trust = false, download = false}) {
  return [title, '', body, action ? `\n${action.label}: ${action.url}` : '', '', '--', ASK, SIGNED, '', why || null,
    ...footLinks(links, trust).map(([label, url]) => url === SITE ? SITE : `${label}: ${url}`), download ? `Don't have the app? Download Jobadabra: ${SITE}/download` : null]
    .filter(part => part !== null && part !== undefined && part !== false).join('\n').replace(/\n{3,}/g, '\n\n');
}
