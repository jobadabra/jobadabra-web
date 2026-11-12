// /admin/operations/notifications: every alert that can reach the owner, whether it is on, when, and through which channel (owner, 5 Nov 2026: "I'd like to control easily on what I want to get alerted or not").
// Three channels, each with its current bot read live from Telegram, Send test and Change bot. The same switches sit in the Notify column of Operations → Scheduled (admin/notify-cells.js).
// Store, rules and sender: shared/notify.js; the list of alerts: shared/notify-registry.js; the door for senders: api/ops-notify.js. Spec: docs/superpowers/specs/2026-11-05-ops-notifications-design.md.
import {viewer, isOwner, remember} from '../shared/auth.js';
import {esc} from '../shared/html.js';
import {ALERTS, CHANNELS, GROUPS, channelOf, effective, alertOf} from '../shared/notify-registry.js';
import {channelStatus, connect, readSettings, saveSetting, sendTest, stats as readStats} from '../shared/notify.js';
import {setJobMuted} from '../shared/job-alert.js';
import {whenWords} from '../shared/schedules-model.js';
import {NOTIFY_PATH, NOTIFY_STYLE, toggle, when, where} from './notify-cells.js';

const BACKS = /^\/admin\/operations\/(notifications|scheduled)(\?[\w=&%.-]{0,120})?$/;
const SAID = {saved: 'Saved.', tested: 'Test sent: look in the channel\'s chat.', connected: 'Bot connected. Press Send test to check it.'};
const CSS = `.nt-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.nt-top .big{font-size:18px;font-weight:700}
.nt-chip.ok{background:#12301f;color:#5fd08f}.nt-chip.warn{background:#33270f;color:#f0b45a}.nt-chip.bad{background:#3a1717;color:#f07a7a}.nt-chip.off{background:#1b2027;color:#8d949c}.nt-chip{margin-left:0}
.nt-chans{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-bottom:16px}.nt-ch{border-left-width:5px;margin:0}.nt-ch b{font-size:16px}
.nt-ch.engineering{border-left-color:#6f97ea}.nt-ch.users{border-left-color:#b386ec}.nt-ch.marketing{border-left-color:#f0a457}
.nt-ch .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:flex-start}.nt-ch details[open]{flex:1 1 100%}.nt-ch summary{list-style:none;display:inline-block}.nt-ch summary::-webkit-details-marker{display:none}
.nt-ch .nt-form{display:grid;gap:8px;margin-top:8px}.nt-ch .nt-form input[type=password],.nt-ch .nt-form input[type=text]{background:#0b0d10;color:#f4efe3;border:1px solid #262c33;border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}
.nt-ch .nt-form label{font-size:12px;color:#8d949c;display:grid;gap:3px}.nt-flash{border-left:5px solid #3fb68b;margin-bottom:14px}.nt-flash.bad{border-left-color:#e5484d}
.nt-t td,.nt-t th{padding:8px 6px}.nt-t tr.grp td{background:#1b2027;font-weight:700;font-size:13px;color:#8d949c;border-top:0}.nt-t td.nt-last{color:#8d949c;font-size:13px;white-space:nowrap}
.nt-t td:first-child{min-width:220px}.nt-off td:first-child{color:#8d949c}.nt-f{display:block}
@media (max-width:700px){main .card table.nt-t.wide{min-width:0;width:100%}.nt-t thead{display:none}.nt-t,.nt-t tbody{display:block}.nt-t tr{display:grid;grid-template-columns:1fr 1fr auto;gap:6px 8px;align-items:center;padding:10px 0;border-top:1px solid #262c33}
.nt-t tr.grp{display:block;padding:0;border:0}.nt-t td{display:block;border:0;padding:0;min-width:0}.nt-t td:nth-child(1){grid-column:1/3;min-width:0}.nt-t td:nth-child(2){grid-column:3;justify-self:end}.nt-t td:nth-child(3){grid-column:1}
.nt-t td:nth-child(4){grid-column:2/4}.nt-t td:nth-child(5){grid-column:1/4}.nt-t tr.grp td{padding:8px 6px;margin-top:10px}.nt-t .nt-sel{width:100%}.nt-t td:nth-child(4) .nt-f,.nt-t td:nth-child(3) .nt-f{display:block}}`;

/** Everything the page draws, read once: the owner's settings, the 7-day numbers and each channel's bot (live from Telegram). */
export async function load(env, fetcher = fetch, now = new Date()) {
  const [settings, stats, ...bots] = await Promise.all([readSettings(env), readStats(env, now), ...CHANNELS.map(channel => channelStatus(env, channel.id, fetcher))]);
  return {settings, stats, channels: Object.fromEntries(CHANNELS.map((channel, i) => [channel.id, bots[i]]))};
}

