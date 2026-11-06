// The "What's new" mail at a stable release (spec docs/superpowers/specs/2026-10-28-release-mail-design.md). The stable promotion calls POST /release-mail/draft {version}
// (Bearer SELFHEAL_PUBLISH_KEY): the site builds a draft from changelog entries since the previous stable through that version and keeps it in release_mail, once per version. The owner reviews it
// (POST /admin/mail/release?version=X, Bearer: counts and shows the draft; &headline=... edits it; &send=1 sends it). It goes to every address with a yes (a tick or the waitlist: shared/mail.js saidYes) that has not turned product news off
// (shared/mail.js mailAllowed does the check per address), and a version is claimed for sending once, so a second click or a second promotion mails nobody twice. Guard: test/unit/admin/release-mail.test.js.
import {equal} from '../shared/guard.js';
import {isOwner} from '../shared/auth.js';
import {send} from '../shared/mail.js';
import {ruleRefusal} from '../shared/mail-registry.js';
import {alertOwner} from '../shared/notify-send.js';
import {SITE} from '../shared/mail-frame.js';
import {newestFirst} from './changelog.js';
import {audienceRows} from './email-audience.js';

const VERSION = /^\d+\.\d+\.\d+$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Why (5 Nov 2026, owner): release emails mirror the changelog, including fixes.
const KINDS = ['features', 'improvements', 'fixes'];
const monthOf = date => { const [year, month] = String(date || '').split('-').map(Number); return `${MONTHS[(month || 1) - 1]} ${year}`; };
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const notFound = () => new Response('Not found', {status: 404});

/** Builds the complete release email from changelog groups, preserving each change's kind. */
export function dataFrom({version, date, groups = []}) {
  const items = KINDS.flatMap(kind => groups.filter(group => group.kind === kind).flatMap(group => (group.items || []).map(item => ({...item, kind}))));
  if (!items.length) return null;
  return {version, month: monthOf(date), headline: items[0].text.replace(/\.$/, ''), sections: items.map(item => ({kind: item.kind, title: item.lead, text: item.text})), updateUrl: `${SITE}/download`};
}

/** Selects the latest published stable changelog version using numeric version order. */
export async function latestStableVersion(env) {
  const {results = []} = await env.STATS.prepare("SELECT version FROM changelog_entries WHERE channel = 'stable'").all();
  return newestFirst(results.filter(row => VERSION.test(row.version)))[0]?.version || null;
}

