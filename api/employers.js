// The central employer index: GET /api/index is what every app and Always-on run downloads, with an install token (POST /api/install-token
// {install, purpose: 'index'}) and at most INDEX_PER_INSTALL_PER_DAY times a day; GET /api/index?summary=1 is public and holds only the counts;
// PUT /api/index (Bearer INDEX_PUBLISH_KEY) is the private central scout (repo jobadabra/jobadabra-lab) publishing it.
// Product data only: feeds, quality, last verified. Nothing about any user. Stored as one KV value (binding WAITLIST).
import {employerCard} from '../shared/owner-cards.js';
import {REGIONS, ROLES} from '../shared/pool-labels.js';
import {sourceRanking} from './source-ranking.js';
import {poolSnapshot, pooledKeys, storePoolSnapshot} from '../shared/pool-snapshot.js';
import {COUNTRIES, FAMILIES, METROS} from '../shared/pool-tags.js';
import {authorize, digestOf, equal, flag} from '../shared/guard.js';
import {alertOwner} from '../shared/notify-send.js';
import {store as storeScouting} from '../shared/scouting.js';
import {snapshot, storeSnapshot} from '../shared/scouting-snapshot.js';
import {storeBoardCounts} from '../shared/board-counts.js';
import {installHit} from '../shared/install-caps.js';
const KEY = 'index:employers';
const NOFEED_KEY = 'index:nofeed';
const SUMMARY_KEY = 'index:summary';   // the website's two counts, written at every publish (the old single-value copy stops once the list outgrows it)
const GENERATED_KEY = 'index:generated';   // when the central scout last published: installs ask "still this one?" hourly, answered from KV alone
const KEEP_SHARE = 0.9;   // a publish keeping fewer employers than this share of the stored list is refused (publish)
const COPY_PREFIX = 'index:copy:', COPY_DAYS = 30;   // the dated copies (keepCopy): written here only, no route reads them
const BOARDS_KEY = 'index:boards';   // per job board, what it gives people by role, family and place (src/scout.py board_stats): installs order the boards they suggest   // employers with no readable job site, published by the central scout: installs skip them 30 days
const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join', 'workday', 'umantis', 'successfactors', 'oracle', 'phenom', 'eightfold', 'careers', 'amazon', 'netflix', 'jobsch'];
const MAX_BYTES = 1_000_000;          // the KV copy older app versions download (one KV value)
const MAX_PUBLISH_BYTES = 20_000_000; // what the central scout may send: D1 holds far more feeds than one KV value
const MAX_FEEDS = 60000;
export const MAX_NOFEED = 10000;   // the central scout's dead ends (src/scout_index.py MAX_DEAD_ENDS); 5,000 until 20 Oct 2026, when the list was full
const MAX_PLACES = 40;   // where a feed has roles: clients skip feeds with none in their own places

const text = (status, body, headers = {}) => new Response(body, {status, headers});

const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

// kind: an employer's own career page, or a job portal (counted apart on the website).
// Who a feed fits (fixed lists only): the scout publishes a tag only when many installs agree.
// How to read a careers page without AI (src/sources/page_recipes.py), checked to the same fixed shape: never a pattern, only a path or a tag and class.
const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a', 'strong', 'b', 'span', 'div', 'p', 'td', 'dt'];
export function recipeOf(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const keys = Object.keys(recipe).sort().join(',');
  // Why (13 Nov 2026, owner: "Yes, add depth (Recommended)"): some boards put each job 2 or 3 folders under the prefix (/oferta/<id>/<slug>); depth 1 is
  // served with no field, as before. An install older than depth refuses {kind, prefix, depth} (page_recipes.valid wants exactly kind and prefix): it asks the AI, never misreads.
  if (recipe.kind === 'links' && (keys === 'kind,prefix' || keys === 'depth,kind,prefix') && typeof recipe.prefix === 'string' && /^(\/[\w.%~-]+){0,6}$/.test(recipe.prefix)) {
    const depth = 'depth' in recipe ? recipe.depth : 1;
    if (!Number.isInteger(depth) || depth < 1 || depth > 3) return null;
    return depth === 1 ? {kind: 'links', prefix: recipe.prefix} : {kind: 'links', prefix: recipe.prefix, depth};
  }
  if (recipe.kind === 'tag' && keys === 'class,kind,tag' && TAGS.includes(recipe.tag) && typeof recipe.class === 'string' && /^[\w -]{1,60}$/.test(recipe.class)) return {kind: 'tag', tag: recipe.tag, class: recipe.class};
  // Why (13 Nov 2026, bl): the engine's third kind (the list in the page's JSON state, page_recipes.valid) was missing here, so a careers feed's state recipe was dropped.
  if (recipe.kind === 'state' && keys === 'kind,path' && typeof recipe.path === 'string' && /^\d{1,2}(\.[\w$-]{1,40}){0,12}$/.test(recipe.path)) return {kind: 'state', path: recipe.path};
  return null;
}
// What a feed hires for: {kind: share}, fixed kinds only (src/role_kinds.py KINDS, the same as shared/pool-labels.js KINDS: test/unit/shared/role-kinds.test.js; public's tests/test_role_kinds.py reads this literal), shares 0–1.
export const KINDS = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades',
  'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other'];
