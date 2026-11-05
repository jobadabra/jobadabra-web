// The three types of mail and who gets each (owner, 5 Nov 2026: "we should not treat all the emails as one box"). This file is the one owner of the rules: shared/mail.js sends by them,
// api/account-email.js and api/mail-settings.js show them, admin/email-audience.js counts them, and Admin → E-mail prints MAIL_TYPES. Guard: test/unit/shared/mail/mail-lists.test.js.
// Design: an address has at most one stored answer per news type: a yes (mail_on) or a stop (mail_off). No row means no answer yet, which is how a default is told from a choice.

export const NEWS = ['releases', 'tips'];

/** The agreed rules in the owner's words, as Admin → E-mail shows them. */
export const MAIL_TYPES = [
  {id: 'service', name: 'Service', carries: 'Matches, digest, sign-in codes, trial and account notices', starts: 'On', who: 'Everyone with an address'},
  {id: 'releases', name: 'New releases', carries: 'The "What\'s new" mail', starts: 'On', who: 'Confirmed addresses, Pro accounts and website waitlist signups, until they stop it'},
  {id: 'tips', name: 'Tips and tricks', carries: 'Tips, and the Pro launch offer', starts: 'Off', who: 'Only a real tick. The Pro launch mail also goes to every waitlist signup'},
];

/** What a waitlist entry's source allows: 'news' saw the wording that names release mails; 'pro' only the Pro mail. Why (owner, 5 Nov 2026): the app's dialog still says "Nothing else". */
export const signupKind = source => (source === 'web' || source === 'app-news' ? 'news' : source ? 'pro' : '');

const stopped = (facts, list) => facts.stops.has(list) || facts.stops.has('all');
const known = facts => facts.confirmed || facts.signup === 'news';

/** The answer a box shows for `list`: the site's stored answer, or the type's default. */
export const newsAnswer = (list, facts) => !stopped(facts, list) && (facts.yes.has(list) || (list === 'releases' && known(facts)));

/**
 * Why `list` will not reach this address, or '' when it will. `waitlistToo`: a mail every waitlist signup asked for (the Pro launch).
 * Why (owner, 5 Nov 2026: "this should be on by default. Only "Tips and tricks" should be disabled by default"; "After confirming"): an unconfirmed address may be a stranger's, so no news type reaches it.
 */
export function newsRefusal(list, facts, {waitlistToo = false} = {}) {
  if (stopped(facts, list)) return facts.stops.has('all') ? 'suppressed' : 'unsubscribed';
  if (waitlistToo && facts.signup) return '';
  if (list === 'tips' && !facts.yes.has('tips')) return 'no_tick';
  if (known(facts)) return '';
  return facts.signup ? 'pro_only' : 'not_confirmed';
}

/** What the site holds for an address digest; `email` (lower-case, or null) finds its waitlist signup. -> {stops, yes, confirmed, signup, answered} */
export async function newsFacts(env, addr, email) {
  const stops = new Set(((await env.STATS.prepare("SELECT list FROM mail_off WHERE addr = ? AND list IN ('all', 'releases', 'tips', 'marketing')").bind(addr).all()).results || []).map(row => row.list));
  // Why (review of #436): a failed migration only warns (site.yml), so a stop made under the old single list must still hold, for both news types.
  if (stops.delete('marketing')) for (const list of NEWS) stops.add(list);
  // Why (5 Nov 2026): a failed migration only warns (site.yml). Without mail_on nobody has a stored yes, and every stop is still read above, so this can only send less.
  const yes = new Set(((await env.STATS.prepare('SELECT list FROM mail_on WHERE addr = ?').bind(addr).all().catch(() => null))?.results || []).map(row => row.list));
  const account = await env.STATS.prepare('SELECT email_confirmed_at, plan FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  const entry = email ? await env.WAITLIST?.get(`signup:${email}`) : null;
  let source = '';
  try { source = entry ? JSON.parse(entry).source || 'unknown' : ''; } catch { source = 'unknown'; }
  return {stops, yes, confirmed: !!account?.email_confirmed_at || account?.plan === 'pro', signup: signupKind(source), answered: yes.size > 0 || stops.has('releases') || stops.has('tips')};
}

/** Stores a yes for `list`, replacing a stop. The caller decides whether this person may lift a stop. */
export async function sayYes(env, addr, list, via, now = new Date()) {
  await env.STATS.prepare('INSERT OR REPLACE INTO mail_on (addr, list, via, at) VALUES (?, ?, ?, ?)').bind(addr, list, via, now.toISOString()).run();
  await env.STATS.prepare('DELETE FROM mail_off WHERE addr = ? AND list = ?').bind(addr, list).run();
}

// Turns a list ('service' | 'releases' | 'tips' | 'all', or the old 'marketing' = both news types) off for an address digest.
export async function switchOff(env, addr, list, reason, now = new Date()) {
  for (const one of list === 'marketing' ? NEWS : [list]) {
    await env.STATS.prepare('INSERT OR REPLACE INTO mail_off (addr, list, reason, at) VALUES (?, ?, ?, ?)').bind(addr, one, reason, now.toISOString()).run();
    if (NEWS.includes(one)) await env.STATS.prepare('DELETE FROM mail_on WHERE addr = ? AND list = ?').bind(addr, one).run().catch(() => {});
  }
  if (list === 'service' || list === 'all') await env.STATS.prepare('UPDATE pro_accounts SET service_mail_off_at = ? WHERE email_hash = ? AND service_mail_off_at IS NULL').bind(now.toISOString(), addr).run().catch(() => {});
}

/**
 * Records the answers a person pressed: `releases` and/or `tips` (a missing one changes nothing), or the old single box `marketing` from an app already out.
 * Why (owner, 5 Nov 2026; review of #436): that old box shows the Tips and tricks answer (GET `marketing`), and the app sends it back on every save, so it is the Tips box only: true can
 * never touch the releases answer, and false counts only when it takes back a yes. An implied box is no answer.
 * A yes from an unconfirmed address keeps that address's stop: anyone can type someone else's address. `lift: false` (the Always on wizard, whose app copy can be stale) never lifts any stop.
 * `account` = pro_accounts.id.
 */
export async function recordNews(env, account, body, now = new Date(), {lift = true} = {}) {
  const row = await env.STATS.prepare('SELECT email, email_hash, email_confirmed_at FROM pro_accounts WHERE id = ?').bind(account).first();
  if (!row?.email_hash) return;
  const facts = await newsFacts(env, row.email_hash, row.email), via = body.newsVia === 'card' ? 'card' : 'settings';
  let answers = NEWS.filter(list => typeof body[list] === 'boolean').map(list => [list, body[list]]);
  if (!answers.length && (body.marketing === true || (body.marketing === false && facts.yes.has('tips')))) answers = [['tips', body.marketing]];
  for (const [list, yes] of answers) {
    if (!yes) await switchOff(env, row.email_hash, list, 'settings', now);
    else if (facts.stops.has(list) ? lift && !!row.email_confirmed_at : true) await sayYes(env, row.email_hash, list, body.marketing === true ? 'old-box' : via, now);
  }
}
