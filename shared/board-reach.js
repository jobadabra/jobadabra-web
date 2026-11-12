// Where the central scout's job boards reach across Europe (12 Nov 2026, owner: "a separate visual representation of job boards spread across the Europe ... some local,
// some for multiple countries"): a board is LOCAL when measured in one country, MULTI-COUNTRY when the same brand is measured in 2+ (acme-jobs.at, acme-jobs.es, acme-jobs.lu).
// Why (12 Nov 2026, owner via AskUserQuestion "Group by brand"): every stored host sits in one country (one sitefacts row per board and country, api/employers.js), so by host alone
// the multi-country tier is always empty. Drawn as a tile map: one square per European country, roughly where it sits.
// Why (12 Nov 2026, owner: "we should not disclose our intellectual property"; picked "Map + totals only"): the PUBLIC cut is shade bands per country and totals, never a board's
// name, host, per-country count or which countries one board spans; Admin's cut adds counts, the multi-country dots and each board's name. Guard: test/unit/shared/board-reach.test.js.
import {EUROPE} from './pool-tags.js';
import {countryName} from './scoutingvisual.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);   // co.uk, com.mt, org.cy: the brand is the label before them

/** The brand of a host: the label before its ending ("acme-jobs.at" -> "acme-jobs", "search.example-jobs.fr" -> "example-jobs", "jobs.acme.co.uk" -> "acme"). */
export function brandOf(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] || '';
  labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1))) labels.pop();
  return labels.at(-1);
}

/**
 * The sitefacts board rows ({host, countries}) of European countries, grouped by brand.
 * Invariant: a brand counts once in `local` or once in `multi`, never both; `countries[cc]` counts every board measured there (local or multi).
 * @returns {{boards: number, local: number, multi: Array<{brand: string, hosts: string[], countries: string[]}>, countries: Object<string, number>, localAt: Object<string, number>}}
 */
export function reachOf(rows) {
  const brands = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const country = String(row?.countries || ''), brand = brandOf(row?.host);
    if (!EUROPE.includes(country) || !brand) continue;
    const entry = brands.get(brand) || {brand, hosts: new Set(), countries: new Set()};
    entry.hosts.add(String(row.host).toLowerCase());
    entry.countries.add(country);
    brands.set(brand, entry);
  }
  const countries = {}, localAt = {}, multi = [];
  let local = 0;
  for (const entry of brands.values()) {
    for (const country of entry.countries) countries[country] = (countries[country] || 0) + 1;
    if (entry.countries.size === 1) { local += 1; const [country] = entry.countries; localAt[country] = (localAt[country] || 0) + 1; continue; }
    multi.push({brand: entry.brand, hosts: [...entry.hosts].sort(), countries: [...entry.countries].sort((a, b) => EUROPE.indexOf(a) - EUROPE.indexOf(b))});
  }
  multi.sort((a, b) => b.countries.length - a.countries.length || a.brand.localeCompare(b.brand));
  return {boards: brands.size, local, multi, countries, localAt};
}

// [column, row] of each European country on an 8 × 7 tile map, north-west at the top left.
export const TILES = {no: [5, 1], se: [6, 1], fi: [7, 1], ie: [2, 2], gb: [3, 2], dk: [5, 2], ee: [7, 2], be: [3, 3], nl: [4, 3], de: [5, 3], pl: [6, 3], lv: [7, 3],
  fr: [3, 4], lu: [4, 4], cz: [5, 4], sk: [6, 4], lt: [7, 4], es: [2, 5], ch: [4, 5], at: [5, 5], hu: [6, 5], ro: [7, 5], md: [8, 5],
  pt: [1, 6], it: [4, 6], si: [5, 6], hr: [6, 6], bg: [7, 6], mt: [4, 7], gr: [7, 7], cy: [8, 7]};

// The public shade bands: words, never a number per country. Painted with /coverage's heat steps (website/public/pages.css .heat-card .hN).
export const BANDS = [{max: 0, step: 'h0', words: 'no board yet'}, {max: 2, step: 'h2', words: '1 or 2 boards'}, {max: 5, step: 'h4', words: '3 to 5 boards'}, {max: Infinity, step: 'h6', words: '6 or more boards'}];
const bandOf = count => BANDS.find(band => count <= band.max);

/**
 * The tile map as HTML. `open` (the website) shades by band with no number; Admin's cut prints each country's count and a dot where a multi-country board reaches.
 * Every square carries data-tip (the page's tip line) and a title.
 */
export function reachMap(reach, {open = false} = {}) {
  const shared = new Set(reach.multi.flatMap(board => board.countries));
  const tiles = EUROPE.map(country => {
    const [col, row] = TILES[country], count = reach.countries[country] || 0, band = bandOf(count);
    const tip = open ? `${countryName(country)}: ${band.words}` : `${countryName(country)}: ${count} board${count === 1 ? '' : 's'}${shared.has(country) ? ', a multi-country one among them' : ''}`;
    return `<div class="tile ${band.step}${!open && shared.has(country) ? ' shared' : ''}" style="grid-column:${col};grid-row:${row}" data-tip="${esc(tip)}" title="${esc(tip)}">`
      + `<b>${country.toUpperCase()}</b>${open ? '' : `<small>${count || '·'}</small>`}</div>`;
  }).join('');
  return `<div class="reach-map" role="img" aria-label="${esc(open ? 'Job boards per European country, brighter means more' : 'Job boards per European country')}">${tiles}</div>`;
}

/** The map's key in words: the bands (public), or the bands plus the dot (Admin). */
export function reachLegend({open = false} = {}) {
  return BANDS.map(band => `<span><i class="${band.step}"></i>${esc(band.words)}</span>`).join('') + (open ? '' : '<span><i class="dot"></i>a multi-country board reaches it</span>');
}

/**
 * What GET /api/coverage sends (counts only): totals, the European countries with a board, and the map in its public cut.
 * No host, brand, per-country count or spanned-country list leaves here.
 */
export function publicReach(rows) {
  const reach = reachOf(rows);
  if (!reach.boards) return null;
  return {local: reach.local, multi: reach.multi.length, countries: Object.keys(reach.countries).length, of: EUROPE.length, map: reachMap(reach, {open: true}), legend: reachLegend({open: true})};
}
