// The ONE place a feedback's state changes (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md). The table ACTIONS is the design: an action not listed for the current state
// is refused (409). Every change is written with its log line; nothing else in the site updates `feedback.state` or `feedback.impact`. Guarded by test/unit/shared/feedback/feedback-actions.test.js.
// Why (3 Nov 2026, owner: "offer some actions buttons for each feedback"): the list only grew; the owner needs to clear it, rate it and, later, answer the reporter.

import {aiClosedColumns, aiColumns, aiEndColumns, aiGate, aiGuard, aiMergedColumns, aiPrColumns} from './feedback-ai.js';
import {deferColumns, fixedColumns, releasedColumns, tellOnce} from './feedback-reply.js';

export const STATES = ['new', 'dismissed', 'false_positive', 'deferred', 'ai_running', 'ai_pr', 'fixed', 'released'];
export const IMPACTS = ['high', 'medium', 'low'];
export const OPEN_STATES = ['new', 'ai_running', 'ai_pr'];   // the header's "open"

// action -> {from: states it may start in, to: the state it ends in (none = the state stays), note: 'required' | 'optional' | null}. Later PRs add fixed, defer and the AI actions here and nowhere else.
export const ACTIONS = {
  fixed: {from: ['new', 'deferred', 'ai_pr'], to: 'fixed', form: fixedColumns},   // the owner's words and links: shared/feedback-reply.js
  released: {from: ['fixed'], to: 'released', form: releasedColumns},   // the fix shipped: the owner's "Mark as released" (a release call does the same for the cards it finds)
  defer: {from: ['new'], to: 'deferred', form: deferColumns},
  ai: {from: ['new', 'deferred'], to: 'ai_running', form: aiColumns},   // "Send to AI": one CI run, a draft PR (shared/feedback-ai.js)
  // The run's own steps, never in the owner's menu and never through the owner's route: admin/feedback-ai.js calls them after checking GitHub's run token (`internal`).
  ai_pr: {from: ['ai_running'], to: 'ai_pr', form: aiPrColumns, internal: true},
  ai_none: {from: ['ai_running'], to: 'new', form: aiEndColumns(false), internal: true},
  ai_failed: {from: ['ai_running'], to: 'new', form: aiEndColumns(true), internal: true},
  ai_merged: {from: ['ai_pr'], to: 'fixed', form: aiMergedColumns, internal: true},
  ai_closed: {from: ['ai_pr'], to: 'new', form: aiClosedColumns, internal: true},
  dismiss: {from: ['new'], to: 'dismissed'},
  false_positive: {from: ['new'], to: 'false_positive', note: 'required'},
  reopen: {from: ['dismissed', 'false_positive', 'deferred', 'fixed', 'released', 'ai_pr'], to: 'new'},
  delete: {from: ['new', 'dismissed', 'false_positive', 'deferred', 'ai_pr', 'fixed', 'released']},   // not while a run is going (ai_running)
  impact: {from: STATES},
};

/** The actions the card's menu offers for a state (the same table the server enforces). */
export const actionsFor = state => Object.keys(ACTIONS).filter(name => name !== 'impact' && !ACTIONS[name].internal && ACTIONS[name].from.includes(state));

