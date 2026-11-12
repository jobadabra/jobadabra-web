// The public name of our row on the benchmark pages, one place for the homepage card, /benchmark and Admin's publish preview (owner, 12 Nov 2026: "Instead of "Jobadabra" put "Jobadabra Search Engine" because Jobadabra is not a search engine/api/product. It's an end-to-end product"; form rounds added the same evening via mac-9a: "Jobadabra Fill Engine").
// Why (12 Nov 2026): the name is a function of the round kind, applied when /benchmark-results.json is read (admin/benchmark-publish.js mergeResults), because a round already published has the old name stored in its D1 body.
// Pure: no imports, safe for the Worker and for tests. The benchmarks repo prints the same words (search-bench/tools.mjs, form-bench); test/no-old-name.test.mjs there guards them.
export const OUR_NAME = {search: 'Jobadabra Search Engine', form: 'Jobadabra Fill Engine'};
const OURS_ALL = {search: 'Jobadabra Search Engine (with every source)'};   // Admin only; shown publicly nowhere today, spelled here so it never falls back to the bare product name
const RIVAL = {'browser-use': 'Browser Use', stagehand: 'Stagehand', nanobrowser: 'Nanobrowser', jobspy: 'JobSpy', eures: 'EURES', adzuna: 'Adzuna', jooble: 'Jooble', 'career-ops': 'career-ops', 'career-ops-docs': 'career-ops (docs setup)'};

/** Our row's name for a round kind ('search' | 'form'). */
export const ourName = kind => OUR_NAME[kind] || OUR_NAME.search;

/** The public name of one tool in a round of `kind`, by its key; a key we do not know keeps `fallback` (the name it was stored with), else the key. */
export function publicName(kind, key, fallback = '') {
  const k = String(key || '').toLowerCase();
  if (k === 'ours' || k === 'extension') return ourName(kind);
  if (k === 'ours-all') return OURS_ALL[kind] || ourName(kind);
  return RIVAL[k] || fallback || String(key || '');
}