/** Builds a stable-to-stable window; hidden stable releases still bound the interval. */
async function stableWindow(env, version) {
  const {results = []} = await env.STATS.prepare('SELECT version, date, channel, hidden, body FROM changelog_entries').all();
  const ordered = newestFirst(results.filter(row => VERSION.test(row.version) && ['stable', 'beta'].includes(row.channel)));
  const at = ordered.findIndex(row => row.version === version);
  if (at < 0 || ordered[at].channel !== 'stable') return null;
  const previous = ordered.findIndex((row, index) => index > at && row.channel === 'stable');
  const between = ordered.slice(at, previous < 0 ? undefined : previous).reverse();
  const seen = new Set(), groups = [];
  for (const row of between.filter(row => !row.hidden)) for (const group of JSON.parse(row.body)) {
    const items = (group.items || []).filter(item => {
      const key = JSON.stringify([group.kind, item.lead.trim(), item.text.trim()]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (items.length) groups.push({...group, items});
  }
  return {...ordered[at], groups, previousStable: previous < 0 ? null : ordered[previous].version};
}

/** Uses the same stable window for preview, test and broadcast, including existing drafts. */
export async function releaseData(env, data, {status = 'draft'} = {}) {
  const window = await stableWindow(env, data.version);
  if (!window) return null;
  if (status === 'sending' || status === 'sent') return data;
  const fresh = dataFrom(window);
  return {...data, ...fresh, version: window.version, month: fresh?.month || monthOf(window.date), previousStable: window.previousStable,
    sections: (fresh?.sections || []).map(section => ({...data.sections?.find(saved => saved.title === section.title && saved.text === section.text), ...section}))};
}

// Everyone What's new reaches (shared/mail-lists.js), once each. send() judges each address again at sending.
export const audience = async env => (await audienceRows(env)).filter(row => row.releases).map(row => row.email);

// Called by the promotion: only a stable version may draft its complete stable-to-stable window once. -> {drafted} | {exists} | {empty: nothing a user would notice}
export async function draft(env, version, now = new Date(), {fetch: doFetch} = {}) {
  if (!VERSION.test(version || '')) return {error: 'bad version'};
  const data = await releaseData(env, {version});
  if (!data) return {refused: 'not stable'};
  if (await env.STATS.prepare('SELECT 1 AS x FROM release_mail WHERE version = ?').bind(version).first()) return {exists: true};
  if (!data.sections.length) return {empty: true};
  const made = await env.STATS.prepare('INSERT INTO release_mail (version, data, created_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING').bind(version, JSON.stringify(data), now.toISOString()).run();
  // Why (28 Oct 2026, owner: "I should get a telegram notification when a new release whats new email draft is prepared. With a link for me to open and check the email content and then ship it"): once, when the row is new.
  // Why (28 Oct 2026, mac-27; 5 Nov 2026, nt 2/4): the switchboard sends it (Marketing & Sales channel); until that bot is connected, or if it cannot deliver, the owner-only Brain bot the Worker already has (api/brain.js) as before.
  const token = env.BUILDLOG_TELEGRAM_TOKEN || env.BRAIN_BOT_TOKEN, chat = env.BUILDLOG_TELEGRAM_CHAT || env.BRAIN_CHAT_ID;
  if (made.meta?.changes) {
    const told = await alertOwner(env, 'release-mail-draft', {text: `✉️ What's new mail for ${version} is ready: "${data.headline}"`, link: `${SITE}/admin/growth/email?release=${version}`,
      legacy: token && chat ? {token, chat} : null, ...(doFetch && {fetcher: doFetch})}).catch(error => ({sent: false, why: error.message}));
    if (!told.sent && told.via !== 'switchboard') console.error(`release mail ${version}: owner not told (${told.why})`);
  }
  return {drafted: true};
}

export async function ingest(request, env) {
  const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (request.method !== 'POST' || !env.SELFHEAL_PUBLISH_KEY || !equal(key, env.SELFHEAL_PUBLISH_KEY)) return notFound();
  const body = await request.json().catch(() => ({}));
  return json(await draft(env, String(body.version || '')));
}

// TODO(AI): send in batches from a queue once the audience passes the Worker's subrequest limit (28 Oct 2026).
// Sends only a stable release to the audience, less the stopped. Eligibility and content are checked before the one-time claim (draft -> sending), so no second run can start; a run that dies halfway is finished by hand (status shows 'sending').
export async function sendAll(env, version, {now = new Date()} = {}) {
  const row = await env.STATS.prepare('SELECT data FROM release_mail WHERE version = ?').bind(version).first();
  if (!row) return {refused: 'not a draft'};
  const data = await releaseData(env, {...JSON.parse(row.data), version});
  if (!data) return {refused: 'not stable'};
  if (!data.sections.length) return {refused: 'no changes'};
  // Why (review of hr-29): the claim below spends the draft for good, so a stopped (or unreadable) rule must refuse before it, or the release could never be sent once turned back on.
  const ruled = await ruleRefusal(env, 'release');
  if (ruled) return {refused: ruled === 'rule_off' ? 'stopped in Admin → E-mail → Mails' : 'the mail rules could not be read; try again'};
  const claim = await env.STATS.prepare("UPDATE release_mail SET status = 'sending', data = ? WHERE version = ? AND status = 'draft'").bind(JSON.stringify(data), version).run();
  if (!claim.meta?.changes) return {refused: 'not a draft'};
  let sent = 0, skipped = 0;
  for (const email of await audience(env)) {
    const result = await send(env, 'release', email, {...data, name: ''}, {now});
    if (result.ok) sent++; else skipped++;
  }
  await env.STATS.prepare("UPDATE release_mail SET status = 'sent', sent_at = ?, sent_count = ? WHERE version = ?").bind(now.toISOString(), sent, version).run();
  return {sent, skipped};
}

// POST /admin/mail/release?version=X[&headline=...][&send=1] (Bearer, owner). Needs MARKETING_MAIL = "on" to send; without send=1 it shows the draft and the audience size.
export async function releaseRoute(request, env) {
  if (request.method !== 'POST' || !(await isOwner(request, env)) || !(request.headers.get('Authorization') || '').startsWith('Bearer ')) return notFound();
  const url = new URL(request.url), version = url.searchParams.get('version') || '';
  const row = await env.STATS.prepare('SELECT status, data, sent_count FROM release_mail WHERE version = ?').bind(version).first();
  if (!row) return json({error: 'no draft for this version'}, 404);
  const data = await releaseData(env, {...JSON.parse(row.data), version}, {status: row.status}), headline = url.searchParams.get('headline');
  if (!data) return json({refused: 'not stable'}, 409);
  if (headline && row.status === 'draft') {
    data.intro = headline.slice(0, 120); data.headline = data.intro;
    await env.STATS.prepare('UPDATE release_mail SET data = ? WHERE version = ?').bind(JSON.stringify(data), version).run();
  }
  if (url.searchParams.get('send') === '1') return env.MARKETING_MAIL === 'on' ? json(await sendAll(env, version)) : json({off: true}, 409);
  return json({status: row.status, sent: row.sent_count, headline: data.headline, sections: data.sections.map(section => section.title), audience: (await audience(env)).length});
}
