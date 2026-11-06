// The four types of mail and who gets each (owner, 5 Nov 2026: "we should not treat all the emails as one box"). This file is the one owner of the rules: shared/mail.js sends by them,
// api/account-email.js and api/mail-settings.js show them, admin/email-audience.js counts them, and Admin → E-mail prints MAIL_TYPES. Guard: test/unit/shared/mail/mail-lists.test.js.
// Design: an address has at most one stored answer per news type: a yes (mail_on) or a stop (mail_off). No row means no answer yet, which is how a default is told from a choice.

export const NEWS = ['releases', 'tips'];   // the promotional ones: MARKETING_MAIL gates them, and the old single list 'marketing' stood for both
export const OPT_IN = [...NEWS, 'jobdigest'];   // every type with a stored answer per address (mail_on / mail_off)
/**
 * The app's "News from Jobadabra" card and the mail settings page. Two switches for our five mails.
 * Why (owner, 6 Nov 2026: "What user will agree on deliberately ticking \"Come back\"?"): a switch is for a choice a person would make; offers, tips and the come-back reminder share one, What's new stays separate, and the trial reminder has none (facts about their own trial).
 */
export const NEWS_SWITCHES = [
  {id: 'releases', name: "What's new", when: 'A new version and what changed'},
  {id: 'tips', name: 'News and tips', when: 'Offers, tips, and a reminder if you have been away'},
];

/** The agreed rules in the owner's words, as Admin → E-mail shows them. */
export const MAIL_TYPES = [
  {id: 'service', name: 'Service', carries: 'Matches, digest, sign-in codes, trial and account notices', starts: 'On', who: 'Everyone with an address'},
  {id: 'jobdigest', name: 'Job digest', carries: 'The best new matches from the last search, for people without Always on (the mail comes later)', starts: 'Off', who: 'Only a real tick, on a confirmed address'},
  {id: 'releases', name: "What's new", carries: 'A release, nothing else', starts: 'Off', who: 'Only a real yes, on a confirmed address; website waitlist signups from the start. Until they stop it'},
  {id: 'tips', name: 'News and tips', carries: 'Offers like the Pro launch, tips, and the come-back reminder', starts: 'Off', who: 'Only a real tick. The Pro launch mail also goes to every waitlist signup'},
];

/** What a waitlist entry's source allows: 'news' saw the wording that names release mails; 'pro' only the Pro mail. Why (owner, 5 Nov 2026): the app's dialog still says "Nothing else". */
export const signupKind = source => (source === 'web' || source === 'app-news' ? 'news' : source ? 'pro' : '');

const stopped = (facts, list) => facts.stops.has(list) || facts.stops.has('all');
const known = facts => facts.confirmed || facts.signup === 'news';
/** True once the person has answered the news question (a stored yes or stop for releases or tips); a job digest row is not an answer to it. */
export const newsAnswered = (yes, stops) => NEWS.some(list => yes.has(list) || stops.has(list));

// Why (owner, 6 Nov 2026: "Only Trial reminder on", replacing 5 Nov's "this should be on by default"): What's new is off until a yes, like News and tips. A website waitlist signup under the new wording is a yes.
const saidYes = (list, facts) => facts.yes.has(list) || (list === 'releases' && facts.signup === 'news');

/** The answer a switch shows for `list`: on only when this mail would be asked for, so a switch never says less or more than the sender does. */
export const newsAnswer = (list, facts) => !stopped(facts, list) && saidYes(list, facts);

/**
 * Why `list` will not reach this address, or '' when it will. `waitlistToo`: a mail every waitlist signup asked for (the Pro launch).
 * Why (owner, 5 Nov 2026: "After confirming"): an unconfirmed address may be a stranger's, so no news type reaches it.
 */
export function newsRefusal(list, facts, {waitlistToo = false} = {}) {
  if (stopped(facts, list)) return facts.stops.has('all') ? 'suppressed' : 'unsubscribed';
  if (list === 'jobdigest') return !facts.yes.has('jobdigest') ? 'no_tick' : facts.confirmed ? '' : 'not_confirmed';   // owner, 5 Nov 2026: "Its own kind, off until ticked"
  if (waitlistToo && facts.signup) return '';
  if (!saidYes(list, facts)) return 'no_tick';
  return known(facts) ? '' : facts.signup ? 'pro_only' : 'not_confirmed';
}

