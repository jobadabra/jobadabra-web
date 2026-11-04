// Telling the person who sent a feedback (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7): the owner's words, what he linked, the in-app reply the app reads,
// and the one e-mail through the sender we already have (shared/mail.js, template `feedback-update`, service list). Nothing is sent that the owner did not write or accept.
// Guarded by test/unit/shared/feedback-reply.test.js.
import {send, validAddress} from './mail.js';
import {PUBLIC_REPO, githubUrl} from './repos.js';

export const DEFAULT_DEFER = 'Thank you: we saw this and parked it for later. If we pick it up we will tell you.';
export const defaultFixed = fixedIn => (fixedIn ? `Thank you: this is fixed in ${fixedIn}.` : 'Thank you: this is fixed and will arrive in the next update.');
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|commit)\/\w+$/, LINEAR = /^https:\/\/linear\.app\/[\w./-]+$/, VERSION = /^[\w.+ -]{0,40}$/, PR_MAX = 200;
// Why (5/7 code review, 3 Nov 2026): a release's PR list is the public repo's, so only a pull request of that repo can be matched by number. Another repo's PR with the same number, or a commit, must not.
const PUBLIC_PR = new RegExp(`^${githubUrl(PUBLIC_REPO).replace(/[.]/g, '\\.')}/pull/(\\d+)$`);   // the owner's name comes from shared/repos.js, never typed here (guard: test/python/test_site_org_owner.py)
/** The PR number a card's link names when it can be matched by a release (a pull request of the public repo), else 0. */
export const releasePr = url => Number(String(url || '').match(PUBLIC_PR)?.[1]) || 0;
const WHEN = ['now', 'release', 'never'];
const FIXED_STATES = ['fixed', 'released'];   // both read as "fixed" to the reporter: Released only adds that the build shipped
export const TOLD_ERROR = 'app, error: not confirmed';
// Why (3/7 code review, 3 Nov 2026): one rule says when the app may show a reply, used by the list and by closing: the card is Fixed, Released or Deferred, it was told, and the person has not closed this telling.
const VISIBLE = "state IN ('fixed', 'released', 'deferred') AND told LIKE 'app%' AND seen_at = '' AND ref != ''";

/** What the reporter reads: the owner's own words, else the default sentence for the state. */
export const replyText = row => clip(row.tell_message, 300) || (FIXED_STATES.includes(row.state) ? defaultFixed(row.fixed_in) : DEFAULT_DEFER);
/** The reporter's own words, cut for the reply ("You wrote on 28 Oct: …"): never more than 80 characters. */
export const excerptOf = text => { const one = clip(text, 400); return one.length > 80 ? `${one.slice(0, 79).trimEnd()}…` : one; };

/**
 * The columns the Fixed form sets, or {error}. `when`: now | release | never; blank = now when a version is typed, else at the next release.
 * -> {columns, tell}. A release-timed fix waits (`told = 'pending'`) until PR 5/7's release call finds it.
 */
export function fixedColumns(input) {
  const fixedIn = clip(input.fixed_in, 400), pr = clip(input.pr_url, 400);   // cut only to bound the work: a value over its limit then fails its own check, never passes cut to fit
  if (!VERSION.test(fixedIn)) return {error: 'The version has letters, digits, dots and dashes only.'};
  if (pr && (pr.length > PR_MAX || !PR.test(pr))) return {error: 'The link is a GitHub pull request or commit, like https://github.com/jobadabra/jobadabra/pull/123.'};
  const tell = WHEN.includes(input.when) ? input.when : (fixedIn ? 'now' : 'release');
  // Why (5/7 review): a release finds a fix by a public-repo PR number or by the version typed; any other link would wait for ever.
  if (tell === 'release' && pr && !releasePr(pr) && !fixedIn) return {error: "A release can't find this link: use a pull request of the public repo, type the version, or leave the link out."};
  return {tell, columns: {fixed_in: fixedIn, pr_url: pr, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: tell === 'release' ? 'pending' : ''}};
}

/**
 * The columns "Mark as released" sets, or {error}: the version it shipped in (required) and, for a card still waiting for a release, the claim that lets the reporter be told now
 * (`told = 'telling'`, the same claim a release call makes). A card already told keeps what it was told. `row` = the card as read first.
 */
