// Telling the person who sent a feedback (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7): the owner's words, what he linked, the in-app reply the app reads,
// and the one e-mail through the sender we already have (shared/mail.js, template `feedback-update`, service list). Nothing is sent that the owner did not write or accept.
// Guarded by test/unit/shared/feedback/feedback-reply.test.js.
import {send, validAddress} from './mail.js';
import {PUBLIC_REPO, githubUrl} from './repos.js';

export const DEFAULT_DEFER = 'Thank you: we saw this and parked it for later. If we pick it up we will tell you.';
/** The closing reply for a report the owner set aside (dismissed, false positive), offered pre-filled and sent only when the owner presses the button (owner, 5 Nov 2026: "Yes, short and kind"; nothing goes out until the owner has seen the wording). */
export const DEFAULT_CLOSE = "Thanks, we looked into this and it isn't something we'll change.";
export const defaultFixed = fixedIn => (fixedIn ? `Thank you: this is fixed in ${fixedIn}.` : 'Thank you: this is fixed and will arrive in the next update.');
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|commit)\/\w+$/, LINEAR = /^https:\/\/linear\.app\/[\w./-]+$/, VERSION = /^[\w.+ -]{0,40}$/, PR_MAX = 200;
// Why (5/7 code review, 3 Nov 2026): a release's PR list is the public repo's, so only a pull request of that repo can be matched by number. Another repo's PR with the same number, or a commit, must not.
const PUBLIC_PR = new RegExp(`^${githubUrl(PUBLIC_REPO).replace(/[.]/g, '\\.')}/pull/(\\d+)$`);   // the owner's name comes from shared/repos.js, never typed here (guard: test/python/test_site_org_owner.py)
/** The PR number a card's link names when it can be matched by a release (a pull request of the public repo), else 0. */
export const releasePr = url => Number(String(url || '').match(PUBLIC_PR)?.[1]) || 0;
const WHEN = ['now', 'release', 'never'];
const CLOSED_STATES = ['dismissed', 'false_positive'];   // set aside: the reporter hears only when the owner chose to reply (closeColumns)
const FIXED_STATES = ['fixed', 'released'];   // both read as "fixed" to the reporter: Released only adds that the build shipped
export const TOLD_ERROR = 'app, error: not confirmed';
/** The receipt every report gets at once, before any person has read it (owner, 5 Nov 2026: "Within 24 hours"). Why: 1 of 8 reporters heard back within 24 h and 3 of 8 never did (D1, 5 Nov 2026), so the first thing a reporter sees must not wait for the owner. */
export const RECEIVED = 'We got it. You will hear from us within 24 hours.';
export const REPLY_HOURS = 24;
const RECEIPT_DAYS = 14;
/** Reports older than this are history, not a clock: no chip, no ping (the ping's SQL uses the same window). */
export const CLOCK_DAYS = 7;
/** The SQL of "nobody has answered this yet": not set aside (dismissed, false positive), not told in the app (told starts with app, or a release call is mid-way), and not marked "do not tell" (tell_mode never). The one rule behind the receipt, the clock and the ping. */
export const UNANSWERED = "state NOT IN ('dismissed', 'false_positive') AND told NOT LIKE 'app%' AND told != 'telling' AND tell_mode != 'never'";
/** Free applications the owner may add for a validated report (owner, 5 Nov 2026: "As long as the feedback is validated on our side, and we acknoweledge it as a problem/bug. Then it's unlimited."): the Fixed form's thank-you tick. */
export const THANKS_APPS = 5;
/** The sentence a thanked reporter reads after the owner's words, in the app and in the e-mail. Says what it buys: applications. */
export const THANKS_LINE = `We also added ${THANKS_APPS} more free applications to say thank you.`;
const RECEIPT_PREFIX = 'r:';   // the receipt's ref in the replies list; closing it never touches the owner's later reply (seen_at)

// Why (3/7 code review, 3 Nov 2026): one rule says when the app may show a reply, used by the list and by closing: the card is Fixed, Released or Deferred, it was told, and the person has not closed this telling.
// Why (code review of 1b, 5 Nov 2026): a card set aside shows a reply only when it was told in the step that set it aside (told_at not before state_at), never an older telling from before it was reopened and dismissed.
const VISIBLE = "state IN ('fixed', 'released', 'deferred', 'dismissed', 'false_positive') AND told LIKE 'app%' AND seen_at = '' AND ref != '' AND (state NOT IN ('dismissed', 'false_positive') OR told_at >= state_at)";

