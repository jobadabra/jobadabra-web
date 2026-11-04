// The list behind "who gets our product news" on /admin/growth/email (owner, 28 Oct 2026: "a view of all the email list that subscribed for the promotional emails"): every address we hold
// (accounts: trial, Always on, Pro; the waitlist in KV signup:<email>), where it came from, since when, and whether the next product mail would reach it. Full addresses: the owner only
// (the page's counts stay for every admin). Reads the same gate send() uses (shared/mail.js mailAllowed). Guard: test/unit/admin/release-mail.test.js.
import {esc} from '../shared/html.js';
import {addrOf, clean, validAddress} from '../shared/mail.js';

const REASONS = {unsubscribed: 'stopped news', suppressed: 'bounced or complained', bad_address: 'not an address'};

// -> [{email, source: 'account' | 'waitlist' | 'both', plan, since (ISO or ''), gets, why}], newest first. Product news judged as if MARKETING_MAIL were on, so the list is true before the flag flips.
export async function audienceRows(env) {
  const by = new Map();
  const add = (email, source, since, plan = '') => { const key = clean(email), old = by.get(key); by.set(key, {email: key, source: old ? 'both' : source, plan: plan || old?.plan || '', since: [old?.since, since].filter(Boolean).sort()[0] || ''}); };
  for (const row of (await env.STATS.prepare('SELECT email, plan, created_at FROM pro_accounts').all()).results || []) add(row.email, 'account', row.created_at, row.plan);
  let cursor;
  do {
    const page = await env.WAITLIST.list({prefix: 'signup:', cursor});
    for (const key of page.keys) add(key.name.slice(7), 'waitlist', key.metadata?.at || '');
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  // One query for every stopped address, then each address is judged in memory (Gitar on #218: the per-address mailAllowed made 2N+1 queries per page load). Same rule as shared/mail.js mailAllowed for the marketing list.
  const off = new Map();
  for (const r of (await env.STATS.prepare("SELECT addr, list FROM mail_off WHERE list IN ('all', 'marketing')").all()).results || []) if (!off.has(r.addr) || r.list === 'all') off.set(r.addr, r.list);
  const rows = [];
  for (const row of by.values()) {
    const reason = !validAddress(row.email) ? 'bad_address' : ({all: 'suppressed', marketing: 'unsubscribed'})[off.get(await addrOf(row.email))] || '';
    rows.push({...row, gets: !reason, why: reason ? REASONS[reason] : ''});
  }
  return rows.sort((a, b) => b.since.localeCompare(a.since));
}

export function audienceCard(rows) {
  const gets = rows.filter(row => row.gets).length;
  const body = rows.map(row => `<tr><td>${esc(row.email)}</td><td>${row.source === 'both' ? 'account + waitlist' : esc(row.source)}${row.plan ? ` · ${esc(row.plan)}` : ''}</td><td class="num">${esc(row.since.slice(0, 10))}</td><td><span class="pill ${row.gets ? 'on' : 'off'}">${row.gets ? 'gets news' : esc(row.why)}</span></td></tr>`).join('');
  return `<section class="card" style="margin-bottom:16px"><h2>Product news list <span class="muted">· ${gets} get it, ${rows.length - gets} stopped</span></h2>`
    + (rows.length ? `<table><tr><th>Address</th><th>From</th><th>Since</th><th>Product news</th></tr>${body}</table>` : '<p class="muted">Nobody yet.</p>')
    + '<p class="muted">Everyone with an account or on the waitlist who has not stopped product news. Visible to the owner only.</p></section>';
}
