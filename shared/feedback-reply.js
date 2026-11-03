// Telling the person who sent a feedback (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 3/7): the owner's words, what he linked, the in-app reply the app reads,
// and the one e-mail through the sender we already have (shared/mail.js, template `feedback-update`, service list). Nothing is sent that the owner did not write or accept.
// Guarded by test/shared/feedback-reply.test.js.
import {send, validAddress} from './mail.js';

export const DEFAULT_DEFER = 'Thank you: we saw this and parked it for later. If we pick it up we will tell you.';
export const defaultFixed = fixedIn => (fixedIn ? `Thank you: this is fixed in ${fixedIn}.` : 'Thank you: this is fixed and will arrive in the next update.');
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|commit)\/\w+$/, LINEAR = /^https:\/\/linear\.app\/[\w./-]+$/, VERSION = /^[\w.+ -]{0,40}$/;
const WHEN = ['now', 'release', 'never'];

/** What the reporter reads: the owner's own words, else the default sentence for the state. */
export const replyText = row => clip(row.tell_message, 300) || (row.state === 'fixed' ? defaultFixed(row.fixed_in) : DEFAULT_DEFER);
/** The reporter's own words, cut for the reply ("You wrote on 28 Oct: …"): never more than 80 characters. */
export const excerptOf = text => { const one = clip(text, 400); return one.length > 80 ? `${one.slice(0, 79).trimEnd()}…` : one; };

/**
 * The columns the Fixed form sets, or {error}. `when`: now | release | never; blank = now when a version is typed, else at the next release.
 * -> {columns, tell}. A release-timed fix waits (`told = 'pending'`) until PR 5/7's release call finds it.
 */
export function fixedColumns(input) {
  const fixedIn = clip(input.fixed_in, 40), pr = clip(input.pr_url, 200);
  if (!VERSION.test(fixedIn)) return {error: 'The version has letters, digits, dots and dashes only.'};
  if (pr && !PR.test(pr)) return {error: 'The link is a GitHub pull request or commit, like https://github.com/jobadabra/jobadabra/pull/123.'};
  const tell = WHEN.includes(input.when) ? input.when : (fixedIn ? 'now' : 'release');
  return {tell, columns: {fixed_in: fixedIn, pr_url: pr, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: tell === 'release' ? 'pending' : ''}};
}

/** The columns the Acknowledge + defer form sets, or {error}. `tell`: false = do not tell (default true). */
export function deferColumns(input) {
  const linear = clip(input.linear_url, 200);
  if (linear && !LINEAR.test(linear)) return {error: 'The link is a Linear issue, like https://linear.app/jobadabra/issue/JOB-12.'};
  const tell = input.tell === false ? 'never' : 'now';
  return {tell, columns: {linear_url: linear, tell_mode: tell, tell_message: clip(input.message, 300), tell_mail: input.mail ? 1 : 0, told: ''}};
}

/**
 * Makes the reply visible to the app and sends the e-mail when the owner ticked it and the contact is an address. -> the `told` value written.
 * The mail goes through send(): it refuses (never throws) an unsubscribed or bounced address, mail switched off or the 6-a-day limit; that refusal is written on the card, the app reply still shows.
 */
export async function tellReporter(env, ref, now = new Date()) {
  const row = await env.STATS.prepare('SELECT at, text, contact, state, fixed_in, tell_message, tell_mail FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row || !['fixed', 'deferred'].includes(row.state)) return '';
  let told = 'app';
  if (row.tell_mail && validAddress(row.contact)) {
    const sent = await send(env, 'feedback-update', row.contact, {kind: row.state === 'fixed' ? 'fixed' : 'deferred', on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), message: replyText(row)}, {now});
    told = sent.ok ? 'app+mail' : `app, mail refused: ${sent.reason}`;
  } else if (row.tell_mail) told = 'app, mail refused: not an address';
  await env.STATS.batch([
    env.STATS.prepare('UPDATE feedback SET told = ?, told_at = ? WHERE ref = ?').bind(told, now.toISOString(), ref),
    env.STATS.prepare('INSERT INTO feedback_log (at, ref, who, action, detail) VALUES (?, ?, ?, ?, ?)').bind(now.toISOString(), ref, 'owner (told)', 'tell', told.slice(0, 200)),
  ]);
  return told;
}

/** The replies the app has not shown yet for this install, newest first, at most 5: {ref, on, excerpt, kind, fixedIn, message}. */
export async function repliesFor(db, install) {
  const rows = (await db.prepare("SELECT ref, at, text, state, fixed_in, tell_message FROM feedback WHERE install = ? AND told LIKE 'app%' AND seen_at = '' AND ref != '' ORDER BY told_at DESC LIMIT 5").bind(install).all()).results || [];
  return rows.map(row => ({ref: row.ref, on: String(row.at).slice(0, 10), excerpt: excerptOf(row.text), kind: row.state === 'fixed' ? 'fixed' : 'deferred', fixedIn: row.fixed_in, message: replyText(row)}));
}

/** The person closed a reply in the app. -> true when a row changed. */
export async function markSeen(db, install, ref, now = new Date()) {
  const done = await db.prepare("UPDATE feedback SET seen_at = ? WHERE install = ? AND ref = ? AND told LIKE 'app%' AND seen_at = ''").bind(now.toISOString(), install, ref).run();
  return (done?.meta?.changes ?? done?.changes ?? 0) > 0;
}
