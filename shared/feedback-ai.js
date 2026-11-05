// Send to AI (spec docs/superpowers/specs/2026-11-03-feedback-actions-design.md, PR 7/7): one click on a feedback starts one CI run (feedback-ai.yml in the public repo) that ends in a DRAFT PR the owner reviews.
// This file holds what the site decides: the caps, the columns each step writes, the dispatch and the brief the run reads. The state changes themselves are rows of shared/feedback-actions.js; the CI-facing
// routes are admin/feedback-ai.js. Guarded by test/unit/shared/feedback/feedback-ai.test.js.
// Why (3 Nov 2026, owner: "send it to a claude session (on the CI using the ai-broker, that the outcome should be a PR with the fix)"; first live run on one feedback he picks): it runs only on his click,
// at most 3 a day and 1 at a time, never merges and never pushes to main; the UI Fixer (scheduled, many findings) stays OFF (owner, 25 Oct 2026).
import {releasePr} from './feedback-reply.js';
import {TEXT_FILES} from './feedback.js';

export const AUDIENCE = 'jobadabra-feedback';
export const WORKFLOW = 'feedback-ai.yml';
/** The AI fixer's workflow (public repo): trusted for the brief and for the pr/none/failed reports like WORKFLOW, never for merged/closed. Why (5 Nov 2026, owner: "Button starts the new agent"; plan ci-agent-until-green, web 4/5): the first card run of ai-fixer.yml got HTTP 401 because only WORKFLOW was trusted. */
export const FIXER_WORKFLOW = 'ai-fixer.yml';
/** The file that tells the site an fd-ai/ pull request was merged or closed (pull_request_target), apart so a normal PR's close draws one row (jobadabra plan 2026-11-05-check-names, 3/4). */
export const CLOSE_WORKFLOW = 'feedback-ai-closed.yml';
export const DAILY_RUNS = 3;
export const STALE_MS = 60 * 60 * 1000;   // a run that has not answered in an hour is dead: the brief and the callbacks are only served inside this window
export const VERDICTS = ['fixed-already', 'not-reproducible', 'needs-human', 'false-positive', 'none'];
const INCLUDABLE = ['logs', 'page', 'profile'];
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The columns the Send to AI form sets: what the brief carries. Logs and screen data are on by default, the profile snapshot only when the owner ticks it for this run (`include: {logs, page, profile}`). */
export function aiColumns(input) {
  const asked = input.include && typeof input.include === 'object' ? input.include : {};
  const chosen = INCLUDABLE.filter(kind => (kind === 'profile' ? asked.profile === true : asked[kind] !== false));
  return {columns: {ai_include: chosen.join(','), ai_run: '', ai_run_url: ''}, detail: chosen.length ? `with ${chosen.join(', ')}` : 'words only'};
}

/** The run opened its draft PR: `pr` must be a pull request of the public repo (the same link a release matches by number). */
export function aiPrColumns(input) {
  const pr = clip(input.pr, 400);
  if (!releasePr(pr)) return {error: 'pr must be a pull request of the public repo.'};
  return {columns: {pr_url: pr}, detail: pr.split('/').pop() ? `PR #${pr.split('/').pop()}` : ''};
}

/** The run ended without a PR: a verdict word and the AI's reason (`none`/`failed`), or the run broke (`failed`). The card goes back to new and shows "🤖 <verdict>: <why>". */
export const aiEndColumns = failed => input => {
  const why = clip(input.why, 240), verdict = failed ? 'failed' : (VERDICTS.includes(input.verdict) ? input.verdict : 'none');
  if (failed && !why) return {error: 'say why the run failed.'};
  return {columns: {ai_run: '', ai_run_url: ''}, stateNote: `🤖 ${verdict}${why ? `: ${why}` : ''}`, detail: verdict};
};

/** The AI's PR was merged: the card is Fixed, waiting for the release that carries it (the owner can press "Mark as released" with a version to tell the reporter now). */
// Why (7/7 review, 3 Nov 2026): a card deferred first keeps the owner's deferral text in tell_message; the release would send it as the Fixed reply, so it is cleared with the rest of the tell settings.
export const aiMergedColumns = () => ({columns: {told: 'pending', tell_mode: 'release', tell_mail: 0, tell_message: '', seen_at: '', ai_run: '', ai_run_url: ''}, detail: 'merged'});

/** The PR was closed without a merge: back to new. */
export const aiClosedColumns = () => ({columns: {pr_url: '', ai_run: '', ai_run_url: ''}, stateNote: '🤖 its PR was closed without merging', detail: 'closed'});

