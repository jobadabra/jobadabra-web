// Testing → Overview's map: each method's last 14 days, one cell per day (owner, 1 Nov 2026: "a graph summarizing better visually everything"). Built only from the rows
// admin/testing-overview-data.js already loaded: a workflow's newest runs (schedules snapshot), e2e runs per day and kind (e2e snapshot `days`), a suite's nights (`suiteNights`),
// integration's main runs. A day before the oldest stored run is "unknown" (the schedules snapshot keeps a workflow's newest 14 runs only), never "no run". Guard: test/unit/admin/testing-overview.test.js.
import {mainRuns} from './integration-page.js';

export const MAP_DAYS = 14;
const RUN_DOTS = 14;   // what the schedules collector keeps per workflow (shared/schedules-model.js RUN_DOTS)
const DONE = {success: 'green', failure: 'red', timed_out: 'red'};

/** The last `n` UTC days, oldest first. */
export const daysTo = (now, n = MAP_DAYS) => Array.from({length: n}, (_, i) => new Date(now.getTime() - (n - 1 - i) * 86400000).toISOString().slice(0, 10));

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

/** A card's days: [{day, state: green|red|none|unknown, greens, reds, url}] oldest first. A day is red when any run of any of its lines was red that day; unknown when no line's data reaches it (before its oldest stored run, or after its snapshot was read: PR #260, Gitar). */
export function historyOf(data, lines, now = data.now) {
  const sources = lines.map(line => runsOf(data, line)).filter(Boolean);
  return daysTo(now).map(day => {
    const covered = sources.filter(source => (!source.from || day >= source.from) && (!source.to || day <= source.to));
    const runs = covered.flatMap(source => source.runs.filter(run => run.day === day));
    const reds = runs.filter(run => run.state === 'red').reduce((sum, run) => sum + (run.n || 1), 0), greens = runs.filter(run => run.state === 'green').reduce((sum, run) => sum + (run.n || 1), 0);
    const state = !covered.length ? 'unknown' : reds ? 'red' : greens ? 'green' : 'none';
    const pick = runs.find(run => run.state === state && run.url);
    return {day, state, greens, reds, url: pick?.url || '', note: runs.find(run => run.state === state && run.note)?.note || ''};
  });
}
