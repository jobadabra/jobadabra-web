// Market coverage rows of the weekly reference (mc's WP2 5/5, 10 Nov 2026; owner: "make sure we have enough data to understand how good we are"): per fictional person, how many right jobs EXIST (market, counted once)
// and, per source, what that source read and found right. Counts and fixed words only; no board name, page, employer or job text. Sent with the weekly reference PUT (admin/search-reference.js), read back by reference().
//   {market, counted_on, sources: {<source>: {status, read, right, only}}}
// status = one line whose leading word is the kind: "counted" | "partial: <why>" | "not counted: <why>" | "none (<why>)" | "by hand". right / only / read are whole numbers or null; a source that is not counted has them null,
// NEVER 0 (a 0 would say "we looked and found nothing"). Guard: test/unit/admin/search/search-market.test.js.
import {SOURCES} from './search-finish.js';

const KINDS = [['counted', /^counted$/], ['partial', /^partial\b/], ['not-counted', /^not counted\b/], ['none', /^none\b/], ['by-hand', /^by hand$/]];
const COUNTING = ['counted', 'partial'];   // only these two may carry numbers
const whole = value => (Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : null);
const line = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A status line -> its kind word ('counted', 'partial', 'not-counted', 'none', 'by-hand') or null when the leading word is none of them. */
export const kindOf = status => KINDS.find(([, pattern]) => pattern.test(String(status || '').trim()))?.[0] ?? null;

/** One source's row -> {status, kind, read, right, only} or null (unknown leading word: the source is dropped, nothing is guessed). */
export function cleanSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const status = line(raw.status, 120), kind = kindOf(status);
  if (!kind) return null;
  const counts = COUNTING.includes(kind);
  return {status, kind, read: counts ? whole(raw.read) : null, right: counts ? whole(raw.right) : null, only: counts ? whole(raw.only) : null};
}

/** A reference person's market fields -> {market, countedOn, sources}; sources is {} when none is sent, market null = not counted (never 0 by default). */
export function cleanMarket(item) {
  const given = item?.sources && typeof item.sources === 'object' && !Array.isArray(item.sources) ? item.sources : {};
  const sources = {};
  for (const source of SOURCES) { const row = cleanSource(given[source]); if (row) sources[source] = row; }
  return {market: whole(item?.market), countedOn: line(item?.counted_on ?? item?.countedOn, 40), sources};
}

const BLIND = ['unmeasured', 'fault', 'unknown', 'not-run'];

/**
 * What the weekly reference says about the market, set beside the newest run: how many right jobs exist for the people counted, how many of them our list holds, and per source what it read and found.
 * Pure arithmetic over what was sent; nothing is made up: a person without a market count is out of the sums, and a sum with no counted source is null ("not counted"), never 0.
 * @param {object} ref reference() output: {<persona>: {market, countedOn, sources}}
 * @param {object|null} run the newest run ({rows: [{persona, kind, local}]}) or null
 * @returns {{people: number, counted: number, market: number|null, ours: number|null, countedOn: string, measured: number, sources: {source, kinds: object, read, right, only}[]}}
 */
export function coverage(ref, run) {
  const ids = Object.keys(ref || {}), counted = ids.filter(id => ref[id].market != null);
  const sum = values => (values.some(value => value != null) ? values.reduce((total, value) => total + (value ?? 0), 0) : null);
  const mine = new Map((run?.rows || []).filter(row => !BLIND.includes(row.kind)).map(row => [String(row.persona), row.local]));
  const both = counted.filter(id => mine.has(id) && mine.get(id) != null);
  const sources = SOURCES.map(source => {
    const rows = ids.map(id => ref[id].sources?.[source]).filter(Boolean), kinds = {};
    for (const row of rows) kinds[row.kind] = (kinds[row.kind] || 0) + 1;
    return {source, kinds, read: sum(rows.map(row => row.read)), right: sum(rows.map(row => row.right)), only: sum(rows.map(row => row.only)), total: rows.length};
  }).filter(row => row.total > 0);
  return {people: ids.length, counted: counted.length, market: sum(counted.map(id => ref[id].market)), countedOn: [...new Set(ids.map(id => ref[id].countedOn).filter(Boolean))].join(', '),
    ours: both.length ? sum(both.map(id => mine.get(id))) : null, oursOf: both.length ? sum(both.map(id => ref[id].market)) : null, measured: both.length, sources};   // Why (Gitar, 10 Nov 2026): the share is over the people counted AND measured in the run, not over every counted person: the card says how many
}