/**
 * May a run start now? -> {ok: true} | {ok: false, status, error}. A card whose run has not answered in an hour is first sent back to new (a dead run never blocks the next one); then at most 1 run at a time
 * and DAILY_RUNS clicks since 00:00 UTC, counted from feedback_log (the rows `ai` writes).
 */
export async function aiGate(db, now = new Date()) {
  await expireStale(db, now);
  const running = await db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE state = 'ai_running'").first();
  if (running?.n) return {ok: false, status: 409, error: 'Another AI run is still going. One at a time: wait for it to finish.'};
  const since = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const today = await db.prepare("SELECT COUNT(*) AS n FROM feedback_log WHERE action = 'ai' AND at >= ?").bind(since).first();
  if ((today?.n || 0) >= DAILY_RUNS) return {ok: false, status: 429, error: `That is ${DAILY_RUNS} AI runs today: the limit. Try again tomorrow.`};
  return {ok: true};
}

/**
 * The two caps again, as the tail of the `ai` UPDATE's WHERE (Why, 7/7 review, 3 Nov 2026: aiGate reads, the UPDATE only compared this one card's state, so two quick clicks on two cards both passed).
 * The UPDATE and its log line are one batch, so a second click's count sees the first's line. -> {sql, args}
 */
export function aiGuard(now = new Date()) {
  return {sql: " AND NOT EXISTS (SELECT 1 FROM feedback WHERE state = 'ai_running') AND (SELECT COUNT(*) FROM feedback_log WHERE action = 'ai' AND at >= ?) < ?",
    args: [`${now.toISOString().slice(0, 10)}T00:00:00.000Z`, DAILY_RUNS]};
}

/** Sends every `ai_running` card that has not answered in STALE_MS back to new, with the reason and a log line (who: system). -> how many. */
export async function expireStale(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_MS).toISOString(), at = now.toISOString();
  const stale = (await db.prepare("SELECT ref FROM feedback WHERE state = 'ai_running' AND state_at < ?").bind(cutoff).all()).results || [];
  let moved = 0;
  for (const {ref} of stale) {
    const done = await db.batch([
      db.prepare("UPDATE feedback SET state = 'new', state_at = ?, state_note = ?, ai_run = '', ai_run_url = '' WHERE ref = ? AND state = 'ai_running' AND state_at < ?").bind(at, '🤖 failed: the run did not answer in an hour', ref, cutoff),
      db.prepare('INSERT INTO feedback_log (at, ref, who, action, detail) SELECT ?, ?, ?, ?, ? WHERE changes() > 0').bind(at, ref, 'system', 'ai_failed', 'no answer in an hour'),
    ]);
    if ((done[0]?.meta?.changes ?? done[0]?.changes ?? 0) > 0) moved++;
  }
  return moved;
}

/** Starts feedback-ai.yml in the public repo for this ref with the timers' token (the site token is never sent to the public repo). `dispatch` is the Worker's. Throws with the reason when it cannot start. */
export async function startRun(env, ref, dispatch) {
  if (!env.TIMERS_GITHUB_TOKEN) throw new Error('TIMERS_GITHUB_TOKEN is not set');
  if (!env.TIMERS_REPO) throw new Error('TIMERS_REPO is not set');
  await dispatch({...env, GITHUB_REPO: env.TIMERS_REPO, GITHUB_TOKEN: env.TIMERS_GITHUB_TOKEN}, {ref}, WORKFLOW);
}

/**
 * What the run reads (GET /api/feedback/brief): the words, version, platform, the screen name and the files the owner ticked for this run, as stored. NEVER the contact, the install id or the screenshot.
 * The run redacts it again with the app's own redactor before the AI sees a character (that code is in the public repo, where the run is). `ai_include` holds the ticks. -> the brief, or null.
 */
export async function briefOf(env, ref) {
  const row = await env.STATS.prepare('SELECT text, version, platform, screen, logs, page, profile, ai_include FROM feedback WHERE ref = ?').bind(ref).first();
  if (!row) return null;
  const include = String(row.ai_include).split(',').filter(Boolean), files = {};
  for (const kind of INCLUDABLE) {
    if (!include.includes(kind) || !row[kind] || !env.FEEDBACK_FILES) continue;
    const object = await env.FEEDBACK_FILES.get(`feedback/${ref}/${TEXT_FILES[kind].name}`);
    if (object) files[kind] = String(await new Response(object.body).text()).slice(0, TEXT_FILES[kind].max);
  }
  return {ref, text: row.text, version: row.version, platform: row.platform, screen: row.screen, files};
}
