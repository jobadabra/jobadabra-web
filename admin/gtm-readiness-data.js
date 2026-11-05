// GTM readiness numbers (owner, 1 Nov 2026: "how ready is GTM our app, from the critical journeys point of view. How stable are they"). Pure: the stored snapshot -> rows.
// Snapshot (admin/gtm-readiness.js reads it; admin/gtm-intel.js validates it): {at, journeys: [{id, name, tier}], tier1: [[runId, day, kind, os, journey, seen, failed, cut]],
// tier2: [{day, journey, tests, runs, red}]}. A Tier 1 row is one run on one OS for one journey; seen = registry steps found in the run's steps.json (0 with cut = 1: the suite died first). Guard: test/unit/admin/gtm-readiness.test.js.
// Why (1 Nov 2026): a run is red for a journey when a registry step FAILED, or the suite died before a registry step ran (cut); the e2e store keeps reds only, so greens come from the runs' steps.json.
const DAY = 86400000;
export const STABLE_RUNS = 10;   // stable = green in the last 10 runs of the journey (all OSes pooled by run) AND no red in the last QUIET_DAYS days; the owner may change both
export const QUIET_DAYS = 3;   // Why (1 Nov 2026 measurement): a journey that runs on every merge fills its last 10 runs in a day, so 10 greens alone forgot a red from yesterday
export const WINDOW_DAYS = 14;
const dayOf = date => date.toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const bad = row => row.failed > 0 || row.cut > 0;
const rowOf = ([runId, day, kind, os, journey, seen, failed, cut]) => ({runId, day, kind, os, journey, seen, failed, cut});

/**
 * One row per Tier 1 journey (kept steps "K" last).
 * Design (2 Nov 2026, owner: "last 20 runs shows all green, but earlier on the row shows not stable or different percentages... a bit contradictory"): ONE window per row, the last WINDOW_DAYS days.
 * `runs`, `share`, `os`, `days` (one cell per day), `lastBad` and `state` are all counted from the same runs of that window, so no cell can disagree with another; `why` names the rule behind the state.
 * @returns {{id, name, runs, reds, share, state, why, os, days: {day, runs, red, redRunId}[], lastBad, trend}}
 */