const countriesOf = list => (Array.isArray(list) ? [...new Set(list.filter(c => COUNTRIES.includes(c)))] : []);
export const kindsOf = kinds => {
  if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) return null;
  const out = Object.fromEntries(Object.entries(kinds).filter(([kind, share]) => KINDS.includes(kind) && typeof share === 'number' && share >= 0 && share <= 1)
    .map(([kind, share]) => [kind, Math.round(share * 100) / 100]));
  return Object.keys(out).length ? out : null;
};
// How many of a feed's jobs in each country are of each kind (src/scout_index.py kind_counts): installs read an employer only when its jobs in their
// countries are their kind (owner, 26 Oct 2026). Fixed country and kind ids, whole numbers from 1; anything else is dropped.
export const kindCountsOf = counts => {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const out = {};
  for (const [country, kinds] of Object.entries(counts)) {
    if (!COUNTRIES.includes(country) || !kinds || typeof kinds !== 'object' || Array.isArray(kinds)) continue;
    const kept = Object.fromEntries(Object.entries(kinds).filter(([kind, n]) => KINDS.includes(kind) && typeof n === 'number' && number(n, 100000) >= 1)
      .map(([kind, n]) => [kind, number(n, 100000)]));
    if (Object.keys(kept).length) out[country] = kept;
  }
  return Object.keys(out).length ? out : null;
};
// How fresh a feed is (src/scout.py health): fixed fields only, dates and small numbers.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const freshOf = fresh => {
  if (!fresh || typeof fresh !== 'object') return null;
  const out = {ok: DAY.test(fresh.ok || '') ? fresh.ok : null, fails: number(fresh.fails, 1000) ?? 0, jobs: number(fresh.jobs, 100000) ?? 0,
    trend: ['up', 'flat', 'down'].includes(fresh.trend) ? fresh.trend : 'flat', new: DAY.test(fresh.new || '') ? fresh.new : null};
  return out.ok ? out : null;
};
const LISTS = {roles: ROLES, regions: REGIONS, countries: COUNTRIES, metros: METROS, families: FAMILIES};
const tagsOf = (value, names) => Object.fromEntries(names.map(name => [name, (Array.isArray(value?.[name]) ? value[name] : []).filter(tag => LISTS[name].includes(tag))])
  .filter(([name, tags]) => tags.length || ['roles', 'regions'].includes(name)));
// Who a feed fits, and `quiet`: role kinds / families whose installs read it fine and never found a job there (src/scout.py fits).
const fitsOf = fits => {
  const quiet = tagsOf(fits?.quiet, ['roles', 'families']);
  return {...tagsOf(fits, Object.keys(LISTS)), ...(Object.values(quiet).some(tags => tags.length) ? {quiet} : {})};
};
// What a feed led to across installs (published past 3 installs): small whole numbers only.
const poolOf = pool => (pool && typeof pool === 'object' && number(pool.installs, 1e6) >= 3
  ? {installs: number(pool.installs, 1e6), matched: number(pool.matched, 1e6) ?? 0, applied: number(pool.applied, 1e6) ?? 0, interview: number(pool.interview, 1e6) ?? 0} : null);
const BOARD_IDS = ['jobsch', 'arbeitnow', 'himalayas', 'jobicy', 'adzuna', 'jooble', 'google_jobs', 'alerts_linkedin', 'alerts_jobsch', 'alerts_jobup', 'alerts_indeed', 'alerts_glassdoor'];
export function boardsOf(boards) {
  return (Array.isArray(boards) ? boards : []).filter(item => item && BOARD_IDS.includes(item.board)).slice(0, 30).map(item => ({
    board: item.board, installs: number(item.installs, 1e6) ?? 0, matched: number(item.matched, 1e6) ?? 0,
    by: Object.fromEntries(Object.keys(LISTS).map(name => [name, Object.fromEntries(Object.entries(item.by?.[name] || {})
      .filter(([tag, pair]) => LISTS[name].includes(tag) && Array.isArray(pair) && number(pair[0], 1e6) >= 3).map(([tag, pair]) => [tag, [number(pair[0], 1e6), number(pair[1], 1e6) ?? 0]]))]))}));
}

