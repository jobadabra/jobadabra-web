// Testing → Overview's map: each method's last 14 days, one cell per day (owner, 1 Nov 2026: "a graph summarizing better visually everything"). Built only from the rows
// admin/testing-overview-data.js already loaded: a workflow's newest runs (schedules snapshot), e2e runs per day and kind (e2e snapshot `days`), a suite's nights (`suiteNights`),
// integration's main runs. A day before the oldest stored run is "unknown" (the schedules snapshot keeps a workflow's newest 14 runs only), never "no run". Guard: test/unit/admin/testing-overview.test.js.
import {mainRuns} from './integration-page.js';

export const MAP_DAYS = 14;
const RUN_DOTS = 14;   // what the schedules collector keeps per workflow (shared/schedules-model.js RUN_DOTS)
const DONE = {success: 'green', failure: 'red', timed_out: 'red'};

/** The last `n` UTC days, oldest first. */
export const daysTo = (now, n = MAP_DAYS) => Array.from({length: n}, (_, i) => new Date(now.getTime() - (n - 1 - i) * 86400000).toISOString().slice(0, 10));

/** The one rule for a day's cell, used by every row: green above 98% green runs (exactly 98% is amber), amber from 80% to 98%, red below 80%; a day with one run keeps green/red; none without a run. `pct` is the share as a whole number, with one decimal (rounded down) only where the whole number would sit on a threshold (97.99 reads 97.9, not 98). Why (12 Nov 2026, owner: "why is always red in Admin", then "green only if bigger than 98%"): main runs e2e 25-110 times a day, so "any red run paints the day red" was red on all 14 days; the 80% amber bound is the coordinator's proposal, to be confirmed. */
export function dayShare(greens, reds) {
  const total = greens + reds;
  if (!total) return {state: 'none', pct: null};
  const share = 100 * greens / total, whole = Math.round(share);
  const state = total === 1 ? (greens ? 'green' : 'red') : share > 98 ? 'green' : share >= 80 ? 'amber' : 'red';
  return {state, pct: [80, 98].includes(whole) && share !== whole ? (Math.floor(share * 10) / 10).toFixed(1) : String(whole)};
}

const dayOf = at => String(at || '').slice(0, 10);   // a snapshot's read day: later days are not stored yet ('' = unknown, treated as covered)

// One line's runs as [{day, state, url}], the first day its source covers ('' = the whole window) and the last (`to`: the day its snapshot was read; '' = unknown).
function runsOf(data, line) {
  const last = line.last || {};
  if (last.none) return null;
  if (last.e2e) {
    if (!data.e2e) return null;
    const rows = (data.e2e.days || []).filter(row => last.e2e.includes(row.kind));
    return {from: '', to: dayOf(data.e2e.at), runs: rows.flatMap(row => [...(row.reds ? [{day: row.day, state: 'red', n: row.reds}] : []), ...(row.greens ? [{day: row.day, state: 'green', n: row.greens}] : [])])};
  }
  if (last.suite) {
    if (!data.e2e) return null;
    return {from: '', to: dayOf(data.e2e.at), runs: (data.e2e.suiteNights || []).filter(row => row.suite === last.suite).map(row => ({day: row.day, state: row.green ? 'green' : 'red', url: `https://github.com/${data.repo}/actions/runs/${row.runId}`}))};
  }
  if (last.synthetic) {   // readDays: one state per UTC day, already ending today (shared/synthetic.js); red = a probe had 2 reds in a row, none = no round stored that day
    if (!data.syntheticDays) return null;
    const note = {green: 'rounds ran, no probe down', red: 'a probe was down (2 reds in a row)'};
    return {from: '', to: '', runs: data.syntheticDays.filter(item => note[item.state]).map(item => ({day: item.day, state: item.state, note: note[item.state]}))};
  }
  if (last.integration) {
    if (!data.integration) return null;
    return {from: '', to: dayOf(data.integration.at), runs: mainRuns(data.integration, '30d', data.now).runs.map(run => ({day: run.day, state: run.green ? 'green' : 'red', url: `https://github.com/${data.repo}/actions/runs/${run.runId}`}))};
  }
  const job = line.wf && (data.schedules?.jobs || []).find(item => item.file === line.wf && item.repo === data.repo);
  if (!job) return null;
  const recent = job.recent || [], oldest = recent.at(-1)?.at?.slice(0, 10) || '';
  return {from: recent.length >= RUN_DOTS ? oldest : '', to: dayOf(data.schedules.at), runs: recent.filter(run => DONE[run.conclusion]).map(run => ({day: String(run.at).slice(0, 10), state: DONE[run.conclusion], url: run.url || ''}))};
}

/** A card's days: [{day, state: green|amber|red|none|unknown, greens, reds, pct, url}] oldest first. A day's state is its share of green runs across all its lines (`dayShare`); unknown when no line's data reaches it (before its oldest stored run, or after its snapshot was read: PR #260, Gitar). */
export function historyOf(data, lines, now = data.now) {
  const sources = lines.map(line => runsOf(data, line)).filter(Boolean);
  return daysTo(now).map(day => {
    const covered = sources.filter(source => (!source.from || day >= source.from) && (!source.to || day <= source.to));
    const runs = covered.flatMap(source => source.runs.filter(run => run.day === day));
    const reds = runs.filter(run => run.state === 'red').reduce((sum, run) => sum + (run.n || 1), 0), greens = runs.filter(run => run.state === 'green').reduce((sum, run) => sum + (run.n || 1), 0);
    const {state, pct} = covered.length ? dayShare(greens, reds) : {state: 'unknown', pct: null};
    const pick = runs.find(run => run.state === 'red' && run.url) || runs.find(run => run.url);   // click a cell: the newest red run of the day, else the newest run
    return {day, state, greens, reds, pct, url: pick?.url || '', note: runs.find(run => run.state === state && run.note)?.note || ''};
  });
}
