// The Search area of the product-quality board (owner, 6 Nov 2026: "the nightly search persona... I see nowhere in Admin... Where should I see it the search dropped?"): how many of the six fictional job
// seekers the nightly search check could measure, an average over the last 7 nights. The red chip is the SAME verdict as the "Night search" tab and the alert (admin/search-night-judge.js judgeNight),
// so the three cannot disagree. Pure: admin/product-quality-data.js reads the stored nights (admin/search-night.js), this file judges them. Guard: test/unit/admin/report/product-quality.test.js.
import {judge, median, notMeasured, pooled, round, toneOf, deltaText, WORDS, WEEK} from './product-quality.js';
import {euresOf, judgeAll, reasonWords} from './search-night-judge.js';

const isNum = value => typeof value === 'number' && Number.isFinite(value);

/**
 * Search: personas measured per night, average of the last 7 nights against the 7 before; the newest night's own verdict decides the red chip.
 * @param {{days: string[], searchNights: object[]|null}} inputs days = 'YYYY-MM-DD' oldest first (30); searchNights = the stored nights, newest first (null = could not be read)
 * @returns {object} an area of admin/product-quality-areas.js
 */
export function search({days, searchNights}) {
  const base = {id: 'search', area: 'Search', question: 'Does the nightly search still find jobs?', kind: 'line', subs: [], src: 'the nightly search check (the fixed fictional job seekers)'};
  if (!searchNights) return notMeasured(base, 'the nightly search results could not be read');
  const judged = judgeAll([...searchNights].sort((a, b) => b.night.localeCompare(a.night))).filter(item => days.includes(item.night));   // each night against the ones before it, in or out of the 30 days
  if (!judged.length) return notMeasured(base, 'no nightly search stored in the last 30 days');   // no night yet is "not measured", never 0
  // Why (6 Nov 2026, review): only nights with the newest night's persona count are one series, as in the judge: an average of 6-persona and 18-persona nights would read "better" just because the set tripled.
  // Why (10 Nov 2026, jobadabra [oe] 1/3): nights without EURES are their own series too: the switch alone lowers the jobs found, it is no "worse".
  const newest = judged[0], nights = judged.filter(item => item.total === newest.total && euresOf(item) === euresOf(newest)), byNight = new Map(nights.map(item => [item.night, item]));
  if (!days.slice(-2 * WEEK).includes(newest.night)) return notMeasured(base, 'no nightly search in the last 14 days');   // a stopped job is the news, not an old number
  const series = days.map(day => (byNight.has(day) ? {day, value: byNight.get(day).measured, n: 1} : {day, value: null}));
  const now = pooled(series.slice(-WEEK)), before = pooled(series.slice(-2 * WEEK, -WEEK));
  if (now == null) return notMeasured(base, 'no nightly search in the last 7 days');
  // Why (6 Nov 2026): red is the judge's verdict on the newest night, also in the first week (measured under two thirds of the personas is a drop with no earlier week to compare); an average that fell with no drop is only "to watch".
  const trend = newest.dropped ? 'worse' : judge(now, before, {tolerance: 0.5}) ?? 'new';
  const tone = newest.dropped ? 'bad' : toneOf(trend, now);
  const local = median(nights.filter(item => days.slice(-WEEK).includes(item.night)).map(item => item.local).filter(isNum));
  const subs = [`Newest night (${newest.night}): measured ${newest.measured} of ${newest.total}${newest.dropped ? ` · ${reasonWords(newest).join(' · ')}` : ''}`,
    local == null ? 'Relevant local jobs: not measured' : `Relevant local jobs: median ${round(local, 1)} a night (last 7 nights)`];
  return {...base, value: String(round(now, 1)), unit: ` of ${newest.total}`, label: 'personas measured per night (average of the last 7 nights)', trend, word: WORDS[trend], tone, delta: deltaText(now, before, '', 1), bar: null, series, subs};
}