// Only the fields clients read, and only feeds an app knows how to crawl.
export function clean(feeds) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(feeds) ? feeds : []) {
    if (!item || typeof item !== 'object') continue;
    const {company, ats, slug} = item;
    if (!SYSTEMS.includes(ats) || typeof slug !== 'string' || !/^[\w.-]{1,120}$/.test(slug)) continue;
    if (typeof company !== 'string' || !company.trim() || seen.has(`${ats}:${slug}`)) continue;
    seen.add(`${ats}:${slug}`);
    out.push({company: company.trim().slice(0, 120), ats, slug, kind: item.kind === 'board' ? 'board' : 'employer', tier: item.tier === 'Tier 1' ? 'Tier 1' : 'Standard',
      quality: number(item.quality, 100), jobs: number(item.jobs, 100000), relevant: number(item.relevant, 100000),
      checked: /^\d{4}-\d{2}-\d{2}$/.test(item.checked || '') ? item.checked : null,
      fits: fitsOf(item.fits),
      ...(kindsOf(item.kinds) ? {kinds: kindsOf(item.kinds)} : {}),
      ...(kindCountsOf(item.kind_counts) ? {kind_counts: kindCountsOf(item.kind_counts)} : {}),
      ...(freshOf(item.fresh) ? {fresh: freshOf(item.fresh)} : {}),
      ...(poolOf(item.pool) ? {pool: poolOf(item.pool)} : {}),
      regions: Array.isArray(item.regions) ? [...new Set(item.regions.filter(r => REGIONS.includes(r)))] : [],
      ...(countriesOf(item.countries).length ? {countries: countriesOf(item.countries)} : {}),   // where its jobs are (src/scout_index.py), fixed ids only
      places: Array.isArray(item.places) ? item.places.filter(p => typeof p === 'string').map(p => p.slice(0, 60)).slice(0, MAX_PLACES) : [],
      ...(ats === 'careers' && recipeOf(item.recipe) ? {recipe: recipeOf(item.recipe)} : {})});
  }
  return out;
}

async function etag(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `"${[...new Uint8Array(digest).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('')}"`;
}

const INDEX_PER_INSTALL_PER_DAY = 24;
const day = date => date.toISOString().slice(0, 10);

// The website's counters: only how many employers and open jobs, never the feeds.
function summary(stored) {
  const feeds = (Array.isArray(stored) ? stored : JSON.parse(stored).feeds) || [];
  const employers = feeds.filter(feed => feed.kind !== 'board');
  return {employers: employers.length, jobs: employers.reduce((sum, feed) => sum + (feed.jobs || 0), 0)};
}

// The regions an install asks for (fixed words, nothing else about it), or null for an older app that asks for the whole list.
function regionsOf(request) {
  const asked = new URL(request.url).searchParams.get('regions');
  if (asked === null) return null;
  return [...new Set(asked.split(',').map(r => r.trim()).filter(r => REGIONS.includes(r)))];
}

// The slice of the D1 index for these regions, plus feeds whose places are unknown; null when D1 holds no index yet.
async function slice(env, regions) {
  if (!env.STATS) return null;
  const where = regions.length ? regions.map(() => 'regions LIKE ?').join(' OR ') + " OR regions = ','" : "regions = ','";
  const rows = (await env.STATS.prepare(`SELECT body, generated FROM index_feeds WHERE ${where} ORDER BY ats, slug`)
    .bind(...regions.map(r => `%,${r},%`)).all()).results || [];
  if (!rows.length) return null;
  const nofeed = JSON.parse((await env.WAITLIST?.get(NOFEED_KEY)) || '[]').filter(item => !/^e2e/.test(item?.key || ''));   // stored before the filter
  const boards = JSON.parse((await env.WAITLIST?.get(BOARDS_KEY)) || '[]');
  const sites = await agreedSites(env);
  const ranking = await sourceRanking(env);   // each role kind × country's sources, best first (api/source-ranking.js)
  const generated = (await env.WAITLIST?.get(GENERATED_KEY)) || rows.reduce((last, row) => (row.generated > last ? row.generated : last), '');   // the publish's own time: rows a publish left unchanged keep an older one
  return JSON.stringify({version: 2, generated, regions, feeds: rows.map(row => JSON.parse(row.body)), nofeed, boards, ...(sites.length ? {sites} : {}), ...(Object.keys(ranking).length ? {ranking} : {})});
}

// Facts about sites that at least SITES_K installs shared in the last 90 days (api/pool.js sitefacts): a company's job page, a site only a
// browser reads, a dead page. Counted, never who: only facts several installs agree on go out (the learned layer's k >= 3 rule).
export const SITES_K = 3;
// A job board and what it gave are served after ONE install (owner, 20 Oct 2026: "Yes, 1 install"): the next install's own read checks it;
// at 3 a board that gave a Berlin music search 28 of its 62 jobs was left to each install's AI draw.
export const BOARDS_K = 1;
const fact = (row, relevant) => ({host: row.host, kind: row.kind, ...(row.url ? {url: row.url} : {}),
  ...(row.body ? (row.kind === 'browser_read' ? {read: JSON.parse(row.body)} : row.kind === 'route' ? {route: JSON.parse(row.body)} : {recipe: JSON.parse(row.body)}) : {}),
  installs: row.installs, ...(relevant?.length ? {relevant} : {})});
