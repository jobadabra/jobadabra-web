// The controls of one alert, drawn the same on Operations → Notifications (a table row) and Operations → Scheduled (the Notify column): they are the SAME setting
// (owner, 5 Nov 2026: "a column in the scheduled jobs table … and other alerts not tied to a job"). Each control is a small POST form to /admin/operations/notifications
// (admin/notifications.js), which saves it and sends the owner back to `back`. Only the super admin gets buttons; an invited admin reads the state as words.
import {esc} from '../shared/html.js';
import {MODES, channelOf, CHANNELS} from '../shared/notify-registry.js';

export const NOTIFY_PATH = '/admin/operations/notifications';
export const NOTIFY_STYLE = `.nt-f{display:inline;margin:0}.nt-tg{width:36px;height:20px;border-radius:999px;border:1px solid #3a424b;background:#1b2027;position:relative;padding:0;cursor:pointer;vertical-align:middle}
.nt-tg::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#8d949c;transition:left .12s}.nt-tg[aria-pressed=true]{background:#3fb68b;border-color:#3fb68b}.nt-tg[aria-pressed=true]::after{left:18px;background:#fff}
.nt-tg:focus-visible,.nt-sel:focus-visible,.nt-btn:focus-visible{outline:2px solid #f5b54a;outline-offset:2px}.nt-tg[disabled]{cursor:default;opacity:.7}
.nt-sel{display:inline-block;box-sizing:border-box;width:14.5em;height:30px;background:#14181d;color:#f4efe3;border:1px solid #262c33;border-radius:8px;padding:3px 8px;font:inherit;font-size:13px;line-height:22px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nt-sel:disabled{opacity:.65;cursor:default}
.nt-btn{display:inline-block;border:0;border-radius:8px;padding:5px 11px;font:inherit;font-size:13px;font-weight:700;background:#f5b54a;color:#0b0d10;cursor:pointer}.nt-btn.ghost{background:#1b2027;color:#f4efe3;border:1px solid #262c33}
.nt-chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-left:6px;white-space:nowrap;vertical-align:middle}.nt-chip.new{background:#16243f;color:#86a9f5}.nt-chip.later{background:#1b2027;color:#8d949c}
.nt-cell{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:center;margin-bottom:4px}.nt-cell .small{white-space:nowrap}.nt-cell .muted{flex:1 1 100%}`;

const submit = 'this.form.requestSubmit?this.form.requestSubmit():this.form.submit()';
const hidden = (fields) => Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join('');
const form = (fields, inner) => `<form class="nt-f" method="post" action="${NOTIFY_PATH}">${hidden(fields)}${inner}</form>`;

/** The on/off switch of one alert. `mine` = effective(alert, saved). */
export function toggle(alert, mine, back, canEdit) {
  const name = alert.label.replace(/^\S+\s/, '');
  const button = `<button type="submit" class="nt-tg" aria-pressed="${mine.on}" aria-label="${esc(`${name}: ${mine.on ? 'on' : 'off'}`)}" title="${mine.on ? 'On: press to turn off' : 'Off: press to turn on'}"${canEdit ? '' : ' disabled'}></button>`;
  return canEdit ? form({action: 'toggle', event: alert.id, on: mine.on ? '0' : '1', back}, button) : button;
}
// One control, one size (owner, 5 Nov 2026: "use one control at one size everywhere"): "When" and "Channel" are always a menu-shaped box; one that cannot change (a single mode, or a viewer who may not edit) is the same box, disabled.
function pick(alert, field, label, options, current, back, canEdit) {
  const menu = disabled => `<select class="nt-sel" name="${field}" aria-label="${esc(label)}"${disabled ? ' disabled' : ` onchange="${submit}"`}>${options.map(([value, text]) => `<option value="${value}"${value === current ? ' selected' : ''}>${text}</option>`).join('')}</select>`;
  if (!canEdit || options.length < 2) return menu(true);   // the same box, switched off: a single "when", or a viewer who may not change it
  return form({action: field, event: alert.id, back}, `${menu(false)}<noscript><button class="nt-btn ghost">Save</button></noscript>`);
}
/** The "when" of one alert. */
export const when = (alert, mine, back, canEdit) => pick(alert, 'mode', `${alert.label}: when`, alert.modes.map(mode => [mode, esc(MODES[mode])]), mine.mode, back, canEdit);
/** The channel of one alert: the three channels. */
export const where = (alert, mine, back, canEdit) => pick(alert, 'channel', `${alert.label}: channel`, CHANNELS.map(channel => [channel.id, `${channel.icon} ${esc(channel.name)}`]), mine.channel, back, canEdit);
/** What the Notify column of a scheduled job shows: its alerts, each as switch · when · channel icon; "sends nothing" when the registry lists none for it. */
export function jobCell(alerts, resolve, back, canEdit) {
  if (!alerts.length) return '<span class="muted">sends nothing</span>';
  return alerts.map(alert => { const mine = resolve(alert); return `<div class="nt-cell" title="${esc(alert.label)}">${toggle(alert, mine, back, canEdit)}<span class="small">${mine.on ? `${esc(MODES[mine.mode])} · ${channelOf(mine.channel).icon}` : 'Off'}</span>${alerts.length > 1 ? `<span class="muted small">${esc(alert.label.replace(/^\S+\s/, '').slice(0, 34))}</span>` : ''}</div>`; }).join('');
}
