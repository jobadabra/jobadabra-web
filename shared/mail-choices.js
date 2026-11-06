// Each person's choice per app mail (spec docs/superpowers/specs/2026-11-05-service-mail-rules-design.md §2, PR 3; owner, 5 Nov 2026: "each users sets his own emails").
// One stored value per address and row, in the tables the news answers already use: mail_off (list = the row id, reason = where it was set) for "no e-mail", mail_on for an explicit yes.
// Nothing stored = the person never chose: the mail goes as it does today (the app applies the suggested defaults, PR 4). Ticks only, never search data.
// The app (Automation, Notifications), the mail settings page and the footer link all write here, so they can never disagree. Guard: test/unit/api/mail-choices.test.js.
import {APP_ROWS} from './mail-registry.js';

const VIA = ['app', 'mail-settings'];

/** The person's stored choices for the app rows: {row: 'on' | 'off'}, a row absent when never chosen. A failed read throws (the caller decides what that means). */
export async function choicesOf(env, addr) {
  const marks = APP_ROWS.map(() => '?').join(', ');
  // Why (review of hr-31): each table on its own, a missing one read as empty, so a stop in mail_off still holds when mail_on is missing; any other error throws.
  const read = table => env.STATS.prepare(`SELECT list FROM ${table} WHERE addr = ? AND list IN (${marks})`).bind(addr, ...APP_ROWS).all()
    .catch(error => { if (/no such table/i.test(String(error?.message || error))) return {results: []}; throw error; });
  const [off, on] = await Promise.all([read('mail_off'), read('mail_on')]);
  const choices = {};
  for (const row of on.results || []) choices[row.list] = 'on';
  for (const row of off.results || []) choices[row.list] = 'off';   // a stop wins over a yes, as for the news
  return choices;
}

/** Stores the person's choice for one app row. False for an unknown row or `via`; throws if it cannot be written. */
export async function setChoice(env, addr, row, on, via, now = new Date()) {
  if (!APP_ROWS.includes(row) || !VIA.includes(via)) return false;
  const at = now.toISOString();
  await env.STATS.batch([
    env.STATS.prepare(`DELETE FROM ${on ? 'mail_off' : 'mail_on'} WHERE addr = ? AND list = ?`).bind(addr, row),
    on ? env.STATS.prepare('INSERT OR REPLACE INTO mail_on (addr, list, via, at) VALUES (?, ?, ?, ?)').bind(addr, row, via, at)
      : env.STATS.prepare('INSERT OR REPLACE INTO mail_off (addr, list, reason, at) VALUES (?, ?, ?, ?)').bind(addr, row, via, at),
  ]);
  return true;
}

/**
 * Why this app mail must not go to `addr`: 'person_off' (they turned this row off), 'choice_held' (their choices could not be read), or '' to go on. Never throws.
 * Why (the lesson of #442): a failed read sends less, never more than the person chose; a missing table (a migration that did not run) holds no choice (choicesOf).
 */
export async function choiceRefusal(env, addr, row) {
  if (!APP_ROWS.includes(row)) return '';
  try { return (await choicesOf(env, addr))[row] === 'off' ? 'person_off' : ''; } catch { return 'choice_held'; }
}

/** How many people turned each app row off: {row: n}. What Admin shows of people's choices (counts only). */
export async function offCounts(env) {
  const marks = APP_ROWS.map(() => '?').join(', ');
  const rows = (await env.STATS.prepare(`SELECT list, COUNT(*) AS n FROM mail_off WHERE list IN (${marks}) GROUP BY list`).bind(...APP_ROWS).all().catch(() => null))?.results || [];
  return Object.fromEntries(rows.map(row => [row.list, Number(row.n)]));
}