export async function agreedSites(env, k = SITES_K) {
  if (!env.STATS) return [];
  try {
    const rows = (await env.STATS.prepare(`SELECT host, kind, url, body, COUNT(DISTINCT install) AS installs FROM sitefacts WHERE kind NOT IN ('browser_read', 'route')
      GROUP BY host, kind, url, body HAVING installs >= CASE WHEN kind = 'board' THEN ? ELSE ? END ORDER BY installs DESC LIMIT 3000`).bind(Math.min(k, BOARDS_K), k).all()).results || [];
    // A browser outcome is served after one install (owner, 20 Oct 2026: a fact the next install's own read checks): the newest per host.
    rows.push(...((await env.STATS.prepare(`SELECT host, kind, NULL AS url, body, 1 AS installs FROM sitefacts f WHERE kind = 'browser_read'
      AND day = (SELECT MAX(day) FROM sitefacts g WHERE g.kind = 'browser_read' AND g.host = f.host) GROUP BY host LIMIT 3000`).all()).results || []));
    // How a site is read: a positive route is checked by the next install's own read, so one install serves it; a refusal or a browser-only page
    // depends on who asked, so it waits for k installs. One route per host: the one most installs gave.
    const routes = (await env.STATS.prepare(`SELECT host, kind, NULL AS url, body, COUNT(DISTINCT install) AS installs FROM sitefacts WHERE kind = 'route'
      GROUP BY host, body ORDER BY installs DESC LIMIT 3000`).all()).results || [];
    const seen = new Set();
    for (const row of routes) {
      if (seen.has(row.host)) continue;
      seen.add(row.host);
      if (['"refused"', '"browser_only"'].includes(row.body) && row.installs < k) continue;
      rows.push(row);
    }
    const cells = rows.some(row => row.kind === 'board') ? await boardCells(env, Math.min(k, BOARDS_K)) : {};
    const facts = rows.map(row => fact(row, row.kind === 'board' ? cells[row.host] : null));
    if (env.POOL_LAYOUTS === 'off') return facts.filter(item => item.kind !== 'layout');   // the kill switch for shared layouts
    return facts;
  } catch { return []; }   // the table before its migration: nothing to serve yet
}

