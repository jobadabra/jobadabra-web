// The nightly report-only numbers, one summary for every page that shows them (owner, 1 Nov 2026: "Fold into the Overview", and "it should also be present in Schedules"): per job, last
// night's key number and the last 14 nights against its bar. ONE module computes it from rows the site already keeps (the e2e snapshot row and agent_coding_days); the Testing Overview cards
// and the Testing → Scheduled rows only draw it, so there is no second reader of either table. Report only: no verdict here blocks anything, no AI, no new table. Guard: test/unit/admin/nightly-summary.test.js.
//
// A job = {id, title, value, sub, status: good|warn|bad|none, bar: {value, label}|null, series: [{day, value: number|null, ok: boolean|null}] (NIGHTS entries, oldest first), files: [workflow files it belongs to]}.
// `unit: 'count'` (optional) = whole things counted, drawn on a 0..3 floor scale, never as a rate even when every value is 0 or 1.
// What has no number yet says so (value '–' and the reason in `sub`); nothing here invents a night.
import {BARS, rateOf} from './e2e-quality.js';
import {readSnapshot} from './e2e-intel.js';
import {promptNightsOf} from './e2e-prompt.js';

export const NIGHTS = 14, DAY = 86400000;
const dayOf = value => new Date(value).toISOString().slice(0, 10);
const pct = value => `${Math.round(value * 100)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A UTC day in words for the page ("2026-11-05" → "5 Nov"); anything else comes back unchanged. */
export const dayWords = day => { const match = /^\d{4}-(\d\d)-(\d\d)$/.exec(String(day)); return match && MONTHS[+match[1] - 1] ? `${+match[2]} ${MONTHS[+match[1] - 1]}` : String(day); };
const shortName = suite => String(suite).replace(/-\d+of\d+$/, '');
const isNight = row => ['nightly', 'scheduled'].includes(row.kind);
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) || {} : value || {}; } catch { return {}; } };

/** The last `NIGHTS` UTC days ending today, oldest first. */
export const lastDays = (now = new Date(), n = NIGHTS) => Array.from({length: n}, (_, i) => dayOf(now.getTime() - (n - 1 - i) * DAY));
export const empty = (id, title, files, why, bar = null) => ({id, title, value: '–', sub: why, status: 'none', bar, series: [], files});
export const newestWithValue = series => [...series].reverse().find(point => point.value != null || point.ok != null) || null;

// ---- Quality AI: the same rate and bars the e2e page draws (rateOf), one point per night ----
function qualityAi(snapshot, days) {
  const files = ['e2e.yml'], title = 'Quality AI', bar = {value: BARS.agree, label: `≥ ${BARS.agree * 100}% same score twice (within ${BARS.within})`};
  const nights = (snapshot?.quality || []).filter(night => night.pairs > 0);
  if (!nights.length) return empty('quality-ai', title, files, 'no live quality night stored yet', bar);
  const byDay = new Map();
  for (const night of nights) if (!byDay.has(night.day) || night.runId > byDay.get(night.day).runId) byDay.set(night.day, night);   // the night's newest run
  const series = days.map(day => { const night = byDay.get(day); return night ? {day, value: night.within8 / night.pairs, ok: night.within8 / night.pairs >= BARS.agree} : {day, value: null, ok: null}; });
  const last = newestWithValue(series), rate = rateOf(nights);
  // Why (1 Nov 2026, Gitar on #266): the snapshot keeps 30 days of nights but the trend shows 14; with none inside the 14 there is no last night, and this used to throw (a 500 on both pages).
  if (!last) return empty('quality-ai', title, files, 'no live quality night in the last 14 nights', bar);
  return {id: 'quality-ai', title, value: pct(last.value), sub: `${pct(rate.agree)} over the last ${rate.pairs} pairs · ${rate.jumps == null ? '–' : pct(rate.jumps)} jumps${rate.factsTotal ? ` · facts ${pct(rate.factsExact / rate.factsTotal)} exact` : ''}`,
    status: rate.agreeOk && rate.jumpsOk ? 'good' : 'bad', bar, series, files};
}

// ---- Prompt cases: right of total, newest night that has a replay; nothing it must reach, only "nothing got worse" ----
function promptCases(snapshot, days) {
  const files = ['prompt-cases-night.yml'], title = 'Prompt cases', bar = {value: null, label: 'nothing got worse than last night'};
  const byDay = new Map();
  for (const night of promptNightsOf(snapshot).reverse()) if (days.includes(night.day)) byDay.set(night.day, night.promptCases);   // only the nights the trend shows
  if (!byDay.size) return empty('prompt-cases', title, files, 'no night replayed in the last 14 nights', bar);
  const series = days.map(day => { const p = byDay.get(day); return p && p.total ? {day, value: p.right / p.total, ok: p.status === 'not-asked' ? null : p.flipped === 0} : {day, value: null, ok: null}; });
  const last = [...byDay].at(-1)[1], when = [...byDay].at(-1)[0];
  const detail = last.status === 'not-asked' ? 'the broker said no; last baseline kept' : last.status === 'carried' ? 'no prompt changed, nothing asked' : `${last.noise} model noise · ${last.unconfirmed} unconfirmed · ${last.calls} calls`;
  return {id: 'prompt-cases', title, value: `${last.right}/${last.total}`, sub: `${last.flipped ? `${last.flipped} got worse` : 'none got worse'} · ${detail} (${dayWords(when)})`,
    status: last.flipped ? 'bad' : last.status === 'not-asked' ? 'warn' : 'good', bar, series, files};
}

// ---- A night suite from suiteNights: one point a day, the worst platform/run of that day (as the Grey card does) ----
function nightsOfSuite(snapshot, suite, days) {
  const byDay = new Map();
  for (const row of snapshot?.suiteNights || []) {
    if (shortName(row.suite) !== suite || !isNight(row) || !days.includes(row.day)) continue;
    const night = byDay.get(row.day) || {green: null, rates: {}};
    if (row.green === false) night.green = false; else if (row.green === true && night.green === null) night.green = true;
    for (const [name, value] of Object.entries(row.rates || {})) night.rates[name] = Math.min(night.rates[name] ?? 1, value);   // the lowest measured rate of the night
    byDay.set(row.day, night);
  }
  return byDay;
}
const worded = green => (green ? 'green' : 'red');

// Interactions: the finder's recall of planted bugs is the key number (does the finder still see what is planted); controls not flagged and pages that held still go beside it.
function interactions(snapshot, days) {
  const files = ['e2e.yml'], title = 'Interactions', byDay = nightsOfSuite(snapshot, 'interactions', days);
  if (!byDay.size) return empty('interactions', title, files, 'no night stored yet');
  const hasRates = [...byDay.values()].some(night => night.rates.recall != null);
  const series = days.map(day => { const night = byDay.get(day); return night ? {day, value: night.rates.recall ?? null, ok: night.green} : {day, value: null, ok: null}; });
  const last = newestWithValue(series), night = byDay.get(last.day);
  const parts = [night.rates.clean != null && `${pct(night.rates.clean)} controls clean`, night.rates.still != null && `${pct(night.rates.still)} pages still`].filter(Boolean);
  return {id: 'interactions', title, value: night.rates.recall != null ? pct(night.rates.recall) : worded(night.green), status: night.green === false ? 'bad' : night.green ? 'good' : 'none', bar: null, series, files,
    sub: `${night.rates.recall != null ? 'recall of planted bugs' : hasRates ? 'night without rates' : 'rates start with the next night'}${parts.length ? ` · ${parts.join(' · ')}` : ''} · ${dayWords(last.day)}`};
}

// Wander and the real-Notion suite print no number: a 14-night green/red trend.
function greenRed(snapshot, suite, title, days) {
  const files = ['e2e.yml'], byDay = nightsOfSuite(snapshot, suite, days);
  if (!byDay.size) return empty(suite, title, files, 'no night stored yet');
  const series = days.map(day => ({day, value: null, ok: byDay.has(day) ? byDay.get(day).green : null}));
  const last = newestWithValue(series), seen = series.filter(point => point.ok != null);
  return {id: suite, title, value: worded(last.ok), sub: `${seen.filter(point => point.ok).length} of ${seen.length} nights green · ${dayWords(last.day)}`, status: last.ok ? 'good' : last.ok === false ? 'bad' : 'none', bar: null, series, files};
}

// ---- Wall clocks: minutes from start to end of a run, per run, per day (e2e_runs.minutes summed in the snapshot's days rows) ----
function wallClock(snapshot, id, title, kinds, files, days) {
  const perDay = new Map();
  for (const row of snapshot?.days || []) {
    if (!kinds.includes(row.kind || 'beta') || !days.includes(row.day) || !(row.runs > 0) || typeof row.wallMin !== 'number') continue;
    const at = perDay.get(row.day) || {runs: 0, min: 0};
    at.runs += row.runs; at.min += row.wallMin; perDay.set(row.day, at);
  }
  if (!perDay.size) return empty(id, title, files, 'wall time per run is stored from the next collector pass');
  const series = days.map(day => { const at = perDay.get(day); return at ? {day, value: Math.round((at.min / at.runs) * 10) / 10, ok: null} : {day, value: null, ok: null}; });
  const last = newestWithValue(series), values = series.filter(point => point.value != null).map(point => point.value).sort((a, b) => a - b);
  const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  return {id, title, value: `${last.value} min`, sub: `per run on ${dayWords(last.day)} · median of ${values.length} day${values.length === 1 ? '' : 's'}: ${Math.round(median * 10) / 10} min`, status: 'none',
    bar: null, higherIsBetter: false, median, series, files};
}

// ---- Agent coding: areas with 3+ fix PRs in the 7 days up to each day (the going-in-circles rule, as admin/headlines-ops.js counts it) ----
function agentCoding(rows, days) {
  const files = ['agent-coding-stats.yml'], title = 'Agent coding', bar = {value: 0, label: 'no area with 3+ fix PRs in 7 days'};
  const ci = new Map();
  for (const row of rows || []) if (row.kind === 'ci') ci.set(row.day, json(row.card).fixPrs || {});
  if (!ci.size) return empty('agent-coding', title, files, 'the first daily upload fills it', bar);
  const circles = day => {
    const areas = {};
    for (let back = 0; back < 7; back++) for (const [area, n] of Object.entries(ci.get(dayOf(Date.parse(day) - back * DAY)) || {})) areas[area] = (areas[area] || 0) + (Number(n) || 0);
    return Object.values(areas).filter(n => n >= 3).length;
  };
  const series = days.map(day => (ci.has(day) ? {day, value: circles(day), ok: circles(day) === 0} : {day, value: null, ok: null}));
  const last = newestWithValue(series);
  if (!last) return empty('agent-coding', title, files, 'no daily upload in the last 14 days', bar);   // rows are loaded for 21 days (the 7-day window); none inside the 14 shown is not a number
  return {id: 'agent-coding', title, value: String(last.value), sub: `areas going in circles on ${dayWords(last.day)}`, status: last.value ? 'bad' : 'good', bar, unit: 'count', higherIsBetter: false, series, files};
}

/**
 * The summary of every nightly report-only job.
 * @param {{snapshot: object|null, agentRows?: {kind: string, day: string, card: string|object}[]}} input the e2e snapshot row and the agent_coding_days rows of the last 21 days
 * @param {Date} [now]
 * @param {number} [nights] how many days the series cover (default 14; the product-quality board asks for 30, the length the snapshot keeps)
 * @returns {{at: string, days: string[], jobs: object[]}}
 */
export function nightlySummary({snapshot = null, agentRows = []} = {}, now = new Date(), nights = NIGHTS) {
  const days = lastDays(now, nights);
  return {at: now.toISOString(), days, jobs: [qualityAi(snapshot, days), promptCases(snapshot, days), interactions(snapshot, days), greenRed(snapshot, 'wander', 'Wander', days),
    greenRed(snapshot, 'notion-real', 'Real Notion', days), agentCoding(agentRows, days),
    wallClock(snapshot, 'beta-clock', 'Beta wall clock', ['beta'], ['desktop.yml'], days), wallClock(snapshot, 'night-clock', 'Night wall clock', ['nightly', 'scheduled'], ['e2e.yml'], days)]};
}

// The Testing Overview card (admin/testing-overview-methods.js id) each job is drawn on; agent coding is not a testing method, so it shows on the Scheduled row only.
const CARD_JOBS = {e2e: ['beta-clock', 'night-clock', 'notion-real'], interactions: ['interactions'], wander: ['wander'], 'quality-ai': ['quality-ai', 'prompt-cases']};
/** The jobs of a summary that sit on a Testing Overview card. */
export const summaryForCard = (summary, cardId) => (summary?.jobs || []).filter(job => (CARD_JOBS[cardId] || []).includes(job.id));

/** The jobs of a summary that belong to a workflow file (the Scheduled page's row for `file`). */
export const summaryFor = (summary, file) => (summary?.jobs || []).filter(job => job.files.includes(file));

/** The ONE reader: the e2e snapshot row and the agent-coding rows, each failing to nothing; the pages call this once and draw the result. */
export async function loadNightlySummary(env, now = new Date(), nights = NIGHTS) {
  const since = dayOf(now.getTime() - (nights + 6) * DAY);   // the 7-day window of the oldest night shown (14 nights: 20 days, as before)
  let agentRows = [];
  try { agentRows = env.STATS ? (await env.STATS.prepare("SELECT kind, day, card FROM agent_coding_days WHERE kind = 'ci' AND day >= ? ORDER BY day").bind(since).all()).results || [] : []; } catch { agentRows = []; }
  return nightlySummary({snapshot: await readSnapshot(env.STATS), agentRows}, now, nights);
}