const chanCard = (channel, bot, rows, canEdit, now) => {
  const mine = rows.filter(row => row.mine.channel === channel.id), last = mine.map(row => row.stat?.last).filter(Boolean).sort().at(-1);
  const who = !bot.connected ? '<div class="muted">Not connected yet: create the bot with @BotFather, then press Connect bot.</div>'
    : !canEdit ? `<div>${bot.live ? '<span class="nt-chip ok">✓ connected, answers</span>' : '<span class="nt-chip warn">⚠ Telegram did not answer</span>'}</div>`
    : `<div>${esc(bot.name || 'bot')} → “${esc(bot.title || 'chat')}” ${bot.live ? '<span class="nt-chip ok">✓ answers</span>' : `<span class="nt-chip warn" title="${esc(bot.why)}">⚠ Telegram did not answer</span>`}</div>${bot.source === 'secret' ? '<div class="muted" style="font-size:12px">Set by a Worker secret; Change bot moves it here.</div>' : ''}`;
  const edit = !canEdit ? '' : `<div class="row">${bot.connected ? `<form class="nt-f" method="post" action="${NOTIFY_PATH}"><input type="hidden" name="action" value="test"><input type="hidden" name="channel" value="${channel.id}"><button class="nt-btn">Send test</button></form>` : ''}
<details><summary class="nt-btn ghost">${bot.connected ? 'Change bot' : 'Connect bot'}</summary><form class="nt-form" method="post" action="${NOTIFY_PATH}" autocomplete="off"><input type="hidden" name="action" value="connect"><input type="hidden" name="channel" value="${channel.id}">
<label>Bot token from @BotFather (kept encrypted, never shown again)<input type="password" name="token" required autocomplete="off" spellcheck="false" placeholder="123456:ABC…"></label>
<label>Chat id (leave empty: send the bot any message first, it finds the chat)<input type="text" name="chat" inputmode="numeric" autocomplete="off" placeholder="optional"></label><button class="nt-btn">Connect</button></form></details></div>`;
  return `<section class="card nt-ch ${channel.id}"><b>${channel.icon} ${esc(channel.name)}</b><div class="muted" style="font-size:12.5px;margin:2px 0 6px">${esc(channel.about)}</div>${who}${edit}
<div class="muted" style="font-size:12px;margin-top:8px">${mine.length} alert${mine.length === 1 ? '' : 's'}${mine.some(row => !row.mine.on) ? ` · ${mine.filter(row => !row.mine.on).length} off` : ''} · ${last ? `last sent ${esc(whenWords(new Date(last), now))}` : 'nothing sent yet'}</div></section>`;
};