/** What the site holds for an address digest; `email` (lower-case, or null) finds its waitlist signup. -> {stops, yes, confirmed, signup, answered} */
export async function newsFacts(env, addr, email) {
  const stops = new Set(((await env.STATS.prepare("SELECT list FROM mail_off WHERE addr = ? AND list IN ('all', 'releases', 'tips', 'jobdigest', 'marketing')").bind(addr).all()).results || []).map(row => row.list));
  // Why (review of #436): a failed migration only warns (site.yml), so a stop made under the old single list must still hold, for both news types.
  if (stops.delete('marketing')) for (const list of NEWS) stops.add(list);
  // Why (5 Nov 2026): a failed migration only warns (site.yml). Without mail_on nobody has a stored yes, and every stop is still read above, so this can only send less.
  // Why (review of hr-36): any other failed read throws: "no yes" reaching the app would come back as an answer and overwrite the person's choice.
  const yes = new Set(((await env.STATS.prepare('SELECT list FROM mail_on WHERE addr = ?').bind(addr).all().catch(error => { if (/no such table/i.test(String(error?.message || error))) return {results: []}; throw error; })).results || []).map(row => row.list));
  const account = await env.STATS.prepare('SELECT email_confirmed_at, plan FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  const entry = email ? await env.WAITLIST?.get(`signup:${email}`) : null;
  let source = '';
  try { source = entry ? JSON.parse(entry).source || 'unknown' : ''; } catch { source = 'unknown'; }
  return {stops, yes, confirmed: !!account?.email_confirmed_at || account?.plan === 'pro', signup: signupKind(source), answered: newsAnswered(yes, stops)};
}

/** Stores a yes for `list`, replacing a stop. The caller decides whether this person may lift a stop. */
export async function sayYes(env, addr, list, via, now = new Date()) {
  await env.STATS.prepare('INSERT OR REPLACE INTO mail_on (addr, list, via, at) VALUES (?, ?, ?, ?)').bind(addr, list, via, now.toISOString()).run();
  await env.STATS.prepare('DELETE FROM mail_off WHERE addr = ? AND list = ?').bind(addr, list).run();
}

// Turns a list ('service' | 'releases' | 'tips' | 'jobdigest' | 'all', or the old 'marketing' = both news types) off for an address digest.
export async function switchOff(env, addr, list, reason, now = new Date()) {
  for (const one of list === 'marketing' ? NEWS : [list]) {
    await env.STATS.prepare('INSERT OR REPLACE INTO mail_off (addr, list, reason, at) VALUES (?, ?, ?, ?)').bind(addr, one, reason, now.toISOString()).run();
    if (OPT_IN.includes(one)) await env.STATS.prepare('DELETE FROM mail_on WHERE addr = ? AND list = ?').bind(addr, one).run().catch(() => {});
  }
  if (list === 'service' || list === 'all') await env.STATS.prepare('UPDATE pro_accounts SET service_mail_off_at = ? WHERE email_hash = ? AND service_mail_off_at IS NULL').bind(now.toISOString(), addr).run().catch(() => {});
}

/**
 * What the old box from an app already out really says. Why (owner, 5 Nov 2026; review of #436 and hr-36): it shows the tips answer (GET `marketing`) and the app sends it back on every save, so only a CHANGE is an answer; an echo, or a tick on a stopped box, is none.
 * Why (6 Nov 2026): its words are "product news and the Pro launch offer", and What's new now needs a yes, so a change means both.
 */
function oldBoxAnswers(marketing, facts) {
  if (typeof marketing !== 'boolean' || marketing === newsAnswer('tips', facts) || stopped(facts, 'tips')) return [];
  return marketing ? NEWS.map(list => [list, true]) : NEWS.filter(list => facts.yes.has(list)).map(list => [list, false]);
}

/**
 * Records the answers a person pressed: `releases`, `tips` and/or `jobdigest` (a missing one changes nothing), or the old single box `marketing` from an app already out.
 * The old box: see oldBoxAnswers.
 * A yes from an unconfirmed address keeps that address's stop: anyone can type someone else's address. The old box and `lift: false` (the Always on wizard) never lift any stop: their app copy can be stale.
 * `account` = pro_accounts.id.
 */
export async function recordNews(env, account, body, now = new Date(), {lift = true} = {}) {
  const row = await env.STATS.prepare('SELECT email, email_hash, email_confirmed_at, plan FROM pro_accounts WHERE id = ?').bind(account).first();
  if (!row?.email_hash) return;
  const facts = await newsFacts(env, row.email_hash, row.email), via = body.newsVia === 'card' ? 'card' : 'settings';
  const explicit = OPT_IN.filter(list => typeof body[list] === 'boolean').map(list => [list, body[list]]), old = !explicit.length;
  // Why (Gitar on #436): the old box's copy in the app can be older than a stop made through a mail link, and the app echoes it on every save; only the explicit fields can lift a stop.
  const answers = old ? oldBoxAnswers(body.marketing, facts) : explicit;
  const confirmed = !!row.email_confirmed_at || row.plan === 'pro';   // Pro counts as confirmed, like the sender (newsFacts)
  for (const [list, yes] of answers) {
    if (!yes) await switchOff(env, row.email_hash, list, 'settings', now);
    else if (facts.stops.has(list) ? lift && !old && confirmed : true) await sayYes(env, row.email_hash, list, old ? 'old-box' : via, now);
  }
}
