// The ONE place a feedback's state changes (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md). The table ACTIONS is the design: an action not listed for the current state
// is refused (409). Every change is written with its log line; nothing else in the site updates `feedback.state` or `feedback.impact`. Guarded by test/shared/feedback-actions.test.js.
// Why (3 Nov 2026, owner: "offer some actions buttons for each feedback"): the list only grew; the owner needs to clear it, rate it and, later, answer the reporter.

export const STATES = ['new', 'dismissed', 'false_positive', 'deferred', 'ai_running', 'ai_pr', 'fixed'];
export const IMPACTS = ['high', 'medium', 'low'];
export const OPEN_STATES = ['new', 'ai_running', 'ai_pr'];   // the header's "open"

// action -> {from: states it may start in, to: the state it ends in (none = the state stays), note: 'required' | 'optional' | null}. Later PRs add fixed, defer and the AI actions here and nowhere else.
export const ACTIONS = {
  dismiss: {from: ['new'], to: 'dismissed'},
  false_positive: {from: ['new'], to: 'false_positive', note: 'required'},
  reopen: {from: ['dismissed', 'false_positive', 'deferred', 'fixed'], to: 'new'},
  delete: {from: ['new', 'dismissed', 'false_positive', 'deferred', 'ai_pr', 'fixed']},   // not while a run is going (ai_running)
  impact: {from: STATES},
};

/** The actions the card's menu offers for a state (the same table the server enforces). */
export const actionsFor = state => Object.keys(ACTIONS).filter(name => name !== 'impact' && ACTIONS[name].from.includes(state));

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
 * Applies one action by the owner. `input` = {ref, action, note?, impact?}; `who` is the log's 'owner (session)' | 'owner (key)'.
 * -> {ok: true, state, impact} | {ok: false, status, error}. The state change is a compare-and-set on the state read first (two clicks cannot both win) and is batched with its log line, which is written only when a row changed.
 * A delete removes the R2 files first (a failure there leaves the row, so it can be tried again), then the row; its log line keeps the ref and no text. `input.from` (optional) is the state the caller expects: any other state is a 409.
 */
export async function act(env, input, who, now = new Date()) {
  const {ref, action} = input || {}, spec = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!spec) return refused(400, 'Unknown action.');
  if (!/^[0-9a-f]{16}$/.test(String(ref))) return refused(400, 'Unknown feedback.');
  const row = await env.STATS.prepare('SELECT state, impact FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row) return refused(404, 'This feedback is gone.');
  if (!spec.from.includes(row.state)) return refused(409, `Can't ${action.replace('_', ' ')} a feedback that is ${row.state.replace('_', ' ')}.`);
  const at = now.toISOString();
  // The change and its log line go in one batch (one transaction on D1): the line is written only when the change touched a row, so a lost race leaves neither.
  const commit = async (update, detail) => {
    const done = await env.STATS.batch([update, env.STATS.prepare('INSERT INTO feedback_log (at, ref, who, action, detail) SELECT ?, ?, ?, ?, ? WHERE changes() > 0').bind(at, ref, who, action, detail.slice(0, 200))]);
    return (done[0]?.meta?.changes ?? done[0]?.changes ?? 0) > 0;
  };
  const raced = refused(409, 'Someone just changed this feedback. Reload the page.');
  if (input.from && input.from !== row.state) return raced;   // "Undo" names the state it undoes: a card that moved on is left alone
  if (action === 'impact') {
    const value = input.impact === '' || IMPACTS.includes(input.impact) ? input.impact : null;
    if (value === null) return refused(400, 'Impact is high, medium, low or none.');
    if (!await commit(env.STATS.prepare('UPDATE feedback SET impact = ? WHERE ref = ?').bind(value, ref), `${row.impact || 'unrated'} -> ${value || 'unrated'}`)) return raced;
    return {ok: true, state: row.state, impact: value};
  }
  if (action === 'delete') {
    try { await deleteFiles(env.FEEDBACK_FILES, ref); } catch (error) { console.log('feedback files not deleted', error.message); return refused(502, 'Could not delete its files. Nothing was removed; try again.'); }
    if (!await commit(env.STATS.prepare('DELETE FROM feedback WHERE ref = ? AND state = ?').bind(ref, row.state), `deleted (was ${row.state})`)) return raced;
    return {ok: true, state: null, impact: row.impact};
  }
  const note = clip(input.note, 300);
  if (spec.note === 'required' && !note) return refused(400, 'Say why in a few words.');
  if (!await commit(env.STATS.prepare('UPDATE feedback SET state = ?, state_at = ?, state_note = ? WHERE ref = ? AND state = ?').bind(spec.to, at, spec.note ? note : '', ref, row.state), `${row.state} -> ${spec.to}${note ? `: ${note}` : ''}`)) return raced;
  return {ok: true, state: spec.to, impact: row.impact};
}

/** The history lines of one feedback, newest first (what the card's "History" shows). */
export async function historyOf(db, ref, limit = 20) {
  return ((await db.prepare('SELECT at, who, action, detail FROM feedback_log WHERE ref = ? ORDER BY at DESC, rowid DESC LIMIT ?').bind(ref, limit).all()).results || []);
}