// What each job board gave the installs that read it, per role family × country (src/contribute.py site_facts 'yield', PR 6 of
// docs/superpowers/specs/2026-10-18-search-learns-sources.md): jobs in their places and fit 70+, summed. A cell goes out only when k installs
// share it (one install's numbers never do); an install's countries count only where the board serves. Installs rank the boards by it.
// measured: true on a cell the Central Scout's own read gave (storeBoardFacts): that family's jobs were seen on the board, located in that country.
async function boardCells(env, k) {
  let rows;
  try {
    rows = (await env.STATS.prepare(`SELECT install, day, host, body, in_places, fit70, countries, families FROM sitefacts WHERE kind = 'board' AND in_places IS NOT NULL`).all()).results || [];
  } catch { return {}; }   // before migration 0094
  const cells = {}, list = text => String(text || '').split(',').filter(Boolean);
  for (const row of rows) {
    let serves, counted;
    try { const body = JSON.parse(row.body || '{}'); serves = body.countries || []; counted = familyJobsOf(body.family_jobs); } catch { serves = []; }
    const scout = String(row.install || '').startsWith(SCOUT_BOARD_PREFIX);
    for (const family of list(row.families)) {
      for (const country of list(row.countries).filter(c => serves.includes(c))) {
        const cell = ((cells[row.host] ||= {})[`${family}|${country}`] ||= {family, country, installs: 0, in_places: 0, fit70: 0});
        cell.installs += 1;
        // A Scout row with counts gives the family's own number (a family not measured gives none); a Scout row from before the count still gives its whole count (older apps rank by it).
        cell.in_places += scout && counted ? counted[family] || 0 : row.in_places || 0;
        cell.fit70 += row.fit70 || 0;
        // Why (12 Nov 2026, owner: "We should now from the start what boards/employers we should read first"; "I agree" to counting a Scout-measured board
        // as proven): the Scout's rows carry no fit count (storeBoardFacts writes 0), so an install could not tell a board the Scout read and found this
        // family's jobs on, in this country, from one install's unscored list; 4% of first searches started from a proven board.
        // Why (13 Nov 2026, bp): `measured` only with MIN_RIGHT_JOBS+ jobs of this family, so apps already installed stop trusting a family seen once; `right` is the number itself
        // (absent: not measured) and `day` when it was measured: installs order boards by it (src/ai/board_ideas.py).
        if (scout && counted) {
          const right = counted[family];
          if (Number.isInteger(right)) { cell.right = right; cell.day = row.day; }
          if (right >= MIN_RIGHT_JOBS) cell.measured = true;
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(cells).map(([host, byCell]) => [host, Object.values(byCell).filter(cell => cell.installs >= k)
    .sort((a, b) => a.family.localeCompare(b.family) || a.country.localeCompare(b.country))]));
}

async function download(request, env, now = new Date()) {
  const regions = regionsOf(request);
  // No regions (an install that has no search yet, or an older app): the whole fresh D1 list, never the one-value KV copy, which stops being
  // updated once the list outgrows it (24 Oct 2026: it still held the 8 Oct list, 2,184 of 4,606 feeds). The KV copy is only the fallback.
  const stored = (regions ? await slice(env, regions) : await slice(env, REGIONS).catch(() => null)) || await env.WAITLIST.get(KEY);   // no D1 table yet: the KV copy
  if (!stored) return text(404, JSON.stringify({ok: false, error: 'No index published yet'}), {'Content-Type': 'application/json'});
  if (new URL(request.url).searchParams.get('summary') === '1') {
    const counts = (!regions && await env.WAITLIST.get(SUMMARY_KEY)) || JSON.stringify(summary(stored));
    return text(200, counts, {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'});
  }
  // The full list is for the owner's scout and for installs that hold a token, a few downloads a day each.
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.INDEX_PUBLISH_KEY && equal(given, env.INDEX_PUBLISH_KEY))) {
    const install = request.headers.get('X-Install-Id') || '';
    const access = await authorize(env, install, given, 'index');
    // INDEX_GATE = "soft" while older app versions (no token yet) update: they still get the list, and are counted. Anything else enforces.
    if (!access.ok && env.INDEX_GATE === 'soft') {
      await flag(env, 'index-open', await digestOf(request.headers.get('CF-Connecting-IP') || 'unknown'), 'no token', now);
      const open = await etag(stored);
      return text(200, request.method === 'HEAD' ? null : stored, {'Content-Type': 'application/json', ETag: open, 'Cache-Control': 'private, max-age=3600'});
    }
    if (!access.ok) return text(401, JSON.stringify({ok: false, error: 'token needed', hint: "POST /api/install-token {install, purpose: 'index'}"}), {'Content-Type': 'application/json'});
    // Still the same publish? One KV read, no database, not counted against the day's downloads (7 Oct 2026: installs check hourly).
    const have = request.headers.get('X-Index-Generated') || '';
    if (have && have === (await env.WAITLIST.get(GENERATED_KEY))) return text(304, null, {'Cache-Control': 'private, max-age=3600'});
    const key = `index-get:${install}:${day(now)}`;
    const used = Number(await env.WAITLIST.get(key)) || 0;
    const full = used >= INDEX_PER_INSTALL_PER_DAY;
    await installHit(env, 'index-day', access.who, used + 1, INDEX_PER_INSTALL_PER_DAY, {now, reached: full});   // 🟠 at 80%, 🔴 when refused: the hourly card (shared/install-caps.js; owner 13 Nov 2026, "Grouped hourly (Recommended)")
    if (full) { await flag(env, 'index-quota', access.who, 'index downloads', now); return text(429, JSON.stringify({ok: false, error: 'limit reached for today'}), {'Content-Type': 'application/json'}); }
    await env.WAITLIST.put(key, String(used + 1), {expirationTtl: 2 * 86400});
  }
  const tag = await etag(stored);
  const headers = {'Content-Type': 'application/json', ETag: tag, 'Cache-Control': 'private, max-age=3600'};
  if (request.headers.get('If-None-Match') === tag) return text(304, null, headers);
  return text(200, request.method === 'HEAD' ? null : stored, headers);
}

// The central scout's measured job boards (24 Oct 2026, owner: "A. Central scout measures boards"): per country, a board whose search page gave jobs
// LOCATED in that country (never worldwide remote); the url is a search template with {role} or the board's own section page (no placeholder). Stored in the same `sitefacts` table installs share boards in, one row per board and country
// under the install id `central-scout-<cc>`, so agreedSites serves them as the same fact ({kind: 'board', relevant: [{country, family, installs: 1, in_places}]})
// after one "install" (BOARDS_K) and installs rank them like their own. A fact not measured again within SCOUT_BOARD_DAYS leaves.
// Why (12 Nov 2026, owner via sa: "Boards now, employers next (Recommended)"): `browser: true` (exactly true, nothing else) marks a board the plain reader
// is refused on and the scout measured in CI's honest headless browser; it rides in the same fact's recipe, and installs read it in Jobadabra's own browser.
// Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): `layout` is how the board's job cards are laid out
// (src/sources/page_recipes.py shape, checked by recipeOf), learned once by board discovery; it rides in the same recipe and installs replay it with no AI per link.
export const SCOUT_BOARD_PREFIX = 'central-scout-', SCOUT_BOARD_DAYS = 30, MAX_SCOUT_BOARDS = 400, MIN_LOCAL_JOBS = 3;
/** The jobs of a board that must be of ONE role family, located in the country, before the board is "measured" for it (src/scout_board_counts.py MIN_RIGHT: the engine checks it too).
 *  Why (13 Nov 2026, bp, owner: "Why ? Let's fix it."; "we know exactly: this board will give x jobs, this other board will give y jobs"): a Scout fact carried the board's whole local-job count
 *  and the SET of families seen once, and boardCells credited the count to every family of the set: airlinejobs.com/es (one aircraft electrician among 178 jobs) was `measured` for electricians. */
export const MIN_RIGHT_JOBS = 3;
/** The Scout's count of a board's jobs per role family ({family: jobs}), each a whole number 0-5000 of a pool family; undefined when it sent none or not an object
 *  (a fact kept before the count, or a bad one: the board stays, as a board that proves no family). A family not in it was not measured: never read as 0. */
export function familyJobsOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw).filter(([family, jobs]) => FAMILIES.includes(family) && Number.isInteger(jobs) && jobs >= 0).map(([family, jobs]) => [family, Math.min(jobs, 5000)]));
}

