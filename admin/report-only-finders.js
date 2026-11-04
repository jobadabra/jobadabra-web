// The report-only numbers that come from the self-healing snapshots (one row a day, admin/selfheal.js snapshots): what the layout, screenshot and interaction finders filed, and
// whether the planted bugs are still caught (owner, 2 Nov 2026: the Report only page). Same job shape as admin/nightly-summary.js, so the page draws them with the same renderer.
// A day with no snapshot is a grey cell, never a 0. Report only: nothing here blocks anything. Guard: test/unit/admin/report-only.test.js.
import {empty, newestWithValue} from './nightly-summary.js';

// Finder jobs: the detector name in the snapshot's periods.last7.byDetector → the id and title the page shows.
const FINDERS = [['finder-layout', 'Layout checks', 'Layout and DOM checks'], ['finder-review', 'AI screenshot review', 'AI screenshot review'], ['finder-interactions', 'Interaction probe', 'Interaction probe']];
const byDay = snapshots => new Map((snapshots || []).filter(item => item?.day).map(item => [item.day, item]));

// Real bugs (fixed or queued) the finder filed in the 7 days up to each day: one point per stored snapshot.
function finder(snapshots, days, [id, title, detector]) {
  const stored = byDay(snapshots), files = ['self-heal-stats.yml'];
  const series = days.map(day => {
    const row = stored.get(day)?.periods?.last7?.byDetector?.find(item => item.detector === detector);
    return row ? {day, value: (Number(row.fixed) || 0) + (Number(row.queued) || 0), ok: null} : {day, value: null, ok: null};
  });
  const last = newestWithValue(series);
  if (!last) return empty(id, title, files, 'no self-healing snapshot in the last 14 days');
  return {id, title, value: String(last.value), sub: `real bugs filed in the 7 days to ${last.day} (fixed + queued)`, status: 'none', bar: null, higherIsBetter: false, series, files};
}

// Planted UI bugs: how many of the planted bugs the Finder caught, per snapshot day.
function plantedUi(snapshots, days) {
  const stored = byDay(snapshots), files = ['self-heal-stats.yml'], title = 'Planted UI bugs';
  const series = days.map(day => { const recall = stored.get(day)?.recall; return recall?.planted ? {day, value: recall.caught / recall.planted, ok: !(recall.missed || []).length} : {day, value: null, ok: null}; });
  const last = newestWithValue(series);
  if (!last) return empty('planted-ui', title, files, 'no interactions night has measured it in the last 14 days');
  const recall = stored.get(last.day).recall;
  return {id: 'planted-ui', title, value: `${recall.caught}/${recall.planted}`, sub: `${recall.missed?.length ? `missed: ${recall.missed.join(', ')}` : 'every planted bug caught'} · ${last.day}`,
    status: recall.missed?.length ? 'warn' : 'good', bar: {value: 1, label: 'every planted bug caught'}, series, files};
}

// Planted code bugs (the mutation run): the share of planted code bugs a suite went red for.
function plantedCode(snapshots, days) {
  const stored = byDay(snapshots), files = ['mutation.yml'], title = 'Planted code bugs';
  const series = days.map(day => { const mutation = stored.get(day)?.quality?.mutation; return Number.isFinite(mutation?.rate) ? {day, value: mutation.rate / 100, ok: mutation.rate >= 100} : {day, value: null, ok: null}; });
  const last = newestWithValue(series);
  if (!last) return empty('planted-code', title, files, 'no planted-bug run in the last 14 days');
  return {id: 'planted-code', title, value: `${Math.round(last.value * 100)}%`, sub: `${stored.get(last.day).quality.mutation.note || 'share of planted code bugs caught'} · ${last.day}`,
    status: last.ok ? 'good' : 'warn', bar: {value: 1, label: 'every planted code bug caught'}, series, files};
}

/** The finder and planted-bug jobs for `days` (oldest first) from the self-healing snapshots (newest first, as admin/selfheal.js snapshots gives them; [] when unreadable). */
export const finderJobs = (snapshots, days) => [...FINDERS.map(item => finder(snapshots, days, item)), plantedUi(snapshots, days), plantedCode(snapshots, days)];
