// The nightly prompt-case replay per night, kept on its own (jobadabra-web#259): a night whose quality job did not score twice has no e2e_quality row, and its replay used to be lost with it.
// The collector (public tools/ci-intel/jobs/e2e-intel.mjs) sends `promptNights: [{runId, day, promptCases}]` beside `quality`; the snapshot hands them back as `promptNights`, newest first.
// Guard: test/unit/admin/e2e/e2e-prompt.test.js.
import {cleanPrompt} from './e2e-quality.js';

const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

/** One night's replay as the collector sends it -> {runId, day, promptCases}; null when the run id, the day or the counts do not hold up (counts that do not add up are dropped, not repaired). */
export function cleanPromptNight(row) {
  const promptCases = cleanPrompt(row?.promptCases);
  return Number.isInteger(row?.runId) && row.runId > 0 && isDay(row.day) && promptCases ? {runId: row.runId, day: row.day, promptCases} : null;
}

/** A stored json back to counts; a damaged one reads as none. */
export function promptCasesOfRow(text) { try { return text ? cleanPrompt(JSON.parse(text)) : null; } catch { return null; } }

/**
 * Every night that has a replay, newest first, from a snapshot. The snapshot's own `promptNights` wins; a snapshot stored before that key existed (until the next hourly write rebuilds it)
 * still carries the replay on its quality rows, which is read instead. Why (#259): the replay no longer depends on a quality row, so readers must not look for it only there.
 * @param {{promptNights?: {runId: number, day: string, promptCases: object}[], quality?: {runId: number, day: string, promptCases?: object|null}[]}} snapshot
 * @returns {{runId: number, day: string, promptCases: object}[]}
 */
export function promptNightsOf(snapshot) {
  const rows = Array.isArray(snapshot?.promptNights) ? snapshot.promptNights : (snapshot?.quality || []).filter(night => night.promptCases);
  return rows.filter(row => row?.promptCases).sort((a, b) => b.runId - a.runId);
}