export function boardFactsOf(list) {
  const out = new Map();
  for (const item of (Array.isArray(list) ? list : []).slice(0, MAX_SCOUT_BOARDS * 3)) {
    const url = String(item?.url || '').trim();
    const host = String(item?.host || '').toLowerCase();
    let urlHost = '';
    try { urlHost = new URL(url.replace('{role}', 'x')).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    const country = item.country;
    const families = [...new Set((Array.isArray(item.families) ? item.families : []).filter(f => FAMILIES.includes(f)))];
    const jobs = Math.floor(Number(item.local_jobs));
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || !url.startsWith('https://') || url.length > 300 || urlHost !== host.replace(/^www\./, '')
      || (url.match(/\{(\w*)\}/g) || []).some(token => !['{role}', '{place}'].includes(token)) || !COUNTRIES.includes(country) || !families.length
      || !(jobs >= MIN_LOCAL_JOBS)) continue;
    const layout = recipeOf(item.layout);   // how the board's job cards are laid out, learned by board discovery; a bad one is dropped, never the board
    const familyJobs = familyJobsOf(item.family_jobs);
    out.set(`${host}\n${country}`, {host, url, country, families, local_jobs: Math.min(jobs, 5000), ...(familyJobs ? {family_jobs: familyJobs} : {}), ...(item.browser === true ? {browser: true} : {}), ...(layout ? {layout} : {})});
  }
  return [...out.values()].slice(0, MAX_SCOUT_BOARDS);
}

async function storeBoardFacts(db, facts, date) {
  const statements = facts.map(fact => db.prepare(`INSERT INTO sitefacts (install, day, host, kind, url, body, in_places, fit70, countries, families) VALUES (?, ?, ?, 'board', ?, ?, ?, 0, ?, ?)
    ON CONFLICT(install, host, kind) DO UPDATE SET day = excluded.day, url = excluded.url, body = excluded.body, in_places = excluded.in_places, fit70 = 0,
    countries = excluded.countries, families = excluded.families`)
    .bind(`${SCOUT_BOARD_PREFIX}${fact.country}`, date, fact.host, fact.url, JSON.stringify({countries: [fact.country], ...(fact.family_jobs ? {family_jobs: fact.family_jobs} : {}), ...(fact.browser ? {browser: true} : {}), ...(fact.layout ? {layout: fact.layout} : {})}), fact.local_jobs, fact.country, fact.families.join(',')));
  if (db.batch) await db.batch(statements); else for (const statement of statements) await statement.run();
}

/** A scout board not measured within SCOUT_BOARD_DAYS of `date` leaves (no longer served by agreedSites nor counted on Scouting).
 *  Why (12 Nov 2026, Gitar on web#581): it ran inside storeBoardFacts, so only on a publish that sent board facts; while the scout sent none, a 30-day-old board stayed served. Every publish now. */
async function expireBoardFacts(db, date) {
  const cutoff = new Date(Date.parse(date) - SCOUT_BOARD_DAYS * 86400000).toISOString().slice(0, 10);
  await db.prepare(`DELETE FROM sitefacts WHERE install LIKE ? AND kind = 'board' AND day < ?`).bind(`${SCOUT_BOARD_PREFIX}%`, cutoff).run();
}

// The Brain bot an alert falls back to when the switchboard cannot deliver (shared/notify-send.js).
const brainBot = env => (env.BRAIN_BOT_TOKEN && env.BRAIN_CHAT_ID ? {token: env.BRAIN_BOT_TOKEN, chat: env.BRAIN_CHAT_ID} : null);

/**
 * Keeps this publish's body as the UTC day's copy for COPY_DAYS (a later publish that day replaces it). Returns 'kept' or 'failed'; never throws, a copy is never a reason to refuse the index. A failure tells the owner.
 * To go back to a day, from workers/www: `wrangler kv key get --remote --binding WAITLIST index:copy:<day>`, then PUT that body to /api/index with INDEX_PUBLISH_KEY; it passes the same checks as any publish, and replays that day's board facts and stats under today's date.
 * A copy over about 7 days old comes back in steps: the next scout run keeps only feeds read in the last 7 days (public src/scout_carry.py CARRY_DAYS) and re-reads the rest, oldest first.
 */
// Why (5 Nov 2026, owner: "Find root cause, and preven this happening again"): on 2 Nov the scout lost its cache and published 3,871 of 6,833 feeds, and no old copy existed. The raw body, so a restore is one more publish. KV: 25 MiB a value, above the 20 MB publish limit for the scout's plain ASCII; about 3.6 MB a day today, 600 MB at worst, in the 1 GB the plan includes.
async function keepCopy(env, raw, day) {
  try { await env.WAITLIST.put(`${COPY_PREFIX}${day}`, raw, {expirationTtl: COPY_DAYS * 86400}); return 'kept'; }
  catch (error) {
    console.log(`index copy: ${String(error?.message || error).slice(0, 200)}`);
    await alertOwner(env, 'index-copy-failed', {text: employerCard('copy-failed', {day}).text, html: true, level: 'problem', legacy: brainBot(env)}).catch(() => {});
    return 'failed';
  }
}

/** A publish a guard stopped: the 409 the scout shows red, and the owner told. A failed telling never changes the refusal. */
// Why (5 Nov 2026, owner's brief): the scout's run alone said so, and nobody reads a run that is red every 6 h; `daily` in the registry makes it at most one message a UTC day.
async function refuse(env, why) {
  await alertOwner(env, 'index-publish-refused', {text: employerCard('publish-refused', {why}).text, html: true, level: 'problem', legacy: brainBot(env)}).catch(() => {});
  return text(409, `Refused: ${why}`);
}