export function tier1Rows(snapshot, now = new Date()) {
  const from = dayOf(new Date(now.getTime() - (WINDOW_DAYS - 1) * DAY)), prevFrom = dayOf(new Date(now.getTime() - (2 * WINDOW_DAYS - 1) * DAY));
  const rows = [];
  for (const journey of (snapshot?.journeys || []).filter(item => item.tier === 1)) {
    const own = (snapshot.tier1 || []).map(rowOf).filter(row => row.journey === journey.id && (row.seen > 0 || bad(row)));   // a suite that died before any step (seen 0, cut) is a red run
    const byRun = new Map();
    for (const row of own) { const one = byRun.get(row.runId) || {runId: row.runId, day: row.day, kind: row.kind, bad: false}; one.bad = one.bad || bad(row); byRun.set(row.runId, one); }
    const runs = [...byRun.values()].sort((a, b) => b.runId - a.runId), current = runs.filter(run => run.day >= from), previous = runs.filter(run => run.day >= prevFrom && run.day < from);
    const share = list => (list.length ? list.filter(run => !run.bad).length / list.length : null);
    const os = Object.fromEntries(['mac', 'windows'].map(name => { const list = own.filter(row => row.os === name && row.day >= from); return [name, list.length ? {runs: list.length, green: list.filter(row => !bad(row)).length / list.length} : null]; }));
    const last = current.slice(0, STABLE_RUNS), lastBad = current.find(run => run.bad) || null, quietFrom = dayOf(new Date(now.getTime() - (QUIET_DAYS - 1) * DAY));
    const quiet = !(lastBad && lastBad.day >= quietFrom), state = !current.length ? 'none' : last.length < STABLE_RUNS ? 'few' : last.every(run => !run.bad) && quiet ? 'stable' : 'unstable';
    const why = state === 'none' ? '' : state === 'few' ? `${current.length} ${current.length === 1 ? 'run' : 'runs'}, needs ${STABLE_RUNS}` : state === 'stable' ? `last ${STABLE_RUNS} runs green, no red in ${QUIET_DAYS} days`
      : `red ${dayWords(lastBad.day)} · ${quiet ? `in the last ${STABLE_RUNS} runs` : `inside the ${QUIET_DAYS} quiet days`}`;
    const now14 = share(current), before14 = share(previous);
    const trend = now14 === null || before14 === null || current.length < 5 || previous.length < 5 ? null : Math.abs(now14 - before14) < 0.02 ? 'flat' : now14 > before14 ? 'up' : 'down';
    const days = Array.from({length: WINDOW_DAYS}, (_, i) => { const day = dayOf(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY)), mine = current.filter(run => run.day === day), red = mine.filter(run => run.bad);
      return {day, runs: mine.length, red: red.length, redRunId: red[0]?.runId ?? null}; });
    rows.push({id: journey.id, name: journey.name, runs: current.length, reds: current.filter(run => run.bad).length, share: now14, state, why, os, days, lastBad, trend});
  }
  return rows.sort((a, b) => (a.id === 'K') - (b.id === 'K') || Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** The one colour scale of the page (owner, 2 Nov 2026: "green only if 100%... everything below is orange/yellow/red"): 100% green, from 98% yellow, from 90% orange, below red; no number grey. */
export const shareTone = share => (share === null || share === undefined ? 'off' : share >= 1 ? 'good' : share >= 0.98 ? 'warn' : share >= 0.9 ? 'orange' : 'bad');

/** A percentage as the page shows it: one decimal, and never a number that reaches a colour band the share does not reach (99.96% reads 99.9%, 97.996% reads 97.9%, 89.96% reads 89.9%; Gitar on #306). */
export const percentOf = share => {
  if (share === null || share === undefined) return '–';
  if (share >= 1) return '100%';
  const cap = share < 0.9 ? 89.9 : share < 0.98 ? 97.9 : 99.9;
  return `${Math.min(cap, Math.round(share * 1000) / 10)}%`;
};

/** One row per Tier 2 journey from the per-day tallies of its integration tests. */
export function tier2Rows(snapshot, now = new Date()) {
  const from = dayOf(new Date(now.getTime() - (WINDOW_DAYS - 1) * DAY));
  return (snapshot?.journeys || []).filter(item => item.tier === 2).map(journey => {
    const days = (snapshot.tier2 || []).filter(row => row.journey === journey.id && row.day >= from).sort((a, b) => (a.day < b.day ? 1 : -1));
    const runs = days.reduce((sum, row) => sum + row.runs, 0), red = days.reduce((sum, row) => sum + row.red, 0), lastRed = days.find(row => row.red > 0) || null;
    return {id: journey.id, name: journey.name, tests: Math.max(0, ...days.map(row => row.tests)), runs, red, share: runs ? (runs - red) / runs : null, lastRed, days: days.length};
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** The gauge and the verdict in words. Kept steps (K) are shown but are not a journey: not in the count. */
export function verdict(rows) {
  const journeys = rows.filter(row => row.id !== 'K' && row.state !== 'none'), stable = journeys.filter(row => row.state === 'stable'), unstable = journeys.filter(row => row.state === 'unstable');
  const short = row => row.name.replace(/[:(].*$/, '').trim();
  // Why (1 Nov 2026, owner: "here again too much text"): the verdict is a short line; the journeys that are not stable are chips (id only, name and date on hover), never a sentence.
  const chips = [...unstable.map(row => ({label: row.id, tone: 'bad', title: `${row.id} ${short(row)}: red ${dayWords(row.lastBad.day)}`})),
    ...journeys.filter(row => row.state === 'few').map(row => ({label: row.id, tone: 'warn', title: `${row.id} ${short(row)}: only ${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`}))];
  // Owner, 2 Nov 2026: "20 journeys x 20 runs = 400; 5 failures: 395 out of 400" - the percentage of all Tier 1 runs of the window (every journey's runs counted once; the kept steps are not a journey) that were green.
  const counted = rows.filter(row => row.id !== 'K'), runs = counted.reduce((sum, row) => sum + row.runs, 0), green = runs - counted.reduce((sum, row) => sum + (row.reds || 0), 0), share = runs ? green / runs : null;
  return {runs, green, share, percent: percentOf(share), stable: stable.length, total: journeys.length, text: `${stable.length} of ${journeys.length} Tier 1 journeys stable`, chips};
}
