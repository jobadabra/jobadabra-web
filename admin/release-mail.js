// The "What's new" mail at a stable release (spec docs/superpowers/specs/2026-10-28-release-mail-design.md). The stable promotion calls POST /release-mail/draft {version}
// (Bearer SELFHEAL_PUBLISH_KEY): the site builds a draft from that version's What's new entry (changelog_entries) and keeps it in release_mail, once per version. The owner reviews it
// (POST /admin/mail/release?version=X, Bearer: counts and shows the draft; &headline=... edits it; &send=1 sends it). It goes to every address we hold that has not turned product news off
// (shared/mail.js mailAllowed does the check per address), and a version is claimed for sending once, so a second click or a second promotion mails nobody twice. Guard: test/unit/admin/release-mail.test.js.
import {equal} from '../shared/guard.js';
import {isOwner} from '../shared/auth.js';
import {send, validAddress, clean} from '../shared/mail.js';
import {tellOwner} from './ai-refusal.js';
import {SITE} from '../shared/mail-frame.js';

const VERSION = /^\d+\.\d+\.\d+$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Why (5 Nov 2026, owner): release emails mirror the changelog, including fixes.
const KINDS = ['features', 'improvements', 'fixes'];
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const notFound = () => new Response('Not found', {status: 404});

/** Builds the complete release email from changelog groups, preserving each change's kind. */
export function dataFrom({version, date, groups = []}) {
  const items = KINDS.flatMap(kind => groups.filter(group => group.kind === kind).flatMap(group => (group.items || []).map(item => ({...item, kind}))));
  if (!items.length) return null;
  const [year, month] = String(date || '').split('-').map(Number);
  return {version, month: `${MONTHS[(month || 1) - 1]} ${year}`, headline: items[0].text.replace(/\.$/, ''), sections: items.map(item => ({kind: item.kind, title: item.lead, text: item.text})), updateUrl: `${SITE}/download`};
}

/** Reads legacy drafts through the current changelog shape without writing or sending anything. */
export async function releaseData(env, data) {
  if (data.sections?.length && data.sections.every(section => section.kind)) return data;
  const row = await env.STATS.prepare('SELECT version, date, body FROM changelog_entries WHERE version = ? AND hidden = 0').bind(data.version).first();
  const fresh = row && dataFrom({version: row.version, date: row.date, groups: JSON.parse(row.body)});
  if (!fresh) return data;
  return {...data, sections: fresh.sections.map(section => ({...section, ...data.sections?.find(saved => saved.title === section.title), kind: section.kind}))};
}

// Everyone we hold an address for: accounts (trial, Always on, Pro) and the waitlist (KV signup:<email>), once each.
export async function audience(env) {
  const out = new Map();
  for (const {email} of (await env.STATS.prepare('SELECT email FROM pro_accounts').all()).results || []) out.set(clean(email), true);
  let cursor;
  do {
    const page = await env.WAITLIST.list({prefix: 'signup:', cursor});
    for (const key of page.keys) out.set(clean(key.name.slice(7)), true);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return [...out.keys()].filter(validAddress);
}

// Called by the promotion: drafts the version once. -> {drafted} | {exists} | {empty: nothing a user would notice}
export async function draft(env, version, now = new Date(), {fetch: doFetch} = {}) {
  if (!VERSION.test(version || '')) return {error: 'bad version'};
  if (await env.STATS.prepare('SELECT 1 AS x FROM release_mail WHERE version = ?').bind(version).first()) return {exists: true};
  const row = await env.STATS.prepare('SELECT version, date, body FROM changelog_entries WHERE version = ? AND hidden = 0').bind(version).first();
  const data = row && dataFrom({version, date: row.date, groups: JSON.parse(row.body)});
  if (!data) return {empty: true};
  const made = await env.STATS.prepare('INSERT INTO release_mail (version, data, created_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING').bind(version, JSON.stringify(data), now.toISOString()).run();
  // Why (28 Oct 2026, owner: "I should get a telegram notification when a new release whats new email draft is prepared. With a link for me to open and check the email content and then ship it"): once, when the row is new.
  // Why (28 Oct 2026, mac-27): the site Worker has no CI-alerts or build-log bot, so the ping uses the owner-only Brain bot it already has (BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, api/brain.js); no new secret.
  const bot = {BUILDLOG_TELEGRAM_TOKEN: env.BUILDLOG_TELEGRAM_TOKEN || env.BRAIN_BOT_TOKEN, BUILDLOG_TELEGRAM_CHAT: env.BUILDLOG_TELEGRAM_CHAT || env.BRAIN_CHAT_ID};
  if (made.meta?.changes) {
    const told = await tellOwner(`✉️ What's new mail for ${version} is ready: "${data.headline}"\nCheck it and send it: ${SITE}/admin/growth/email?release=${version}`, {env: {...env, ...bot}, ...(doFetch && {fetch: doFetch})}).catch(error => ({skipped: error.message}));
    if (!told.sent) console.error(`release mail ${version}: owner not told (${told.skipped})`);
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
// Sends the draft to everyone not stopped. The claim (draft -> sending) happens first and once, so no second run can start; a run that dies halfway is finished by hand (status shows 'sending').
export async function sendAll(env, version, {now = new Date()} = {}) {
  const claim = await env.STATS.prepare("UPDATE release_mail SET status = 'sending' WHERE version = ? AND status = 'draft'").bind(version).run();
  if (!claim.meta?.changes) return {refused: 'not a draft'};
  const row = await env.STATS.prepare('SELECT data FROM release_mail WHERE version = ?').bind(version).first();
  const data = await releaseData(env, JSON.parse(row.data));
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
  const data = await releaseData(env, JSON.parse(row.data)), headline = url.searchParams.get('headline');
  if (headline && row.status === 'draft') {
    data.intro = headline.slice(0, 120); data.headline = data.intro;
    await env.STATS.prepare('UPDATE release_mail SET data = ? WHERE version = ?').bind(JSON.stringify(data), version).run();
  }
  if (url.searchParams.get('send') === '1') return env.MARKETING_MAIL === 'on' ? json(await sendAll(env, version)) : json({off: true}, 409);
  return json({status: row.status, sent: row.sent_count, headline: data.headline, sections: data.sections.map(section => section.title), audience: (await audience(env)).length});
}