async function publish(request, env) {
  const key = env.INDEX_PUBLISH_KEY;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!key || !equal(given, key)) return text(404, 'Not found');
  const raw = await request.text();
  if (raw.length > MAX_PUBLISH_BYTES) return text(413, 'Too large');
  let body;
  try { body = JSON.parse(raw); } catch { return text(400, 'Send JSON'); }
  const feeds = clean(body.feeds).slice(0, MAX_FEEDS);
  if (!feeds.length) return text(400, 'No valid feeds');
  // A broken scout run must not wipe the list everyone downloads: a publish keeping under 90% of the employers is refused.
  // Why (6 Nov 2026, owner: "Alert on fields, block on employers (Recommended)", then "Refuse a loss over 10% (Recommended)", replacing #453's 60%): on 2 Nov feeds fell to 57% (6,833 to 3,871) under the old line of half,
  // and every publish was green. The line compares counts: a run that loses some employers and finds others is judged by what it keeps. Normal runs drop about 0.7% (48 of 6,833 feeds over 4 days), so 10% also catches a smaller breakage, like one big job host down during a run.
  // A planned big cleanup would be refused too; none is planned, and the dated copies make any drop restorable.
  // json_valid: one hand-edited row that is not JSON must not turn every publish into an error (review, 6 Nov 2026).
  const inD1 = env.STATS ? (await env.STATS.prepare(`SELECT COUNT(*) AS n, COUNT(CASE WHEN json_valid(body) THEN json_extract(body, '$.kinds') END) AS kinds FROM index_feeds`).first()) : null;
  // Why (6 Nov 2026, review): with D1, D1 alone is the line. The KV copy is rewritten only while the list fits one value, so an old copy would refuse every normal publish.
  // An emptied table is not a line of zero: then the KV copy is the line, as before D1.
  const fromD1 = Boolean(inD1?.n), stored = fromD1 ? null : JSON.parse((await env.WAITLIST.get(KEY)) || '{"feeds":[]}').feeds;
  const previous = fromD1 ? inD1.n : stored.length, previousKinds = fromD1 ? inD1.kinds || 0 : stored.filter(feed => feed.kinds).length, withKinds = feeds.filter(feed => feed.kinds).length;
  if (previous >= 10 && feeds.length < previous * KEEP_SHARE) return refuse(env, `${feeds.length} feeds would replace ${previous}`);
  const generated = new Date().toISOString();
  if (env.STATS) await store(env.STATS, feeds, generated);
  // Why (6 Nov 2026, owner: "Alert on fields, block on employers (Recommended)"): on 2 Nov feeds with kinds fell from 3,926 to 9. A big drop of a field is told the same day but never refused:
  // the scout drops kinds judged before role_kinds.SINCE on purpose when that date moves, and a refusal then would freeze the list. The dated copy makes any drop restorable.
  // Told right after D1 holds the drop (review): a later write that fails would make the scout's retry compare with the drop, and nobody would hear of it.
  if (previousKinds >= 10 && withKinds < previousKinds / 2) await alertOwner(env, 'index-kinds-dropped', {text: employerCard('kinds-dropped', {withKinds, previousKinds}).text, html: true, level: 'problem', legacy: brainBot(env)}).catch(() => {});
  await env.WAITLIST?.put(GENERATED_KEY, generated);
  await env.WAITLIST?.put(SUMMARY_KEY, JSON.stringify(summary(feeds)));
  // "No readable job site", checked here like everything published: a key, a name, a host, a date.
  // Test employers ("E2E Ghost", 7 Oct 2026) are never published, whatever reached the central scout.
  const nofeed = (Array.isArray(body.nofeed) ? body.nofeed : []).filter(item => item && /^[a-z0-9]{1,120}$/.test(item.key || '') && !/^e2e/.test(item.key) && /^\d{4}-\d{2}-\d{2}$/.test(item.last || ''))
    .slice(0, MAX_NOFEED).map(item => ({key: item.key, company: String(item.company || '').slice(0, 120), host: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item.host || '') ? item.host : null, last: item.last}));
  if (env.WAITLIST) await env.WAITLIST.put(NOFEED_KEY, JSON.stringify(nofeed));
  if (env.WAITLIST && Array.isArray(body.boards)) await env.WAITLIST.put(BOARDS_KEY, JSON.stringify(boardsOf(body.boards)));
  // The scout's measured boards, only when it sent some (an absent field keeps what is there); never a reason to refuse the index.
  const boardFacts = boardFactsOf(body.board_facts);
  if (env.STATS && boardFacts.length) await storeBoardFacts(env.STATS, boardFacts, generated.slice(0, 10)).catch(() => false);
  if (env.STATS) await expireBoardFacts(env.STATS, generated.slice(0, 10)).catch(() => false);
  // The day's snapshot for /admin/job-search/scouting's growth: counts only; never a reason to refuse the index.
  if (env.STATS) {
    const pooled = await pooledKeys(env.STATS);
    const date = generated.slice(0, 10);
    await storeSnapshot(env.STATS, date, snapshot(feeds, feeds.filter(feed => pooled.has(`${feed.ats}:${feed.slug}`)).length, nofeed.length)).catch(() => false);
    await storePoolSnapshot(env.STATS, date, poolSnapshot(feeds, pooled)).catch(() => false);   // what installs add, for /admin/job-search/installs (migration 0102)
    await storeBoardCounts(env.STATS, date).catch(() => false);   // the published boards per family × country, for the Scouting page's trend (migration 0150)
  }
  // The central scout's own numbers for /intel (shared/scouting.js): never a reason to refuse the index.
  if (env.STATS && body.stats) await storeScouting(env.STATS, body.stats, generated.slice(0, 10)).catch(() => false);
  // Older app versions download the whole list from KV: kept while it fits in one value, else left as it was (they update soon).
  const legacy = JSON.stringify({version: 1, generated, feeds});
  const kept = legacy.length <= MAX_BYTES;
  if (kept) await env.WAITLIST.put(KEY, legacy);
  const copy = await keepCopy(env, raw, generated.slice(0, 10));
  return Response.json({ok: true, feeds: feeds.length, ...(boardFacts.length ? {board_facts: boardFacts.length} : {}), d1: !!env.STATS, legacy: kept ? 'updated' : 'too large, unchanged', copy});
}

