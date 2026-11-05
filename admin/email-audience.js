// The list behind "who gets our product news" on /admin/growth/email (owner, 28 Oct 2026: "a view of all the email list that subscribed for the promotional emails"): every address we hold
// (accounts: trial, Always on, Pro; the waitlist in KV signup:<email>), where it came from, since when, and which news types would reach it. Full addresses: the owner only
// (the page's counts stay for every admin). Reads the same rule send() uses (shared/mail-lists.js newsRefusal). Guard: test/unit/admin/release-mail.test.js.
import {esc} from '../shared/html.js';
import {addrOf, clean, validAddress} from '../shared/mail.js';
import {NEWS, newsAnswered, newsRefusal, signupKind} from '../shared/mail-lists.js';

const REASONS = {no_tick: 'not ticked', not_confirmed: 'not confirmed', pro_only: 'Pro mail only', not_asked: 'not asked yet', unsubscribed: 'stopped', suppressed: 'bounced or complained', bad_address: 'not an address'};
const NOBODY = new Set();

// addr -> set of lists, from rows of {addr, list}.
const byAddress = rows => { const out = new Map(); for (const {addr, list} of rows) for (const one of list === 'marketing' ? NEWS : [list]) out.set(addr, (out.get(addr) || new Set()).add(one)); return out; };   // 'marketing': a stop from before the split, for both news types

// -> [{email, source: 'account' | 'waitlist' | 'both', plan, since (ISO or ''), releases, tips, launch, releasesWhy, tipsWhy}], newest first. Judged as if MARKETING_MAIL were on, so the list is true before the flag flips.
export async function audienceRows(env) {
  const by = new Map();
  const add = (email, source, since, {plan = '', confirmed = false, signup = ''} = {}) => { const key = clean(email), old = by.get(key); by.set(key, {email: key, source: old ? 'both' : source, plan: plan || old?.plan || '', since: [old?.since, since].filter(Boolean).sort()[0] || '', confirmed: confirmed || !!old?.confirmed, signup: signup || old?.signup || ''}); };
  for (const row of (await env.STATS.prepare('SELECT email, plan, created_at, email_confirmed_at FROM pro_accounts').all()).results || []) add(row.email, 'account', row.created_at, {plan: row.plan, confirmed: !!row.email_confirmed_at || row.plan === 'pro'});
  let cursor;
  do {
    const page = await env.WAITLIST.list({prefix: 'signup:', cursor});
    for (const key of page.keys) add(key.name.slice(7), 'waitlist', key.metadata?.at || '', {signup: signupKind(key.metadata?.source || 'unknown')});
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  // Two queries for every address, then each is judged in memory by send()'s own rule (Gitar on #218: a check per address made 2N+1 queries per page load).
  const stops = byAddress((await env.STATS.prepare("SELECT addr, list FROM mail_off WHERE list IN ('all', 'releases', 'tips', 'jobdigest', 'marketing')").all()).results || []);
  const yes = byAddress((await env.STATS.prepare('SELECT addr, list FROM mail_on').all().catch(() => null))?.results || []);
  const rows = [];
  for (const row of by.values()) {
    const addr = await addrOf(row.email), mine = {stops: stops.get(addr) || NOBODY, yes: yes.get(addr) || NOBODY};
    const facts = {...mine, confirmed: row.confirmed, signup: row.signup, answered: newsAnswered(mine.yes, mine.stops)};
    const bad = validAddress(row.email) ? '' : 'bad_address', releases = bad || newsRefusal('releases', facts), tips = bad || newsRefusal('tips', facts), digest = bad || newsRefusal('jobdigest', facts);
    rows.push({...row, releases: !releases, tips: !tips, jobdigest: !digest, launch: !bad && !newsRefusal('tips', facts, {waitlistToo: true}), releasesWhy: REASONS[releases] || '', tipsWhy: REASONS[tips] || '', jobdigestWhy: REASONS[digest] || ''});
  }
  return rows.sort((a, b) => b.since.localeCompare(a.since));
}

export function audienceCard(rows) {
  const count = list => rows.filter(row => row[list]).length, pill = (on, why) => `<span class="pill ${on ? 'on' : 'off'}">${on ? 'gets it' : esc(why)}</span>`;
  const body = rows.map(row => `<tr><td>${esc(row.email)}</td><td>${row.source === 'both' ? 'account + waitlist' : esc(row.source)}${row.plan ? ` · ${esc(row.plan)}` : ''}</td><td class="num">${esc(row.since.slice(0, 10))}</td><td>${pill(row.releases, row.releasesWhy)}</td><td>${pill(row.tips, row.tipsWhy)}</td><td>${pill(row.jobdigest, row.jobdigestWhy)}</td></tr>`).join('');
  return `<section class="card" style="margin-bottom:16px"><h2>Who gets news <span class="muted">· ${count('releases')} New releases, ${count('tips')} Tips and tricks, ${count('jobdigest')} Job digest, ${rows.length} addresses</span></h2>`
    + (rows.length ? `<div style="overflow-x:auto"><table><tr><th>Address</th><th>From</th><th>Since</th><th>New releases</th><th>Tips and tricks</th><th>Job digest</th></tr>${body}</table></div>` : '<p class="muted">Nobody yet.</p>')
    + '<p class="muted">Judged by the rules above, as if MARKETING_MAIL were on. Visible to the owner only.</p></section>';
}