export function releasedColumns(input, row) {
  const version = typeof input.version === 'string' ? clip(input.version, 400) : '';
  if (!version || !VERSION.test(version)) return {error: 'Type the version it shipped in: letters, digits, dots and dashes only.'};
  const waits = row.told === 'pending';
  return {tell: waits ? 'now' : undefined, detail: version, columns: {fixed_in: version, told: waits ? 'telling' : row.told}};
}

/** The columns the Acknowledge + defer form sets, or {error}. `tell`: false = do not tell (default true). */
export function deferColumns(input) {
  const linear = clip(input.linear_url, 400);
  if (linear && (linear.length > PR_MAX || !LINEAR.test(linear))) return {error: 'The link is a Linear issue, like https://linear.app/jobadabra/issue/JOB-12.'};
  const tell = input.tell === false ? 'never' : 'now';
  return {tell, columns: {linear_url: linear, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: ''}};
}

/**
 * Makes the reply visible to the app and sends the e-mail when the owner ticked it and the contact is an address. -> the `told` value written.
 * The mail goes through send(): it refuses (never throws) an unsubscribed or bounced address, mail switched off or the 6-a-day limit; that refusal is written on the card, the app reply still shows.
 */
export async function tellReporter(env, ref, now = new Date(), who = 'owner (told)') {
  const row = await env.STATS.prepare('SELECT at, text, contact, state, fixed_in, tell_message, tell_mail FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row || ![...FIXED_STATES, 'deferred'].includes(row.state)) return '';
  let told = 'app';
  if (row.tell_mail && validAddress(row.contact)) {
    const sent = await send(env, 'feedback-update', row.contact, {kind: FIXED_STATES.includes(row.state) ? 'fixed' : 'deferred', on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), message: replyText(row)}, {now});
    told = sent.ok ? 'app+mail' : `app, mail refused: ${sent.reason}`;
  } else if (row.tell_mail) told = 'app, mail refused: not an address';
  await env.STATS.batch([
    env.STATS.prepare('UPDATE feedback SET told = ?, told_at = ?, seen_at = \'\' WHERE ref = ?').bind(told, now.toISOString(), ref),
    env.STATS.prepare('INSERT INTO feedback_log (at, ref, who, action, detail) VALUES (?, ?, ?, ?, ?)').bind(now.toISOString(), ref, who, 'tell', told.slice(0, 200)),
  ]);
  return told;
}

/**
 * tellReporter that never throws, for a card already claimed (`told = 'telling'`, or blank for "now"): a store error after the mail left is written on the card and is never put back to
 * waiting, which would mail twice. -> the told value, or TOLD_ERROR.
 */
export async function tellOnce(env, ref, now, who) {
  try { return await tellReporter(env, ref, now, who); } catch {
    await env.STATS.prepare("UPDATE feedback SET told = ?, told_at = ? WHERE ref = ? AND told IN ('telling', '')").bind(TOLD_ERROR, now.toISOString(), ref).run().catch(() => {});
    return TOLD_ERROR;
  }
}

/** The replies the app has not shown yet for this install, newest first, at most 5: {ref, on, excerpt, kind, fixedIn, message}. */
export async function repliesFor(db, install) {
  const rows = (await db.prepare(`SELECT ref, at, text, state, fixed_in, tell_message FROM feedback WHERE install = ? AND ${VISIBLE} ORDER BY told_at DESC LIMIT 5`).bind(install).all()).results || [];
  return rows.map(row => ({ref: row.ref, on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), kind: FIXED_STATES.includes(row.state) ? 'fixed' : 'deferred', fixedIn: row.fixed_in, message: replyText(row)}));
}

/** The person closed a reply in the app. -> true when a row changed. */
export async function markSeen(db, install, ref, now = new Date()) {
  const done = await db.prepare(`UPDATE feedback SET seen_at = ? WHERE install = ? AND ref = ? AND ${VISIBLE}`).bind(now.toISOString(), install, ref).run();
  return (done?.meta?.changes ?? done?.changes ?? 0) > 0;
}
