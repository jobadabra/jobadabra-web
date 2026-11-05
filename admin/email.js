// /admin/growth/email (owner, 26 Oct 2026: "so that we can keep track and manage this from admin also"): the switches, how much mail went out and was refused, who can still get it, the templates and the digest queue.
// Read-only; it replaces the Signups page (owner, 26 Oct 2026: merged; the old Signups address redirects here); the Pro-launch send is still POST /admin/mail/launch (admin/signups.js). Addresses never show (short hash only). Data: admin/email-data.js. Guard: tests/test_site_admin_email.js.
import {isOwner, viewer} from '../shared/auth.js';
import {DAILY_MAX} from '../shared/mail.js';
import {esc} from '../shared/html.js';
import {collect as accountsOf} from './signups.js';
import {collect, windowOf, WINDOWS} from './email-data.js';
import {previews} from './email-preview.js';
import {TEST_INBOX, testSend} from './email-test-send.js';
import {releaseView} from './release-mail-page.js';
import {audienceCard, audienceRows} from './email-audience.js';
import {mailTypesCard} from './email-types.js';
import {newestFirst} from './changelog.js';
import {latestStableVersion, releaseData} from './release-mail.js';
import {compose} from '../shared/mail.js';
import {addressChart, refusedChart, stoppedChart, templateChart} from './email-charts.js';
import {switchesCard, SWITCH_STYLE} from './email-switches.js';
import {rulesCard, RULE_STYLE} from './email-rules.js';
import {TABS_STYLE, tabOf, tabsNav} from './email-tabs.js';
import {figure, VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';

const n = value => (Number(value) || 0).toLocaleString('en-US');

const TEMPLATE_STYLE = `.tpl{min-width:0;scroll-margin-top:24px}.tpl h2 a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.tpl form{margin-top:16px}.tpl input[type=email]{box-sizing:border-box;width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid #46505d;border-radius:8px;background:#1a1f26;color:#f4efe3;font:inherit}
.tpl label{display:block;font-weight:600;margin-bottom:6px}.tpl button{min-height:44px;font:inherit;padding:10px 14px;border-radius:8px}
.tpl .personal-test{display:flex;flex-wrap:wrap;align-items:end;gap:12px}.tpl .test-address{flex:1 1 180px;min-width:0}
.tpl .personal-test button{background:#f5b54a;color:#0b0d10;border-color:#f5b54a}.tpl input:focus-visible{outline:2px solid #f5b54a;outline-offset:2px}
.test-result{padding:12px;border:1px solid currentColor;border-radius:8px;scroll-margin-top:24px;overflow-wrap:anywhere}.test-result.on{color:#4cc38a}.test-result.off{color:#ff7b70}
.template-detail iframe{height:75vh;min-height:640px}.release-list{display:flex;flex-wrap:wrap;gap:12px 24px;padding-left:20px}
@media(max-width:600px){.tpl button{width:100%}.tpl .test-address{flex-basis:100%}}`;

const templateCard = (mail, sent, notice = null, detail = false) => `<section class="card tpl${detail ? ' template-detail' : ''}" id="template-${esc(mail.name)}">
${detail ? '' : `<h2><a href="/admin/growth/email?template=${esc(mail.name)}">${esc(mail.name)}</a></h2>`}
<p class="muted">${esc(mail.list)}${mail.essential ? ' · essential' : ''}${detail ? '' : ` · sent ${n(sent)} in the window`} · ${mail.real ? (mail.version ? `Latest stable release ${esc(mail.version)}` : 'Real release preview') : 'Sample data'}</p>
${mail.error ? `<p>Cannot render: ${esc(mail.error)}</p>` : `${mail.pendingMessage ? `<p role="status">${esc(mail.pendingMessage)}</p>` : ''}<p><b>${esc(mail.subject)}</b></p><iframe sandbox title="${esc(mail.name)}" srcdoc="${esc(mail.html)}"></iframe>
${notice?.template === mail.name ? notice.html : ''}
${mail.noDraft ? '' : `<form method="post" action="/admin/growth/email"><input type="hidden" name="template" value="${esc(mail.name)}">${mail.real ? `<input type="hidden" name="release" value="${esc(mail.version)}">` : ''}${detail ? '<input type="hidden" name="detail" value="1">' : ''}<button type="submit">Send to test inbox</button></form>
<form class="personal-test" method="post" action="/admin/growth/email"><input type="hidden" name="template" value="${esc(mail.name)}"><input type="hidden" name="mine" value="1">${mail.real ? `<input type="hidden" name="release" value="${esc(mail.version)}">` : ''}${detail ? '<input type="hidden" name="detail" value="1">' : ''}<div class="test-address"><label for="test-address-${esc(mail.name)}">Your email address</label><input id="test-address-${esc(mail.name)}" type="email" name="to" placeholder="you@example.com" autocomplete="email" required></div><button type="submit">Send to my email</button></form>`}`}</section>`;

const REASONS = {off: 'Email sending is switched off or its sender is unavailable.', marketing_off: 'News sending is switched off.', no_tick: 'This address has not ticked Tips and tricks.', not_confirmed: 'This address is not confirmed yet.', not_asked: 'This address has not answered the news question in the app yet.', pro_only: 'This address joined from the app, so it gets only the Pro launch mail.', rate: 'The daily sending limit was reached. Try again tomorrow.', unsubscribed: 'This address has unsubscribed from this kind of email.', suppressed: 'This address is blocked after a bounce or complaint.', failed: 'The email provider could not send this message. Check the failure log and try again.', bad_address: 'Enter a valid email address.', no_release: 'No stable release draft is available yet.'};

// A known send result is shown inside its own template card, at the redirect's fragment target.
const noticeOf = (value, destination) => {
  const [template, result] = String(value || '').split(':');
  if (!previews().some(mail => mail.name === template) || !(result === 'sent' || REASONS[result])) return null;
  const message = result === 'sent' ? (destination === 'personal' ? 'Sent to the email address you entered.' : `Sent to the test inbox (${TEST_INBOX}).`) : `Not sent. ${REASONS[result]}`;
  return {template, html: `<p id="test-result-${esc(template)}" class="test-result ${result === 'sent' ? 'on' : 'off'}" role="${result === 'sent' ? 'status' : 'alert'}">${esc(message)}${result === 'sent' && destination !== 'personal' ? ' <a href="/admin/growth/email?tab=templates#test-inbox">View the test inbox</a>. Arrival may take a moment.' : ''}</p>`};
};

// Why (5 Nov 2026, owner): the release preview is real stable-to-stable content, never the sample release.
const realRelease = async env => {
  const version = await latestStableVersion(env);
  const row = version && await env.STATS.prepare('SELECT data,status FROM release_mail WHERE version = ?').bind(version).first();
  const data = version && await releaseData(env, {...(row ? JSON.parse(row.data) : {}), version}, {status: row?.status});
  return data ? {name: 'release', list: 'releases', real: true, version, noDraft: !row,
    pendingMessage: row ? '' : (data.sections.length ? 'The release email draft is not ready yet. This is the real changelog for the latest stable; sending is unavailable until its draft is prepared.' : 'No user-visible changes since the previous stable. No release email has been prepared.'), ...compose('release', data, {stop: '#', settings: '#'})}
    : {name: 'release', list: 'releases', real: true, error: 'No stable release draft is available yet.'};
};

const releasesOf = async env => newestFirst((await env.STATS.prepare("SELECT r.version,r.status FROM release_mail r JOIN changelog_entries c ON c.version=r.version WHERE c.channel='stable'").all()).results || []);
const releaseLinks = releases => `<section class="card"><h2>Release emails</h2><p><a href="/admin/growth/email?template=release">Review latest stable email</a></p><p class="muted">Stable releases only. Open a draft to review, test and send changes since the previous stable.</p>${releases.length ? `<ul class="release-list">${releases.map(row => `<li><a href="/admin/growth/email?release=${esc(row.version)}">Version ${esc(row.version)}</a> <span class="muted">· ${esc(row.status)}</span></li>`).join('')}</ul>` : '<p class="muted">No stable release drafts yet.</p>'}</section>`;

const templatePage = (mail, notice) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(mail.name)} email template · Admin</title><style>${TEMPLATE_STYLE}.tpl iframe{display:block;width:100%;box-sizing:border-box;border:1px solid #2c3340;border-radius:8px;background:#fff}.tpl button{cursor:pointer;border:1px solid #f5b54a;background:#1b2027;color:#f5b54a}</style></head><body><main><header><div><a href="/admin/growth/email?tab=templates">← All email</a><h1>${mail.real ? `Release email · ${esc(mail.version)}` : `${esc(mail.name)} email template`}</h1><p class="muted">${mail.real ? 'Latest stable changelog. No message is sent by viewing this page.' : 'Sample preview. For a real release draft, return to Release emails.'}</p></div></header>${templateCard(mail, 0, notice, true)}</main></body></html>`;

export function page(data, accounts = null, notice = null, audience = null, releases = [], releaseMail, tab = 'overview') {
  const tile = (label, value, note) => `<section class="card tile"><span class="muted">${label}</span><b>${n(value)}</b><span class="muted">${note}</span></section>`;
  const table = (title, head, rows, chart = '') => `<section class="card"><h2>${title}</h2>${rows.length ? figure({chart, table: `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</table>`}) : '<p class="muted">Nothing yet.</p>'}</section>`;
  const top = Math.max(1, ...data.perDay.map(row => (row.sent || 0) + (row.refused || 0)));
  const bars = data.perDay.map(row => `<i class="s" style="height:${Math.round(100 * (row.sent || 0) / top)}%" title="${esc(row.day)}: ${n(row.sent)} sent"></i><i class="r" style="height:${Math.round(100 * (row.refused || 0) / top)}%" title="${esc(row.day)}: ${n(row.refused)} refused"></i>`).join('');
  const windows = WINDOWS.map(d => d === data.days ? `<b>${d} days</b>` : `<a href="/admin/growth/email?tab=overview&days=${d}">${d}</a>`).join(' · ');
  const panels = {
    overview: `<div class="tiles">${tile('Sent', data.sent, `last ${data.days} days`)}${tile('Not sent', data.notSent, 'refused before sending')}${tile('Failed', data.failed, 'the provider said no')}${tile('Bounces and complaints', data.stopped, 'addresses stopped, all time')}${tile('Held for the digest', data.held.items, `${n(data.held.accounts)} accounts${data.held.oldest ? ` · oldest ${esc(data.held.oldest.slice(0, 16).replace('T', ' '))}` : ''}`)}</div>
<section class="card" style="margin-bottom:16px"><h2>Per day</h2><div class="days" role="img" aria-label="Mail per day">${bars}</div><span class="muted">orange = sent, red = not sent</span></section>
<div class="pair">${table('By template', ['Template', 'Sent', 'Not sent', 'Last sent'], data.byTemplate.map(r => [esc(r.template), n(r.sent), n(r.refused), esc((r.last || '').slice(0, 16).replace('T', ' '))]), templateChart(data.byTemplate))}
${table('Why mail was not sent', ['Reason', 'Mails'], data.refused.map(r => [esc(r.reason), n(r.n)]), refusedChart(data.refused))}</div>
${table('Last 10 refusals and failures', ['When (UTC)', 'Address (hash)', 'Template', 'Why'], data.recent.map(r => [esc(r.at.slice(0, 16).replace('T', ' ')), `<code>${esc(r.addr)}</code>`, esc(r.template), esc(r.status)]))}`,
    settings: `${switchesCard(data.switches, data.confirm, `${n(data.today)} of ${n(data.dayMax)} sent in the last 24 h · ${DAILY_MAX} a day per address (tests aside) · a press takes effect within seconds; "as deployed" is the Cloudflare value`)}
${rulesCard(data.rules || [], data.byTemplate)}
${mailTypesCard(data.dayMax, n)}`,
    people: `${accounts ? `<div class="tiles">${tile('Trial accounts', accounts.trial, 'gave an address')}${tile('Confirmed', accounts.confirmed, 'clicked the first mail')}${tile('Unconfirmed', accounts.unconfirmed, 'follow up')}${tile('Always on paused', accounts.paused, 'hosted schedule paused')}${tile('Converted to Pro', accounts.converted, 'trial accounts that paid')}</div>` : ''}
<div class="pair">${table('Addresses', ['Group', 'Accounts'], [['Confirmed', n(data.confirmed)], ['Unconfirmed', n(data.unconfirmed)], ['Service', n(data.types.service)], ['New releases', n(data.types.releases)], ['Tips and tricks', n(data.types.tips)], ['Job digest', n(data.types.jobdigest)]], addressChart([['Confirmed', data.confirmed], ['Unconfirmed', data.unconfirmed], ['Service', data.types.service], ['New releases', data.types.releases], ['Tips and tricks', data.types.tips], ['Job digest', data.types.jobdigest]]))}
${table('Stopped (all time)', ['Reason', 'List', 'Addresses'], data.offReasons.map(r => [esc(r.reason), esc(r.list), n(r.n)]), stoppedChart(data.offReasons))}</div>
${audience ? audienceCard(audience) : ''}`,
    releases: releaseLinks(releases),
    templates: `<h2>Email previews <span class="muted">(real release content; other templates use samples)</span></h2><p class="muted">"Send to test inbox" mails only <code>${esc(TEST_INBOX)}</code> through the real sender, as a test: outside the per-address cap, inside the daily total; it needs the MAIL switch on.</p>${data.testMail.length ? `<section class="card" id="test-inbox"><h2>Arrived in the test inbox (7 days)</h2><table>${data.testMail.map(m => `<tr><td>${esc(m.received_at.slice(0, 16).replace('T', ' '))}</td><td>${esc(m.to_addr)}</td><td>${esc(m.subject)}</td></tr>`).join('')}</table></section>` : '<section class="card" id="test-inbox"><h2>Test inbox</h2><p class="muted">No received copies yet. A successful send may take a moment to arrive.</p></section>'}<div class="pair tpls">${previews().map(mail => templateCard(mail.name === 'release' && releaseMail ? releaseMail : mail, data.byTemplate.find(r => r.template === mail.name)?.sent || 0, notice)).join('')}</div>`,
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>E-mail · Admin</title>
<style>${SWITCH_STYLE}${RULE_STYLE}${TABS_STYLE}.tpl form{margin-top:10px}.tpl button{font:inherit;font-size:13px;color:#f5b54a;background:#1b2027;border:1px solid #f5b54a;border-radius:6px;padding:5px 12px;cursor:pointer}.tpl button:hover{background:#262c33}.tpl button:focus-visible{outline:2px solid #f5b54a;outline-offset:2px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}.tile b{display:block;font-size:30px;margin:4px 0}h2{margin:0 0 8px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:16px}
.pill{display:inline-block;padding:1px 10px;border-radius:99px;border:1px solid currentColor;font-size:13px}.pill.on{color:#4cc38a}.pill.off{color:#ff7b70}.tpl iframe{width:100%;height:540px;border:1px solid #2c3340;border-radius:8px;background:#fff}.days{display:flex;align-items:flex-end;gap:2px;height:80px}.days i{flex:1;min-width:2px;border-radius:2px 2px 0 0}.days .s{background:#ff8a4c}.days .r{background:#ff7b70;opacity:.7}${TEMPLATE_STYLE}${VIZ_STYLE}</style></head><body><main>
<header><h1>✉️ E-mail</h1>${tab === 'overview' ? `<span class="muted">Last ${windows}</span>` : ''}</header>${tabsNav(tab, data.days)}
${panels[tab]}
</main>${VIZ_TOOLTIP}</body></html>`;
}

export async function view(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.has('release')) return releaseView(request, env);
  if (request.method === 'POST') return testSend(request, env);
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const notice = noticeOf(url.searchParams.get('test'), url.searchParams.get('destination'));
  const headers = {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
  if (url.searchParams.get('template') === 'release') {
    const version = await latestStableVersion(env);
    if (!version) return new Response('No stable release draft is available yet.', {status: 404});
    const row = await env.STATS.prepare('SELECT 1 AS x FROM release_mail WHERE version = ?').bind(version).first();
    return row ? new Response(null, {status: 302, headers: {Location: `/admin/growth/email?release=${version}`, 'Cache-Control': 'no-store'}}) : new Response(templatePage(await realRelease(env), notice), {headers});
  }
  if (url.searchParams.has('template')) {
    const mail = previews().find(mail => mail.name === url.searchParams.get('template'));
    return mail ? new Response(templatePage(mail, notice), {headers}) : new Response('Unknown template.', {status: 404});
  }
  const tab = tabOf(url.searchParams), data = await collect(env, {days: windowOf(url.searchParams.get('days'))});
  data.confirm = url.searchParams.get('confirm') || '';
  // Why (5 Nov 2026, owner: tabs): a tab loads only what it draws; the address list (a KV listing) and the release drafts are not read for the other tabs.
  const people = tab === 'people', owner = people && await isOwner(request, env);
  return new Response(page(data, people ? await accountsOf(env) : null, notice, owner ? await audienceRows(env) : null, tab === 'releases' ? await releasesOf(env) : [], tab === 'templates' ? await realRelease(env) : undefined, tab), {headers});
}