const refused = (status, error) => ({ok: false, status, error});
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Every R2 object under a feedback's folder, deleted. -> how many. */
async function deleteFiles(bucket, ref) {
  if (!bucket) return 0;
  if (!/^[0-9a-f]{16}$/.test(String(ref))) throw new Error('deleteFiles: not a feedback ref');   // the destructive work checks its own input, not only its caller
  let cursor, gone = 0;
  do {
    const page = await bucket.list({prefix: `feedback/${ref}/`, cursor});
    const keys = page.objects.map(object => object.key);
    if (keys.length) { await bucket.delete(keys); gone += keys.length; }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return gone;
}

/**
 * Applies one action by the owner. `input` = {ref, action, note?, impact?}; `who` is the log's 'owner (session)' | 'owner (key)'. `opts`: {trusted: the caller proved it is the AI run (admin/feedback-ai.js), the only
 * way to apply an `internal` action; run: {state_at, ai_run}, the exact attempt a trusted failure may end;
 * start: (ref) => Promise, starts the CI run for `ai` (absent = Send to AI is not set up)}.
 * -> {ok: true, state, impact} | {ok: false, status, error}. The state change is a compare-and-set on the state read first (two clicks cannot both win) and is batched with its log line, which is written only when a row changed.
 * A delete removes the R2 files first (a failure there leaves the row, so it can be tried again), then the row; its log line keeps the ref and no text. `input.from` (optional) is the state the caller expects: any other state is a 409.
 */
export async function act(env, input, who, now = new Date(), opts = {}) {
  const {ref, action} = input || {}, spec = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!spec || (spec.internal && !opts.trusted)) return refused(400, 'Unknown action.');
  if (!/^[0-9a-f]{16}$/.test(String(ref))) return refused(400, 'Unknown feedback.');
  const row = await env.STATS.prepare('SELECT state, impact, impact_ai, told FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row) return refused(404, 'This feedback is gone.');
  if (!spec.from.includes(row.state)) return refused(409, `Can't ${action.replace('_', ' ')} a feedback that is ${row.state.replace('_', ' ')}.`);
  const at = now.toISOString();
  // The change and its log line go in one batch (one transaction on D1): the line is written only when the change touched a row, so a lost race leaves neither.
  const commit = async (update, detail) => {
    const done = await env.STATS.batch([update, env.STATS.prepare('INSERT INTO feedback_log (at, ref, who, action, detail) SELECT ?, ?, ?, ?, ? WHERE changes() > 0').bind(at, ref, who, action, detail.slice(0, 200))]);
    return (done[0]?.meta?.changes ?? done[0]?.changes ?? 0) > 0;
  };
  const raced = refused(409, 'Someone just changed this feedback. Reload the page.');
  if (action === 'ai') {
    if (!opts.start) return refused(503, 'Send to AI is not set up on this site (the dispatch token).');
    const gate = await aiGate(env.STATS, now);   // one at a time and the daily cap: checked before anything changes
    if (!gate.ok) return refused(gate.status, gate.error);
  }
  if (input.from && input.from !== row.state) return raced;   // "Undo" names the state it undoes: a card that moved on is left alone
  if (action === 'impact') {
    const value = input.impact === '' || IMPACTS.includes(input.impact) ? input.impact : null;
    if (value === null) return refused(400, 'Impact is high, medium, low or none.');
    if (!await commit(env.STATS.prepare('UPDATE feedback SET impact = ? WHERE ref = ?').bind(value, ref), `${row.impact || 'unrated'} -> ${value || 'unrated'}${row.impact_ai ? ` (AI said ${row.impact_ai})` : ''}`)) return raced;
    return {ok: true, state: row.state, impact: value};
  }
  if (action === 'delete') {
    try { await deleteFiles(env.FEEDBACK_FILES, ref); } catch (error) { console.log('feedback files not deleted', error.message); return refused(502, 'Could not delete its files. Nothing was removed; try again.'); }
    if (!await commit(env.STATS.prepare('DELETE FROM feedback WHERE ref = ? AND state = ?').bind(ref, row.state), `deleted (was ${row.state})`)) return raced;
    return {ok: true, state: null, impact: row.impact};
  }
  const note = clip(input.note, 300);
  if (spec.note === 'required' && !note) return refused(400, 'Say why in a few words.');
  const form = spec.form ? spec.form(input, row) : {columns: {}};   // Fixed, Defer and Released carry the owner's words, links and version; a bad one is refused before anything changes
  if (form.error) return refused(400, form.error);
  const columns = {...form.columns};
  if (action === 'defer' && IMPACTS.includes(input.impact) && !row.impact) columns.impact = input.impact;   // the Defer form rates it in the same step
  if (action === 'reopen') columns.told = ['pending', 'telling'].includes(row.told) ? '' : row.told;   // a fix that waited for a release (or was being told) stops; what was already told stays
  const keys = Object.keys(columns), sets = keys.map(key => `, ${key} = ?`).join('');
  const detail = `${row.state} -> ${spec.to}${note || form.detail ? `: ${note || form.detail}` : ''}${form.tell ? ` (tell: ${form.tell})` : ''}`;
  // Why (5b code review, 3 Nov 2026): "Mark as released" decides whether to tell from the `told` it read, so the write also checks it: a card reopened and re-fixed with "never tell" in between is not told.
  const caps = action === 'ai' ? aiGuard(now) : null;   // the caps are part of the write itself, so two clicks at once cannot both pass
  let guard = action === 'released' ? ' AND told = ?' : caps ? caps.sql : '';
  const guardArgs = action === 'released' ? [row.told] : caps ? caps.args : [];
  // Why (5 Nov 2026, owner): a failed GitHub run restores retry, but a late check or callback must never reset a newer attempt.
  if (opts.trusted && opts.run && action === 'ai_failed') {
    guard += ' AND state_at = ? AND ai_run = ?';
    guardArgs.push(opts.run.state_at, opts.run.ai_run);
  }
  if (!await commit(env.STATS.prepare(`UPDATE feedback SET state = ?, state_at = ?, state_note = ?${sets} WHERE ref = ? AND state = ?${guard}`).bind(spec.to, at, form.stateNote ?? (spec.note ? note : ''), ...keys.map(key => columns[key]), ref, row.state, ...guardArgs), detail)) return raced;
  if (action === 'ai') {   // the card is ai_running and logged; now the run. A start that fails sends the card straight back to new with the reason (never a card stuck "running").
    try { await opts.start(ref); } catch (error) {
      await act(env, {ref, action: 'ai_failed', why: `could not start the run: ${String(error.message || error).slice(0, 120)}`}, 'system', now, {trusted: true});
      return refused(502, 'Could not start the AI run. The card is back to new; no AI was used (the click still counts toward the daily limit).');
    }
  }
  const told = form.tell === 'now' ? await tellOnce(env, ref, now, 'owner (told)') : undefined;   // after the change is saved: a failing mail never undoes it
  return {ok: true, state: spec.to, impact: columns.impact ?? row.impact, ...(told !== undefined ? {told} : {})};
}

/** The history lines of one feedback, newest first (what the card's "History" shows). */
export async function historyOf(db, ref, limit = 20) {
  return ((await db.prepare('SELECT at, who, action, detail FROM feedback_log WHERE ref = ? ORDER BY at DESC, rowid DESC LIMIT ?').bind(ref, limit).all()).results || []);
}