/** What the reporter reads: the owner's own words, else the default sentence for the state. */
export const replyText = row => {
  if (CLOSED_STATES.includes(row.state)) return clip(row.tell_message, 300) || DEFAULT_CLOSE;
  return (clip(row.tell_message, 300) || (FIXED_STATES.includes(row.state) ? defaultFixed(row.fixed_in) : DEFAULT_DEFER)) + (FIXED_STATES.includes(row.state) && row.thanks_apps > 0 ? ` ${THANKS_LINE}` : '');
};
/** The reporter's own words, cut for the reply ("You wrote on 28 Oct: …"): never more than 80 characters. */
export const excerptOf = text => { const one = clip(text, 400); return one.length > 80 ? `${one.slice(0, 79).trimEnd()}…` : one; };

/**
 * The columns the Fixed form sets, or {error}. `when`: now | release | never; blank = now when a version is typed, else at the next release.
 * `row`: the card as read first; once its thank-you was granted (a trial_bonus row exists) the form no longer changes it, so saving Fixed again without the tick cannot take the 5 back.
 * -> {columns, tell}. A release-timed fix waits (`told = 'pending'`) until PR 5/7's release call finds it.
 */
export function fixedColumns(input, row = {}) {
  const fixedIn = clip(input.fixed_in, 400), pr = clip(input.pr_url, 400);   // cut only to bound the work: a value over its limit then fails its own check, never passes cut to fit
  if (!VERSION.test(fixedIn)) return {error: 'The version has letters, digits, dots and dashes only.'};
  if (pr && (pr.length > PR_MAX || !PR.test(pr))) return {error: 'The link is a GitHub pull request or commit, like https://github.com/jobadabra/jobadabra/pull/123.'};
  const tell = WHEN.includes(input.when) ? input.when : (fixedIn ? 'now' : 'release');
  // Why (5/7 review): a release finds a fix by a public-repo PR number or by the version typed; any other link would wait for ever.
  if (tell === 'release' && pr && !releasePr(pr) && !fixedIn) return {error: "A release can't find this link: use a pull request of the public repo, type the version, or leave the link out."};
  return {tell, columns: {fixed_in: fixedIn, pr_url: pr, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, ...(row.granted ? {} : {thanks_apps: input.thanks ? THANKS_APPS : 0}), told: tell === 'release' ? 'pending' : ''}};
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

/**
 * The columns Dismiss and False positive set when the owner chose to reply (`input.reply` true), or none (the one-click dismiss as before). The reply is the owner's words, else DEFAULT_CLOSE at tell time;
 * the false positive's own note is the owner's reason and never reaches the reporter. -> {tell, columns}. The reply goes through tellOnce like every other (in the app, and by e-mail when ticked).
 */
export function closeColumns(input) {
  // Why (own test, 5 Nov 2026): a card told earlier (Fixed, then Reopen) keeps told = 'app'; closing it without a reply clears that, or the old reply would be served as the closing reply.
  if (input.reply !== true) return {columns: {told: ''}};
  return {tell: 'now', columns: {tell_mode: 'now', tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: ''}};
}

/** The columns the Acknowledge + defer form sets, or {error}. `tell`: false = do not tell (default true). */
export function deferColumns(input) {
  const linear = clip(input.linear_url, 400);
  if (linear && (linear.length > PR_MAX || !LINEAR.test(linear))) return {error: 'The link is a Linear issue, like https://linear.app/jobadabra/issue/JOB-12.'};
  const tell = input.tell === false ? 'never' : 'now';
  return {tell, columns: {linear_url: linear, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: ''}};
}

/** The write that grants a report's thank-you: one trial_bonus row (install, ref, apps) when the owner ticked it (thanks_apps > 0) and the card is Fixed or Released; a second run changes nothing (the ref is the key). The row outlives the card. */
const grantStatement = (env, ref, now) => env.STATS.prepare("INSERT OR IGNORE INTO trial_bonus (ref, install, apps, at) SELECT ref, install, thanks_apps, ? FROM feedback WHERE ref = ? AND thanks_apps > 0 AND install != '' AND state IN ('fixed', 'released')").bind(now.toISOString(), ref);

/**
 * Makes the reply visible to the app and sends the e-mail when the owner ticked it and the contact is an address. -> the `told` value written.
 * The mail goes through send(): it refuses (never throws) an unsubscribed or bounced address, mail switched off or the per-address limit; that refusal is written on the card, the app reply still shows.
 */
export async function tellReporter(env, ref, now = new Date(), who = 'owner (told)') {
  const row = await env.STATS.prepare('SELECT at, text, contact, state, fixed_in, tell_message, tell_mail, thanks_apps FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row || ![...FIXED_STATES, ...CLOSED_STATES, 'deferred'].includes(row.state)) return '';
  let told = 'app';
  if (row.tell_mail && validAddress(row.contact)) {
    const sent = await send(env, 'feedback-update', row.contact, {kind: FIXED_STATES.includes(row.state) ? 'fixed' : 'deferred', on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), message: replyText(row)}, {now});
    told = sent.ok ? 'app+mail' : `app, mail refused: ${sent.reason}`;
  } else if (row.tell_mail) told = 'app, mail refused: not an address';
  await env.STATS.batch([
    env.STATS.prepare('UPDATE feedback SET told = ?, told_at = ?, seen_at = \'\' WHERE ref = ?').bind(told, now.toISOString(), ref),
    grantStatement(env, ref, now),   // Why (fb 2/7, 5 Nov 2026): the grant is written by the same batch that tells the reporter, once (the ref is the key), so a second telling, Reopen then Fixed, or a release call after a "tell now" adds nothing
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
    await grantStatement(env, ref, now).run().catch(() => {});   // the reply is visible now and says the thank-you (the mail may have said it too): the grant must not be the one thing missing
    return TOLD_ERROR;
  }
}

/**
 * The 24 hour reply clock of one report, from its own columns: 'done' when the reporter was told in the app (told starts with "app", or a release call is mid-way), the owner set the report aside (dismissed, false positive) or chose not to tell (tell_mode never), or it is older than 7 days;
 * else {status: 'due', hours: left} or {status: 'overdue', hours: late}, rounded to whole hours. The one rule the admin chip and the overdue ping share.
 */
export function replyClock(row, now = new Date()) {
  if (['dismissed', 'false_positive'].includes(row.state) || /^(app|telling)/.test(String(row.told || '')) || row.tell_mode === 'never') return {status: 'done', hours: 0};
  const age = (now.getTime() - Date.parse(row.at)) / 3600000;
  if (age > CLOCK_DAYS * 24) return {status: 'done', hours: 0};   // history, not a clock
  const left = REPLY_HOURS - age;
  return left >= 0 ? {status: 'due', hours: Math.ceil(left)} : {status: 'overdue', hours: Math.floor(-left)};
}

/**
 * The replies the app has not shown yet for this install, at most 5: {ref, on, excerpt, kind, fixedIn, message}. The owner's answers first (newest first), then a receipt ("We got it") for each recent report
 * that has no answer yet (also one the owner marked fixed for a release: the reporter still has heard nothing), with ref "r:<ref>" and kind "received". An app that does not know "received" shows it like a heard-it card with the same words.
 */
export async function repliesFor(db, install, now = new Date()) {
  const rows = (await db.prepare(`SELECT ref, at, text, state, fixed_in, tell_message, thanks_apps FROM feedback WHERE install = ? AND ${VISIBLE} ORDER BY told_at DESC LIMIT 5`).bind(install).all()).results || [];
  const answers = rows.map(row => ({ref: row.ref, on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), kind: FIXED_STATES.includes(row.state) ? 'fixed' : 'deferred', fixedIn: row.fixed_in, message: replyText(row)}));
  if (answers.length >= 5) return answers;
  const since = new Date(now.getTime() - RECEIPT_DAYS * 86400000).toISOString();
  const waiting = (await db.prepare(`SELECT ref, at, text FROM feedback WHERE install = ? AND ${UNANSWERED} AND receipt_seen_at = '' AND ref != '' AND at >= ? ORDER BY at DESC LIMIT ?`).bind(install, since, 5 - answers.length).all()).results || [];
  return [...answers, ...waiting.map(row => ({ref: RECEIPT_PREFIX + row.ref, on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), kind: 'received', fixedIn: '', message: RECEIVED}))];
}

/** The person closed a reply in the app. A receipt ("r:<ref>") sets receipt_seen_at, an answer sets seen_at. -> true when a row changed. */
export async function markSeen(db, install, ref, now = new Date()) {
  const receipt = String(ref).startsWith(RECEIPT_PREFIX);
  const done = receipt
    ? await db.prepare("UPDATE feedback SET receipt_seen_at = ? WHERE install = ? AND ref = ? AND receipt_seen_at = '' AND ref != ''").bind(now.toISOString(), install, String(ref).slice(RECEIPT_PREFIX.length)).run()
    : await db.prepare(`UPDATE feedback SET seen_at = ? WHERE install = ? AND ref = ? AND ${VISIBLE}`).bind(now.toISOString(), install, ref).run();
  return (done?.meta?.changes ?? done?.changes ?? 0) > 0;
}
