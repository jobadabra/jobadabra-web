// The Finish line's numbers (owner, 10 Nov 2026, via [sa]: "We should have graphs in the Admin showing us our progress to the finish line"): what a stored night says about each person's right jobs per source, how many of the
// jobs a source shows for the person are in our list ("in = out"), and where the missing ones were lost. Two row fields, sent with the nightly verdict (sf, from the run) and kept here in fixed words only:
//   inout    {<source>: {in, out, lost: {<stage>: n}}}    in = right jobs that source's own search shows for the person, out = how many are in Jobadabra's list after one Find jobs search
//   sources  {<source>: {right, only, fit70, seconds}}    right jobs the source brought, right jobs ONLY it brought, fit 70+, seconds it took; a field not sent is null ("not sent yet"), never 0
// Words are v2 of the plan (sa, 10 Nov 2026); a word outside the lists is dropped, a count that is not a whole number is null. Pure; no job, employer or CV text ever enters. Guard: test/unit/admin/search/search-finish.test.js.
const SOURCES = ['eures', 'employer_sites', 'job_boards', 'free_job_apis', 'web_search', 'linkedin', 'public_board'];
const STAGES = ['not_read', 'never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'listed'];
const LOST = STAGES.filter(stage => stage !== 'listed');   // `listed` is `out`, not a loss
const whole = value => (Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : null);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export {SOURCES, STAGES};

/** A verdict row's `inout` -> {<source>: {in, out, lost}} with whole numbers (lost holds the stages sent, none made up), or null when no known source has a whole in and out. */
export function cleanInout(raw) {
  if (!plain(raw)) return null;
  const out = {};
  for (const source of SOURCES) {
    const item = raw[source];
    if (!plain(item) || whole(item.in) == null || whole(item.out) == null) continue;
    out[source] = {in: item.in, out: item.out, lost: Object.fromEntries(LOST.filter(stage => whole(item.lost?.[stage]) != null).map(stage => [stage, item.lost[stage]]))};
  }
  return Object.keys(out).length ? out : null;
}

/** A verdict row's `sources` -> {<source>: {right, only, fit70, seconds}}, each whole or null (null = "not sent yet"), or null when no known source is there. */
export function cleanSources(raw) {
  if (!plain(raw)) return null;
  const out = {};
  for (const source of SOURCES) if (plain(raw[source])) out[source] = Object.fromEntries(['right', 'only', 'fit70', 'seconds'].map(key => [key, whole(raw[source][key])]));
  return Object.keys(out).length ? out : null;
}

const BLIND = ['unmeasured', 'fault', 'unknown'];   // as admin/search-night-scoreboard.js: the check could not measure the person

/** The floor of "at the line": a person is at the line for a source when out is at least this share of in (sa's default, 10 Nov 2026; the owner may change it). */
export const LINE = 0.95;

/**
 * One night as the Finish line's per-person rows: [{persona, label, blind, in, out, lost: {stage: n}, atLine}] for EURES today (the one source with an `in`), in persona order. `in` null = no reference
 * (EURES lists none, or the night sent no inout): the person is neither at the line nor below it.
 * @param {object} night a stored night ({rows: [{persona, label, kind, inout}]})
 * @param {string} [source] which source's in = out
 */
export function peopleOf(night, source = 'eures') {
  return (night.rows || []).map(row => {
    const item = row.inout?.[source], blind = BLIND.includes(row.kind);
    return {persona: row.persona, label: row.label, blind, in: item?.in ?? null, out: item?.out ?? null, lost: item?.lost ?? {}, atLine: !blind && !!item && item.in > 0 && item.out >= LINE * item.in};
  });
}

/** The four states of a run for the stacked chart: people at the line, with some right jobs but below it, with none of them, not measured; people with no reference are in none (the total says so). */
export function tally(night, source = 'eures') {
  const people = peopleOf(night, source), referenced = people.filter(person => !person.blind && person.in > 0);
  return {night: night.night, atLine: referenced.filter(person => person.atLine).length, some: referenced.filter(person => !person.atLine && person.out > 0).length, none: referenced.filter(person => person.out === 0).length,
    blind: people.filter(person => person.blind).length, noReference: people.filter(person => !person.blind && !(person.in > 0)).length, total: people.length, hasInout: people.some(person => person.in != null)};
}

/**
 * The worst person x source x stage rows of the newest night that sent inout, by right jobs lost, with each row's earlier values (up to 6 nights back, oldest first) for a trend.
 * @param {object[]} nights stored nights, newest first
 * @param {number} [limit] how many rows
 * @returns {{night: string|null, rows: {persona, label, source, stage, lost, in, out, history: number[]}[]}} rows [] when no night sent inout
 */
export function weakest(nights, limit = 5) {
  const sent = nights.filter(night => (night.rows || []).some(row => row.inout)), [last] = sent;
  if (!last) return {night: null, rows: []};
  const rows = [];
  for (const row of last.rows) for (const [source, item] of Object.entries(row.inout || {})) for (const [stage, lost] of Object.entries(item.lost)) {
    if (lost > 0) rows.push({persona: row.persona, label: row.label, source, stage, lost, in: item.in, out: item.out,
      history: sent.slice(1, 7).reverse().map(night => night.rows.find(other => other.persona === row.persona)?.inout?.[source]?.lost?.[stage] ?? null)});
  }
  return {night: last.night, rows: rows.sort((a, b) => b.lost - a.lost || a.persona - b.persona).slice(0, limit)};
}

const median = list => { const sorted = list.filter(value => value != null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
const sum = list => (list.some(value => value != null) ? list.reduce((total, value) => total + (value ?? 0), 0) : null);

/**
 * What each source is worth on the newest night that sent `sources`, and its right jobs on each of the last 7 such nights: [{source, right, share, only, fit70, seconds, people, average, runs}] biggest first.
 * `only`/`fit70` stay null when no person sent them ("not sent yet"); `share` is the source's right jobs over all sources'; `average` is the mean right jobs over the nights that sent it.
 * @param {object[]} nights stored nights, newest first
 */
export function sourcesOf(nights) {
  const sent = nights.filter(night => (night.rows || []).some(row => row.sources)), [last] = sent;
  if (!last) return {night: null, rows: []};
  const names = [...new Set(sent.slice(0, 7).flatMap(night => night.rows.flatMap(row => Object.keys(row.sources || {}))))];
  const rightOf = (night, source) => sum(night.rows.map(row => row.sources?.[source]?.right ?? null));
  const total = names.reduce((all, source) => all + (rightOf(last, source) ?? 0), 0);
  const rows = names.map(source => {
    const items = last.rows.map(row => row.sources?.[source]).filter(Boolean), history = sent.slice(0, 7).map(night => rightOf(night, source)).filter(value => value != null);
    return {source, right: sum(items.map(item => item.right)), share: total > 0 ? (sum(items.map(item => item.right)) ?? 0) / total : null, only: sum(items.map(item => item.only)), fit70: sum(items.map(item => item.fit70)),
      seconds: median(items.map(item => item.seconds)), people: items.filter(item => item.right > 0).length, measured: last.rows.length, average: history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null, runs: history.length};
  });
  return {night: last.night, rows: rows.sort((a, b) => (b.right ?? -1) - (a.right ?? -1))};
}