/** The page. `data` = load(); `canEdit` = the super admin; `said` = a key of SAID after a redirect; `bad` = why the last change was refused. */
export function page(data, {canEdit = false, said = '', bad = '', now = new Date()} = {}) {
  const rows = ALERTS.map(alert => ({alert, mine: effective(alert, data.settings.get(alert.id)), stat: data.stats.get(alert.id)}));
  const on = rows.filter(row => row.mine.on).length, wired = ALERTS.filter(alert => alert.wired).length, counted = ALERTS.filter(alert => !alert.parked).length, fallback = rows.reduce((sum, row) => sum + (row.stat?.fallback || 0), 0);
  const connected = CHANNELS.filter(channel => data.channels[channel.id]?.connected).length;
  const body = GROUPS.map(([id, title]) => {
    const mine = rows.filter(row => row.alert.group === id);
    return `<tr class="grp"><td colspan="5">${esc(title)}</td></tr>${mine.map(({alert, mine: m, stat}) => `<tr class="${m.on ? '' : 'nt-off'}"><td>${esc(alert.label)}${alert.status === 'new' ? '<span class="nt-chip new">NEW</span>' : alert.status === 'later' ? '<span class="nt-chip later">LATER</span>' : ''}</td>
<td>${toggle(alert, m, NOTIFY_PATH, canEdit)}</td><td>${when(alert, m, NOTIFY_PATH, canEdit)}</td><td>${where(alert, m, NOTIFY_PATH, canEdit)}</td>
<td class="nt-last">${stat?.last ? `${esc(whenWords(new Date(stat.last), now))}${stat.week ? ` · ${stat.week} in 7 d` : ''}` : alert.wired ? 'never' : alert.parked ? `<span title="${esc(alert.parked)}">parked</span>` : 'sender not moved yet'}</td></tr>`).join('')}`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Notifications · Admin</title><link rel="icon" href="/favicon-32.png"><style>${NOTIFY_STYLE}${CSS}</style></head>
<body><main><header><h1>🔔 Notifications</h1></header>
${said && SAID[said] ? `<section class="card nt-flash" role="status">${esc(SAID[said])}</section>` : ''}${bad ? `<section class="card nt-flash bad" role="alert">${esc(bad)}</section>` : ''}
<div class="nt-top"><span class="big">${on} alerts on</span><span class="muted">· ${rows.length - on} off · ${connected} of ${CHANNELS.length} channels connected</span>
${wired < counted ? `<span class="nt-chip warn" title="A switch is saved at once and takes effect as each alert's sender moves over to the switchboard">⚠ ${wired} of ${counted} senders moved over</span>` : '<span class="nt-chip ok">✓ every sender uses the switchboard</span>'}
${fallback ? `<span class="nt-chip bad" title="A sender could not reach the switchboard and used its old bot">✕ ${fallback} sent without switchboard (7 d)</span>` : ''}</div>
<div class="nt-chans">${CHANNELS.map(channel => chanCard(channel, data.channels[channel.id] || {connected: false}, rows, canEdit, now)).join('')}</div>
<section class="card" style="overflow-x:auto"><table class="nt-t"><thead><tr><th>Alert</th><th>On</th><th>When</th><th>Channel</th><th>Last sent</th></tr></thead><tbody>${body}</tbody></table>
<p class="muted" style="font-size:12.5px;margin:10px 0 0">An alert's text never carries a name or an e-mail address: it says what happened and links to the Admin page. ${canEdit ? '' : 'Only the super admin changes these.'}</p></section></main></body></html>`;
}

// A change from a form: owner only, from this site (Origin), saved, then back to the page it came from. A bot or a test that failed answers on the spot, with the reason.
async function act(request, env, url, fetcher, now) {
  if (!await isOwner(request, env) || !env.STATS || request.headers.get('Origin') !== url.origin) return new Response('Not found', {status: 404});
  const form = await request.formData().catch(() => new FormData()), action = String(form.get('action') || ''), event = String(form.get('event') || ''), channel = String(form.get('channel') || '');
  const back = BACKS.test(String(form.get('back') || '')) ? String(form.get('back')) : NOTIFY_PATH;
  const done = said => { const [path, query = ''] = back.split('?'), q = [query, said && `said=${said}`].filter(Boolean).join('&'); return new Response(null, {status: 303, headers: {Location: q ? `${path}?${q}` : path, 'Cache-Control': 'no-store'}}); };
  const refuse = async why => html(page(await load(env, fetcher, now), {canEdit: true, bad: why, now}), 400);
  if (action === 'toggle' && alertOf(event)) return await saveSetting(env, event, {enabled: form.get('on') === '1'}, now) ? done('') : refuse('That change is not allowed.');
  if (action === 'job-toggle') return await setJobMuted(env.STATS, String(form.get('job')), form.get('on') !== '1', now) ? done('') : refuse('That change is not allowed.');
  if (action === 'mode' && alertOf(event)) return await saveSetting(env, event, {mode: String(form.get('mode'))}, now) ? done('') : refuse('That "when" is not allowed for this alert.');
  if (action === 'channel' && alertOf(event)) return await saveSetting(env, event, {channel: String(form.get('channel'))}, now) ? done('') : refuse('Unknown channel.');
  if (action === 'test' && channelOf(channel)) { const sent = await sendTest(env, channel, fetcher, now); return sent.ok ? done('tested') : refuse(`Test not sent: ${sent.why}`); }
  if (action === 'connect' && channelOf(channel)) { const linked = await connect(env, channel, form.get('token'), form.get('chat'), fetcher, now); return linked.ok ? done('connected') : refuse(linked.why); }
  return new Response('Unknown action', {status: 400});
}
const html = (text, status = 200) => new Response(text, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});

/** GET the page (any admin), POST a change (the super admin). `fetcher` and `now` are injectable for tests. */
export async function view(request, env, {fetcher = fetch, now = new Date()} = {}) {
  const who = await viewer(request, env);
  if (!who) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (request.method === 'POST') return act(request, env, url, fetcher, now);
  return html(page(await load(env, fetcher, now), {canEdit: who.role === 'superadmin', said: url.searchParams.get('said') || '', now}));
}