// Is a feed worth rewriting? (14 Oct 2026: 11.7k feed writes a day, 23k rows, though most feeds only had a new "checked"/"ok" date or a drifting job count.)
// Rewritten when anything else changed, a date moved 7+ days past the stored one, a count crossed zero or moved more than 25% (kind counts: each country × kind), or failing started or stopped.
const DATES_DAYS = 7, COUNT_SHARE = 0.25;
const countKeys = counts => (counts ? Object.fromEntries(Object.entries(counts).map(([country, kinds]) => [country, Object.keys(kinds).sort()])) : undefined);
const stablePart = feed => JSON.stringify({...feed, checked: undefined, jobs: undefined, relevant: undefined, kind_counts: countKeys(feed.kind_counts),
  fresh: feed.fresh ? {failing: (feed.fresh.fails || 0) > 0, trend: feed.fresh.trend, new: feed.fresh.new} : undefined});
const daysApart = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 86400000 : a === b ? 0 : Infinity);
const countMoved = (a, b) => ((a || 0) === 0) !== ((b || 0) === 0) || Math.abs((b || 0) - (a || 0)) > COUNT_SHARE * Math.max(a || 0, b || 0);
export function worthWriting(stored, feed) {
  if (!stored) return true;
  if (stablePart(stored) !== stablePart(feed)) return true;
  if (daysApart(stored.checked, feed.checked) >= DATES_DAYS || daysApart(stored.fresh?.ok, feed.fresh?.ok) >= DATES_DAYS) return true;
  const kindMoved = Object.entries(feed.kind_counts || {}).some(([country, kinds]) => Object.entries(kinds).some(([kind, n]) => countMoved(stored.kind_counts?.[country]?.[kind], n)));
  return kindMoved || countMoved(stored.jobs, feed.jobs) || countMoved(stored.relevant, feed.relevant) || countMoved(stored.fresh?.jobs, feed.fresh?.jobs);
}

// Make the D1 index this list, writing only what differs (11 Oct 2026: a full rewrite of ~4.3k feeds, three times a day, wrote 8.5k rows a time and spent a quarter of the free plan's daily
// writes): one read of the stored feeds, then an INSERT for a feed that is new or whose body changed, a DELETE for one no longer listed. A same-list publish writes nothing.
// In batches (D1 runs a batch as one transaction).
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };
const regionsOf_ = feed => `,${feed.regions.join(',')}${feed.regions.length ? ',' : ''}`;
async function store(db, feeds, generated) {
  const old = new Map((((await db.prepare('SELECT ats, slug, regions, body FROM index_feeds').all()).results) || []).map(row => [`${row.ats}\n${row.slug}`, row]));
  const statements = [], keep = new Set();
  for (const feed of feeds) {
    const key = `${feed.ats}\n${feed.slug}`, body = JSON.stringify(feed), regions = regionsOf_(feed), was = old.get(key);
    keep.add(key);
    if (was && was.regions === regions && (was.body === body || !worthWriting(parsed(was.body), feed))) continue;
    // An upsert, not INSERT OR REPLACE: a replace is a delete plus an insert (2 rows written per feed, 14 Oct 2026).
    statements.push(db.prepare('INSERT INTO index_feeds (ats, slug, regions, body, generated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ats, slug) DO UPDATE SET regions = excluded.regions, body = excluded.body, generated = excluded.generated')
      .bind(feed.ats, feed.slug, regions, body, generated));
  }
  for (const [key, row] of old) if (!keep.has(key)) statements.push(db.prepare('DELETE FROM index_feeds WHERE ats = ? AND slug = ?').bind(row.ats, row.slug));
  if (!statements.length) return 0;
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return statements.length;
}

export function index(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') return download(request, env);
  if (request.method === 'PUT') return publish(request, env);
  return text(405, 'Use GET', {Allow: 'GET, HEAD, PUT'});
}
