// The central employer index route: GET needs an install token (or the owner's key) with a daily cap, a public summary holds only counts,
// and the key-protected PUT can't wipe the list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {MAX_NOFEED, clean, familyJobsOf} from '../../../api/employers.js';

const store = new Map();
const env = () => ({INDEX_PUBLISH_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')},
  WAITLIST: {get: async key => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); }}});
const call = (e, method, headers = {}, body) => worker.fetch(new Request('https://www.jobpilotto.top/api/index',
  {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, {});
const feed = (slug, extra = {}) => ({company: `Co ${slug}`, ats: 'lever', slug, quality: 71.6, jobs: 12, relevant: 4.6, checked: '2026-09-30', places: ['Zurich, Switzerland', 7], ...extra});
const auth = {Authorization: 'Bearer k3y'};
// An install's token for the index, minted the way the engine does.
const tokenOf = async (install, purpose = 'index') => (await (await worker.fetch(new Request('https://www.jobpilotto.top/api/install-token',
  {method: 'POST', body: JSON.stringify({install, purpose})}), env(), {})).json()).token;
const holder = async (install = 'abcd-1234-efgh') => ({'X-Install-Id': install, Authorization: `Bearer ${await tokenOf(install)}`});


test('before anything is published: 404, so clients keep their starter list', async () => {
  store.clear();
  assert.equal((await call(env(), 'GET')).status, 404);
});

test('publishing needs the key; without it the route looks absent', async () => {
  store.clear();
  assert.equal((await call(env(), 'PUT', {}, {feeds: [feed('a')]})).status, 404);
  assert.equal((await call(env(), 'PUT', {Authorization: 'Bearer nope'}, {feeds: [feed('a')]})).status, 404);
  assert.equal((await call({...env(), INDEX_PUBLISH_KEY: undefined}, 'PUT', {Authorization: 'Bearer undefined'}, {feeds: [feed('a')]})).status, 404);
  assert.equal(store.size, 0);
});

test('publish, then installs with a token download it: private cache, ETag revalidation; no credentials get a 401', async () => {
  store.clear();
  const bad = [{company: 'Evil', ats: 'nonsense', slug: 'x'}, {company: 'NoSlug', ats: 'lever'}, 'junk', feed('a', {tier: 'weird'})];
  const put = await call(env(), 'PUT', auth, {feeds: [...bad, feed('a')]});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).feeds, 1);   // unknown ATS, slug-less, junk and the duplicate are dropped
  assert.equal((await call(env(), 'GET')).status, 401);   // no credentials
  const get = await call(env(), 'GET', await holder());
  assert.equal(get.status, 200);
  assert.match(get.headers.get('Cache-Control'), /private, max-age=/);
  const body = await get.json();
  assert.deepEqual(body.feeds[0], {company: 'Co a', ats: 'lever', slug: 'a', tier: 'Standard', quality: 72, jobs: 12, checked: '2026-09-30', places: ['Zurich, Switzerland'], kind: 'employer', fits: {roles: [], regions: []}, regions: [], relevant: 5});
  const again = await call(env(), 'GET', {...await holder(), 'If-None-Match': get.headers.get('ETag')});
  assert.equal(again.status, 304);
  assert.equal((await call(env(), 'GET', auth)).status, 200);   // the owner's scout
});

test('a token opens only what it was minted for; a wrong or missing install id is refused', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const forRecipes = await tokenOf('abcd-1234-efgh', 'recipes');
  assert.equal((await call(env(), 'GET', {'X-Install-Id': 'abcd-1234-efgh', Authorization: `Bearer ${forRecipes}`})).status, 401);
  assert.equal((await call(env(), 'GET', {...await holder(), 'X-Install-Id': 'someone-else-1'})).status, 401);
  assert.equal((await call(env(), 'GET', {Authorization: `Bearer ${await tokenOf('abcd-1234-efgh')}`})).status, 401);
});

test('the summary is public and holds only counts, never the feeds', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b', {kind: 'board'}), feed('c', {jobs: 8})]});
  const res = await worker.fetch(new Request('https://www.jobpilotto.top/api/index?summary=1'), env(), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {employers: 2, jobs: 20});   // the job portal is not counted as an employer
});

// 20 Oct 2026: the landing said 2,183 employers for 12 days while the list held 5,604. Once the list outgrew one KV value, publish left the
// old copy as it was and the summary kept counting that copy.
test('the summary follows every publish, also once the list is too large for the old single-value copy', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b')]});
  const many = Array.from({length: 6000}, (_, i) => feed(`big-employer-number-${i}`, {places: ['Zurich, Switzerland', 'Geneva, Switzerland', 'Remote, Europe']}));
  const put = await call(env(), 'PUT', auth, {feeds: many});
  assert.match((await put.json()).legacy, /too large/);   // the precondition: the old copy was not rewritten
  const res = await worker.fetch(new Request('https://www.jobpilotto.top/api/index?summary=1'), env(), {});
  assert.deepEqual(await res.json(), {employers: 6000, jobs: 72000});
});

test('an install can download a few times a day, then waits', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const e = env(), headers = await holder('limit-install-1');
  const get = () => worker.fetch(new Request('https://www.jobpilotto.top/api/index', {headers}), e, {});
  for (let i = 0; i < 24; i++) assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 429);
});

test('a download changes nothing stored', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const before = store.get('index:employers');
  assert.equal((await call(env(), 'GET', await holder())).status, 200);
  assert.equal(store.get('index:employers'), before);
});

test('a broken scout run cannot wipe the list, and empty or invalid bodies are refused', async () => {
  store.clear();
  const many = Array.from({length: 20}, (_, i) => feed(`s${i}`));
  assert.equal((await call(env(), 'PUT', auth, {feeds: many})).status, 200);
  assert.equal((await call(env(), 'PUT', auth, {feeds: many.slice(0, 5)})).status, 409);
  assert.equal((await call(env(), 'PUT', auth, {feeds: []})).status, 400);
  assert.equal(JSON.parse(store.get('index:employers')).feeds.length, 20);
  const raw = await worker.fetch(new Request('https://www.jobpilotto.top/api/index', {method: 'PUT', headers: auth, body: 'not json'}), env(), {});
  assert.equal(raw.status, 400);
});

test('other methods are refused', async () => {
  assert.equal((await call(env(), 'POST', auth, {feeds: []})).status, 405);
});

test('the landing page reads the pool size from the public summary of this route, and the site says users can add their own employers', async () => {
  // Since the redesign (owner, 20 Oct 2026) the landing shows two live numbers (site.js fills them) and the detail lives on /coverage and /faq.
  const {readFileSync} = await import('node:fs');
  const pub = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');
  const page = pub('index.html');
  assert.match(pub('site.js'), /fetch\('\/api\/coverage'\)/);   // the same snapshot as /coverage (24 Oct 2026)
  assert.match(page, /<b data-count="employers">[^<]+<\/b>/);
  assert.match(page, /<b data-count="jobs">[^<]+<\/b>/);
  assert.match(page, /<script src="\/?site\.js"/);
  for (const name of ['index.html', 'coverage.html']) {
    assert.doesNotMatch(pub(name), /IT & engineering roles/, name);   // every open job, all roles
    assert.doesNotMatch(pub(name), /tech jobs in Switzerland/, name);   // the list is Europe-wide; the focus is the kind of job
  }
  assert.match(pub('coverage.html'), /Add any company you care about/);   // the list is a start, not the limit
  assert.match(pub('faq.html'), /Can I add my own employers\?/);
  assert.match(pub('faq.html'), /switch that off in Settings/);   // the sharing note lives in the FAQ and privacy page
  const privacy = readFileSync(new URL('../../../web/public/privacy.html', import.meta.url), 'utf8');
  assert.match(privacy, /on by default/);
  assert.match(privacy, /Every install also helps it grow, <b>on by default<\/b> \(you can turn it off\)/);   // opt-out for everyone (7 Oct 2026)
  assert.doesNotMatch(page, /maintained (employer )?index/i);
});

test('an entry can be marked as a job portal; anything else is an employer', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a'), feed('b', {kind: 'board'}), feed('c', {kind: 'weird'})]});
  const kinds = (await (await call(env(), 'GET', auth)).json()).feeds.map(f => f.kind);
  assert.deepEqual(kinds, ['employer', 'board', 'employer']);
});

test('the index keeps who a feed fits, from the fixed lists only', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a', {fits: {roles: ['sre_devops', 'my-secret'], regions: ['europe', 'Zurich']}}), feed('b')]});
  const feeds = (await (await call(env(), 'GET', auth)).json()).feeds;
  assert.deepEqual(feeds[0].fits, {roles: ['sre_devops'], regions: ['europe']});
  assert.deepEqual(feeds[1].fits, {roles: [], regions: []});
});

test('the index keeps the countries a feed hires in, fixed ids only, and none when it has none', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a', {countries: ['de', 'hu', 'Zurich', 'de']}), feed('b')]});
  const feeds = (await (await call(env(), 'GET', auth)).json()).feeds;
  assert.deepEqual(feeds[0].countries, ['de', 'hu']);
  assert.equal('countries' in feeds[1], false);
});

test('in the soft rollout older installs without a token still get the list, and are counted', async () => {
  store.clear();
  await call(env(), 'PUT', auth, {feeds: [feed('a')]});
  const soft = {...env(), INDEX_GATE: 'soft'};
  assert.equal((await call(soft, 'GET')).status, 200);
  assert.equal((await call(soft, 'GET', {'X-Install-Id': 'abcd-1234-efgh', Authorization: 'Bearer wrong'})).status, 200);
  assert.equal((await call(env(), 'GET')).status, 401);   // the default enforces
});

// ---------- the index in D1: an install downloads the slice for its own regions ----------
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../../db/migrations/0018_employer_index.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
function d1sitefacts() {
  const handle = d1();
  for (const file of ['0037_pool_sitefacts.sql', '0038_sitefacts_layout.sql', '0094_sitefacts_board_yield.sql']) {
    try { handle.db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8')); } catch (error) { if (!/duplicate column|already exists/.test(String(error))) throw error; }
  }
  handle.batch = async statements => { for (const statement of statements) await statement.run(); };
  return handle;
}
const sliced = (e, regions, headers) => worker.fetch(new Request(`https://www.jobpilotto.top/api/index?regions=${regions}`, {headers}), e, {});

test('published feeds land in D1 with their regions, and an install gets only its regions plus feeds of unknown places', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  const feeds = [feed('zh', {regions: ['europe']}), feed('ny', {regions: ['north_america']}), feed('rem', {regions: ['remote', 'europe']}),
    feed('nowhere', {regions: []}), feed('bad', {regions: ['mars', 'europe']})];
  const put = await call(e, 'PUT', auth, {feeds});
  assert.deepEqual(await put.json(), {ok: true, feeds: 5, d1: true, legacy: 'updated', copy: 'kept'});
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.equal(got.version, 2);
  assert.deepEqual(got.feeds.map(f => f.slug).sort(), ['bad', 'nowhere', 'rem', 'zh']);   // not the New York feed
  assert.deepEqual(got.feeds.find(f => f.slug === 'bad').regions, ['europe'], 'unknown region words are dropped');
  const remote = await (await sliced(e, 'remote,evil', await holder())).json();
  assert.deepEqual(remote.feeds.map(f => f.slug).sort(), ['nowhere', 'rem']);
  // A call without regions gets the whole list, from D1.
  assert.equal((await (await call(e, 'GET', await holder())).json()).feeds.length, 5);
});

test('the slice needs a token like the whole list, and a later publish replaces the D1 rows', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await call(e, 'PUT', auth, {feeds: Array.from({length: 12}, (_, i) => feed(`f${i}`, {regions: ['europe']}))});
  assert.equal((await sliced(e, 'europe', {})).status, 401);
  assert.equal((await call(e, 'PUT', auth, {feeds: [feed('only', {regions: ['europe']})]})).status, 409, 'a sudden loss is refused');
  await call(e, 'PUT', auth, {feeds: Array.from({length: 11}, (_, i) => feed(`g${i}`, {regions: ['europe']}))});
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.deepEqual(got.feeds.map(f => f.slug).sort(), Array.from({length: 11}, (_, i) => `g${i}`).sort());
});

test('a list too large for one KV value still goes to D1, and a call without regions gets the fresh whole list, not the stale KV copy', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  await call(e, 'PUT', auth, {feeds: [feed('small', {regions: ['europe']})]});
  const big = Array.from({length: 4000}, (_, i) => feed(`b${i}`, {regions: ['europe'], places: Array.from({length: 8}, (_, j) => `Place ${j} ${'x'.repeat(30)}`)}));
  const answer = await (await call(e, 'PUT', auth, {feeds: big})).json();
  assert.equal(answer.legacy, 'too large, unchanged');
  assert.equal((await (await sliced(e, 'europe', await holder())).json()).feeds.length, 4000);
  assert.equal((await (await call(e, 'GET', await holder())).json()).feeds.length, 4000, 'no regions: the fresh list, not the 1-feed KV copy');
});

test('the central scout sends its own numbers with the index; they are checked to a fixed shape and shown on /intel', async () => {
  store.clear();
  const db = d1();
  db.db.exec(readFileSync(new URL('../../../db/migrations/0019_scouting.sql', import.meta.url), 'utf8').split('\n').filter(line => !line.startsWith('ALTER')).join('\n'));
  const e = {...env(), STATS: db};
  const stats = {feeds: 412, jobs: 39000, relevant: 2100, by_ats: {greenhouse: 120, '<script>': 1}, by_region: {europe: 300}, queue: {pending: 2954, found: 400},
    recipes: 12, page_reads: 30, link_choices: 9, commoncrawl: 'CC-MAIN-2026-39', ideas_at: '2026-10-03T04:30:00', ideas_note: 'Tried Swiss banks <b>now</b>',
    sources: [{origin: 'Common Crawl', probed: 500, found: 40}], market: [{term: 'devops', ours: 61, jobsch: 305}], extra: 'dropped'};
  await call(e, 'PUT', auth, {feeds: [feed('a', {regions: ['europe']})], stats});
  const {load, section} = await import('../../../shared/scouting.js');
  const shown = await load(db);
  assert.equal(shown.feeds, 412);
  assert.equal(shown.extra, undefined);
  assert.deepEqual(Object.keys(shown.by_ats), ['greenhouse', 'script']);
  const html = section(shown);
  assert.match(html, /Market coverage/);
  assert.match(html, /<b>20%<\/b>/);                 // 61 of 305
  assert.doesNotMatch(html, /<b>now<\/b>/, 'text from the scout is escaped');
});

// What a feed hires for (src/role_kinds.py): only known kinds and shares 0–1 reach the apps; anything else is dropped, never passed on.
test('a feed\'s mix of kinds is kept only in its fixed shape', () => {
  const [kept, odd, none] = clean([
    {company: 'Datadog', ats: 'greenhouse', slug: 'datadog', kinds: {software: 0.951, hacking: 1, other: 3, logistics: '0.2'}},
    {company: 'Odd', ats: 'greenhouse', slug: 'odd', kinds: ['software']},
    {company: 'None', ats: 'greenhouse', slug: 'none'}]);
  assert.deepEqual(kept.kinds, {software: 0.95});
  assert.equal('kinds' in odd, false);
  assert.equal('kinds' in none, false);
});

// How many of a feed's jobs in each country are of each kind (src/scout_index.py kind_counts; owner, 26 Oct 2026: an employer is read only when
// its jobs in the person's countries are their kind): fixed country and kind ids, whole numbers; anything else is dropped.
test('a feed\'s kind counts per country are kept only in their fixed shape', () => {
  const [kept, odd, none] = clean([
    {company: 'An Airline', ats: 'greenhouse', slug: 'airline', kind_counts: {ch: {aviation_transport: 12.4, hospitality: 3, hacking: 2, legal: 0, trades: '4'}, xx: {software: 9}, de: {software: -1}}},
    {company: 'Odd', ats: 'greenhouse', slug: 'odd', kind_counts: [['ch', 3]]},
    {company: 'None', ats: 'greenhouse', slug: 'none'}]);
  assert.deepEqual(kept.kind_counts, {ch: {aviation_transport: 12, hospitality: 3}});
  assert.equal('kind_counts' in odd, false);
  assert.equal('kind_counts' in none, false);
});

test('a feed is not rewritten for a small drift in its kind counts, only for a new kind or country or a count moved past 25%', async () => {
  const {worthWriting} = await import('../../../api/employers.js');
  const base = {company: 'Acme', ats: 'greenhouse', slug: 'acme', jobs: 40, kind_counts: {ch: {aviation_transport: 20, hospitality: 4}}};
  assert.equal(worthWriting(base, {...base, kind_counts: {ch: {aviation_transport: 22, hospitality: 4}}}), false, 'counts within 25%');
  assert.equal(worthWriting(base, {...base, kind_counts: {ch: {aviation_transport: 30, hospitality: 4}}}), true, 'a count moved past 25%');
  assert.equal(worthWriting(base, {...base, kind_counts: {ch: {aviation_transport: 20, hospitality: 4, legal: 1}}}), true, 'a new kind');
  assert.equal(worthWriting(base, {...base, kind_counts: {ch: {aviation_transport: 20, hospitality: 4}, de: {software: 3}}}), true, 'a new country');
  assert.equal(worthWriting({...base, kind_counts: undefined}, base), true, 'counted for the first time');
});

test('a feed\'s freshness is kept only in its fixed shape', () => {
  const [kept, odd] = clean([
    {company: 'Coop', ats: 'successfactors', slug: 'jobs.coop.ch', fresh: {ok: '2026-10-06', fails: 2, jobs: 3200, trend: 'up', new: '2026-10-06', extra: 'x'}},
    {company: 'Odd', ats: 'lever', slug: 'odd', fresh: {ok: 'never'}}]);
  assert.deepEqual(kept.fresh, {ok: '2026-10-06', fails: 2, jobs: 3200, trend: 'up', new: '2026-10-06'});
  assert.equal('fresh' in odd, false);
});

test('the index keeps who a feed fits (finer labels, quiet), its outcome totals past 3 installs, and per-board stats, in fixed shapes only', async () => {
  const {clean, boardsOf} = await import('../../../api/employers.js');
  const [feed] = clean([{company: 'Studio', ats: 'lever', slug: 'studio', fits: {roles: ['creative_media'], families: ['photography', 'spy'], metros: ['ch-geneva'],
    quiet: {families: ['nursing_care'], roles: ['nope']}}, pool: {installs: 4, matched: 3, applied: 2, interview: 1, name: 'x'}}]);
  assert.deepEqual(feed.fits, {roles: ['creative_media'], regions: [], metros: ['ch-geneva'], families: ['photography'], quiet: {roles: [], families: ['nursing_care']}});
  assert.deepEqual(feed.pool, {installs: 4, matched: 3, applied: 2, interview: 1});
  assert.equal(clean([{company: 'Tiny', ats: 'lever', slug: 'tiny', pool: {installs: 2, interview: 1}}])[0].pool, undefined, 'under 3 installs: never published');
  assert.deepEqual(boardsOf([{board: 'jooble', installs: 10, matched: 4, by: {families: {photography: [5, 4], spy: [9, 9]}, metros: {'ch-geneva': [2, 1]}}}, {board: 'evil'}]),
    [{board: 'jooble', installs: 10, matched: 4, by: {roles: {}, regions: {}, countries: {}, metros: {}, families: {photography: [5, 4]}}}]);
});

test('"still this publish?" is answered 304 from KV alone and not counted against the day\'s downloads (7 Oct 2026)', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('../../../api/employers.js', import.meta.url), 'utf8');
  const check = source.indexOf("request.headers.get('X-Index-Generated')"), quota = source.indexOf('const full = used >= INDEX_PER_INSTALL_PER_DAY;');
  assert.ok(check > 0 && check < quota, 'the publish-time check comes before the daily count');
  assert.match(source, /await env\.WAITLIST\?\.put\(GENERATED_KEY, generated\)/);
});

test('a publish writes only the feeds that changed (11 Oct 2026: the full rewrite spent a quarter of the day\'s D1 writes), and removes the ones no longer listed', async () => {
  store.clear();
  const e = {...env(), STATS: d1()}, changes = () => e.STATS.db.prepare('SELECT total_changes() AS n').get().n;
  const feeds = Array.from({length: 12}, (_, i) => feed(`f${i}`, {regions: ['europe']}));
  await call(e, 'PUT', auth, {feeds});
  let before = changes();
  assert.equal((await call(e, 'PUT', auth, {feeds})).status, 200);
  assert.equal(changes() - before, 0, 'a publish of the same list wrote rows');
  before = changes();
  await call(e, 'PUT', auth, {feeds: feeds.map((item, at) => (at === 3 ? {...item, jobs: 99} : item))});
  assert.ok(changes() - before <= 2, `one changed feed wrote ${changes() - before} rows`);
  assert.equal(JSON.parse(e.STATS.db.prepare("SELECT body FROM index_feeds WHERE slug = 'f3'").get().body).jobs, 99);
  await call(e, 'PUT', auth, {feeds: feeds.slice(0, 11)});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM index_feeds').get().n, 11, 'a feed no longer listed stays');
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.equal(got.generated, store.get('index:generated'), 'the slice says when the LAST publish was, not when its newest row changed');
});

test('a feed is rewritten only for a real change, never for a new date or a small count drift (14 Oct 2026: 23k rows written a day)', async () => {
  const {worthWriting} = await import('../../../api/employers.js');
  const base = {company: 'Acme', ats: 'greenhouse', slug: 'acme', jobs: 40, relevant: 10, checked: '2026-10-10', fresh: {ok: '2026-10-10', fails: 0, jobs: 40, trend: 'flat', new: null}, regions: ['europe']};
  assert.equal(worthWriting(null, base), true, 'a new feed');
  assert.equal(worthWriting(base, {...base, checked: '2026-10-12', fresh: {...base.fresh, ok: '2026-10-12'}}), false, 'dates 2 days later');
  assert.equal(worthWriting(base, {...base, checked: '2026-10-17'}), true, 'a date 7 days later');
  assert.equal(worthWriting(base, {...base, jobs: 44, relevant: 11}), false, 'counts within 25%');
  assert.equal(worthWriting(base, {...base, jobs: 60}), true, 'a count moved more than 25%');
  assert.equal(worthWriting(base, {...base, relevant: 0}), true, 'a count fell to zero');
  assert.equal(worthWriting(base, {...base, fresh: {...base.fresh, fails: 2}}), true, 'the feed started failing');
  assert.equal(worthWriting(base, {...base, fresh: {...base.fresh, fails: 3}}), true);
  assert.equal(worthWriting({...base, fresh: {...base.fresh, fails: 2}}, {...base, fresh: {...base.fresh, fails: 3}}), false, 'still failing');
  assert.equal(worthWriting(base, {...base, company: 'Acme AG'}), true, 'any other field');
});

test('the central scout\'s dead ends are published up to the cap (20 Oct 2026: 5,000 was full, the rest was probed again)', async () => {
  store.clear();
  const e = {...env(), STATS: d1()};
  const nofeed = Array.from({length: 6000}, (_, i) => ({key: `co${i}`, company: `Co ${i}`, host: null, last: '2026-10-20'}));
  await call(e, 'PUT', auth, {feeds: [feed('zh', {regions: ['europe']})], nofeed});
  const got = await (await sliced(e, 'europe', await holder())).json();
  assert.equal(got.nofeed.length, 6000);
  assert.equal(MAX_NOFEED, 10000);
});


test('the central scout\'s measured boards are served as the same board fact installs share, one row per country, and a missing field keeps them (24 Oct 2026)', async () => {
  store.clear();
  const e = {...env(), STATS: d1sitefacts()};
  const good = {host: 'delucru.md', url: 'https://delucru.md/search?q={role}', country: 'md', families: ['software_dev', 'nonsense'], local_jobs: 14};
  const board_facts = [good, {...good, host: 'rabota.md', url: 'https://rabota.md/jobs?q={role}&place={place}', local_jobs: 22},
    {...good, host: 'section.md', url: 'https://section.md/jobs/it-software', local_jobs: 9},       // a board's own section page: no placeholder, kept
    {...good, host: 'few.md', url: 'https://few.md/?q={role}', local_jobs: 2},                  // under 3 local jobs
    {...good, host: 'evil.example', url: 'https://other.example/?q={role}'},                      // address not on its own host
    {...good, host: 'plain.md', url: 'http://plain.md/?q={role}'},                                // not https
    {...good, host: 'tok.md', url: 'https://tok.md/?q={role}&t={token}'},                         // another placeholder
    {...good, host: 'zz.md', country: 'zz'}, {...good, host: 'nofam.md', families: ['nonsense']},
    {...good, host: 'needs.md', url: 'https://needs.md/?q={role}', browser: true},                // measured in the scout's browser: the flag rides in the recipe
    {...good, host: 'truthy.md', url: 'https://truthy.md/?q={role}', browser: 'yes'}];            // anything but true is no flag
  const put = await (await call(e, 'PUT', auth, {feeds: [feed('a')], board_facts})).json();
  assert.equal(put.board_facts, 5);
  const {agreedSites} = await import('../../../api/employers.js');
  const facts = (await agreedSites(e)).filter(fact => fact.kind === 'board').sort((a, b) => a.host.localeCompare(b.host));
  // 13 Nov 2026 (bp): these facts carry no count per family (kept before it): they prove no family, so no cell is `measured`
  assert.deepEqual(facts.map(f => [f.host, f.url, f.recipe, f.installs, f.relevant]), [
    ['delucru.md', good.url, {countries: ['md']}, 1, [{family: 'software_dev', country: 'md', installs: 1, in_places: 14, fit70: 0}]],
    ['needs.md', 'https://needs.md/?q={role}', {countries: ['md'], browser: true}, 1, [{family: 'software_dev', country: 'md', installs: 1, in_places: 14, fit70: 0}]],
    ['rabota.md', 'https://rabota.md/jobs?q={role}&place={place}', {countries: ['md']}, 1, [{family: 'software_dev', country: 'md', installs: 1, in_places: 22, fit70: 0}]],
    ['section.md', 'https://section.md/jobs/it-software', {countries: ['md']}, 1, [{family: 'software_dev', country: 'md', installs: 1, in_places: 9, fit70: 0}]],
    ['truthy.md', 'https://truthy.md/?q={role}', {countries: ['md']}, 1, [{family: 'software_dev', country: 'md', installs: 1, in_places: 14, fit70: 0}]]]);
  await call(e, 'PUT', auth, {feeds: [feed('a')]});   // a publish without the field keeps the facts
  assert.equal((await agreedSites(e)).filter(fact => fact.kind === 'board').length, 5);
  e.STATS.db.prepare("UPDATE sitefacts SET day = '2000-01-01' WHERE host = 'rabota.md'").run();
  await call(e, 'PUT', auth, {feeds: [feed('a')], board_facts: [good]});   // one not measured again for 30 days leaves
  assert.deepEqual((await agreedSites(e)).filter(fact => fact.kind === 'board').map(f => f.host).sort(), ['delucru.md', 'needs.md', 'section.md', 'truthy.md'], 'the recent section stays, the 30-day-old rabota.md left');
  // Gitar on web#581: the expiry ran only on a publish that sent board facts, so an old board stayed served (and counted on Scouting) while the scout sent none.
  e.STATS.db.prepare("UPDATE sitefacts SET day = '2000-01-01' WHERE host = 'section.md'").run();
  await call(e, 'PUT', auth, {feeds: [feed('a')]});
  assert.deepEqual((await agreedSites(e)).filter(fact => fact.kind === 'board').map(f => f.host).sort(), ['delucru.md', 'needs.md', 'truthy.md'], 'a publish without board facts also lets a 30-day-old board leave');
});

// Board layouts (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): board discovery learns how a
// board's job cards are laid out once; installs replay it with no AI question per link. The layout rides in the board fact's recipe, in page_recipes' fixed shape.
test('a measured board keeps the layout board discovery learned, only in the fixed recipe shape; a bad one is dropped and the board kept', async () => {
  store.clear();
  const e = {...env(), STATS: d1sitefacts()};
  const good = {host: 'links.example', url: 'https://links.example/search?q={role}', country: 'md', families: ['software_dev'], local_jobs: 9};
  const board_facts = [{...good, layout: {kind: 'links', prefix: '/job'}},
    {...good, host: 'state.example', url: 'https://state.example/?q={role}', layout: {kind: 'state', path: '0.props.jobs.items'}},
    {...good, host: 'tag.example', url: 'https://tag.example/?q={role}', layout: {kind: 'tag', tag: 'h3', class: 'job-title'}, browser: true},
    {...good, host: 'extra.example', url: 'https://extra.example/?q={role}', layout: {kind: 'links', prefix: '/job', selector: 'a'}},   // another field: no layout
    {...good, host: 'regex.example', url: 'https://regex.example/?q={role}', layout: {kind: 'links', prefix: '/job/(.*)'}},             // a pattern, not a path
    {...good, host: 'tagx.example', url: 'https://tagx.example/?q={role}', layout: {kind: 'tag', tag: 'script', class: 'x'}}];          // a tag not on the list
  assert.equal((await (await call(e, 'PUT', auth, {feeds: [feed('a')], board_facts})).json()).board_facts, 6, 'a bad layout never costs the board');
  const {agreedSites} = await import('../../../api/employers.js');
  const facts = (await agreedSites(e)).filter(fact => fact.kind === 'board').sort((a, b) => a.host.localeCompare(b.host));
  assert.deepEqual(facts.map(f => [f.host, f.recipe]), [
    ['extra.example', {countries: ['md']}],
    ['links.example', {countries: ['md'], layout: {kind: 'links', prefix: '/job'}}],
    ['regex.example', {countries: ['md']}],
    ['state.example', {countries: ['md'], layout: {kind: 'state', path: '0.props.jobs.items'}}],
    ['tag.example', {countries: ['md'], browser: true, layout: {kind: 'tag', tag: 'h3', class: 'job-title'}}],
    ['tagx.example', {countries: ['md']}]]);
  await call(e, 'PUT', auth, {feeds: [feed('a')], board_facts: [good]});   // measured again with no layout learned: the old layout leaves with it
  assert.deepEqual((await agreedSites(e)).find(fact => fact.host === 'links.example').recipe, {countries: ['md']});
});

// A layout's depth (13 Nov 2026, owner: "Yes, add depth (Recommended)"): boards whose job links sit 2 or 3 folders under the prefix (/oferta/<id>/<slug>).
test('a links layout may carry a depth of 2 or 3; depth 1 is served with no field, so installs older than depth keep reading it', async () => {
  const {recipeOf} = await import('../../../api/employers.js');
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/oferta', depth: 2}), {kind: 'links', prefix: '/oferta', depth: 2});
  assert.deepEqual(recipeOf({kind: 'links', prefix: '', depth: 3}), {kind: 'links', prefix: '', depth: 3}, 'the jobs sit under the root');
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/job', depth: 1}), {kind: 'links', prefix: '/job'}, 'depth 1 is today\'s shape');
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/job'}), {kind: 'links', prefix: '/job'}, 'a layout without depth is unchanged');
  for (const depth of [0, 4, 2.5, '2', null, -1]) assert.equal(recipeOf({kind: 'links', prefix: '/job', depth}), null, `depth ${JSON.stringify(depth)}`);
  assert.equal(recipeOf({kind: 'tag', tag: 'h3', class: 'job', depth: 2}), null, 'only a links layout has a depth');
});

// A card's title (13 Nov 2026, bl for sa, the owner's approved fix #1 design): the link holds the whole card or no text; its label or a heading inside names the job.
test('a links layout may name where a card link\'s title is, from the fixed list only; without it the layout is unchanged', async () => {
  const {recipeOf} = await import('../../../api/employers.js');
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/jobs', title: 'label'}), {kind: 'links', prefix: '/jobs', title: 'label'});
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/stellen', depth: 2, title: 'h4'}), {kind: 'links', prefix: '/stellen', depth: 2, title: 'h4'});
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/job', depth: 1, title: 'h2'}), {kind: 'links', prefix: '/job', title: 'h2'}, 'depth 1 still has no field');
  assert.deepEqual(recipeOf({kind: 'links', prefix: '/job'}), {kind: 'links', prefix: '/job'}, 'a layout without a title is unchanged');
  for (const title of ['script', 'h7', '', null, ['h4'], 4]) assert.equal(recipeOf({kind: 'links', prefix: '/job', title}), null, `title ${JSON.stringify(title)}`);
  assert.equal(recipeOf({kind: 'tag', tag: 'h3', class: 'job', title: 'h4'}), null, 'only a links layout has a title');
});

// 2 Nov 2026: the scout lost its cache and published 3,871 of 6,833 feeds, and no old copy existed to go back to (owner, 5 Nov 2026: "Find root cause, and preven this happening again").
const keeping = (fails = false) => {
  const kept = new Map();
  const put = async (key, value, options) => { if (key.startsWith('index:copy:')) { if (fails) throw new Error('KV down'); kept.set(key, {value, options}); } store.set(key, value); };
  return {kept, e: {...env(), WAITLIST: {...env().WAITLIST, put}}};
};
const onlyCopy = kept => { assert.equal(kept.size, 1, 'one copy a day'); const [[key, copy]] = kept; assert.match(key, /^index:copy:\d{4}-\d{2}-\d{2}$/); return copy; };

test('a publish keeps the whole body for 30 days', async () => {
  store.clear();
  const {kept, e} = keeping(), sent = {feeds: [feed('a'), feed('b')], nofeed: [{key: 'gone', company: 'Gone', host: null, last: '2026-11-01'}]};
  assert.equal((await (await call(e, 'PUT', auth, sent)).json()).copy, 'kept');
  const copy = onlyCopy(kept);
  assert.equal(copy.options.expirationTtl, 30 * 86400);
  assert.deepEqual(JSON.parse(copy.value), sent);
});

test('a loss the guard lets through (9% of the feeds), then one restore of the earlier copy brings everything back', async () => {
  store.clear();
  const {kept, e: kv} = keeping(), e = {...kv, STATS: d1()}, whole = Array.from({length: 100}, (_, i) => feed(`f${i}`));
  await call(e, 'PUT', auth, {feeds: whole, nofeed: [{key: 'gone', company: 'Gone', host: null, last: '2026-11-01'}]});
  const earlier = onlyCopy(kept).value;   // the day before the loss: a later publish today would replace today's copy, not that one
  assert.equal((await call(e, 'PUT', auth, {feeds: whole.slice(0, 91)})).status, 200, 'the precondition: the loss got through');
  const summary = async () => (await (await worker.fetch(new Request('https://www.jobpilotto.top/api/index?summary=1'), e, {})).json()).employers;
  assert.equal(await summary(), 91);
  assert.equal(store.get('index:nofeed'), '[]');
  assert.equal((await call(e, 'PUT', auth, JSON.parse(earlier))).status, 200);
  assert.equal(await summary(), 100);
  assert.equal((await e.STATS.prepare('SELECT COUNT(*) AS n FROM index_feeds').first()).n, 100);
  assert.equal(JSON.parse(store.get('index:nofeed')).length, 1, 'the dead ends come back with the feeds');
});

test('a second publish on one day replaces that day\'s copy: one copy a day', async () => {
  store.clear();
  const {kept, e} = keeping();
  await call(e, 'PUT', auth, {feeds: [feed('a')]});
  await call(e, 'PUT', auth, {feeds: [feed('a'), feed('b')]});
  assert.equal(JSON.parse(onlyCopy(kept).value).feeds.length, 2);
});

test('a refused publish is never kept: the good copy stays', async () => {
  store.clear();
  const {kept, e} = keeping(), many = Array.from({length: 20}, (_, i) => feed(`f${i}`));
  await call(e, 'PUT', auth, {feeds: many});
  assert.equal((await call(e, 'PUT', auth, {feeds: many.slice(0, 5)})).status, 409);
  assert.equal(JSON.parse(onlyCopy(kept).value).feeds.length, 20);
});

test('a copy that cannot be written never refuses the publish, the answer says so, and the owner is told', async t => {
  store.clear();
  const told = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { told.push({url: String(url), body: String(init?.body || '')}); return Response.json({ok: true, result: {message_id: 1}}); });
  const {e} = keeping(true), alerted = {...e, BRAIN_BOT_TOKEN: 'bot', BRAIN_CHAT_ID: '1'}, put = await call(alerted, 'PUT', auth, {feeds: [feed('a')]});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).copy, 'failed');
  assert.match(told.map(sent => sent.body).join(), /could not be saved/);
  assert.equal((await (await worker.fetch(new Request('https://www.jobpilotto.top/api/index?summary=1'), e, {})).json()).employers, 1, 'the publish itself went through');
});

test('a telling that fails too still never refuses the publish', async t => {
  store.clear();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('telegram down'); });
  const {e} = keeping(true), put = await call({...e, BRAIN_BOT_TOKEN: 'bot', BRAIN_CHAT_ID: '1'}, 'PUT', auth, {feeds: [feed('a')]});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).copy, 'failed');
});

// 2 Nov 2026: the scout lost its cache; feeds fell to 57% and feeds with kinds from 3,926 to 9, with every publish green. The owner chose (6 Nov 2026): "Alert on fields, block on employers (Recommended)", then "Refuse a loss over 10% (Recommended)".
const hiring = (slug, extra = {}) => feed(slug, {kinds: {software: 1}, ...extra});
const some = (n, make = feed) => Array.from({length: n}, (_, i) => make(`f${i}`));
const told = t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push(String(init?.body || '')); return Response.json({ok: true, result: {message_id: 1}}); });
  return sent;
};
const withBot = extra => ({...env(), BRAIN_BOT_TOKEN: 'bot', BRAIN_CHAT_ID: '1', ...extra});
const kindsStored = async db => (await db.prepare(`SELECT COUNT(json_extract(body, '$.kinds')) AS n FROM index_feeds`).first()).n;
const keepingKinds = (n, of = 100) => some(of, hiring).map((f, i) => (i < n ? f : feed(f.slug)));

test('the 2 Nov loss played: a publish keeping 57% of the employers is refused, the list stays and the owner is told', async t => {
  store.clear();
  const sent = told(t), e = withBot({STATS: d1()});
  assert.equal((await call(e, 'PUT', auth, {feeds: some(100, hiring)})).status, 200);
  const put = await call(e, 'PUT', auth, {feeds: [...some(1, hiring), ...some(57).slice(1)]});
  assert.equal(put.status, 409);
  assert.match(await put.text(), /57 feeds would replace 100/);
  assert.equal(await kindsStored(e.STATS), 100, 'the stored list is untouched');
  assert.match(sent.join(), /57 feeds would replace 100/);
});

test('90% of the employers kept passes, and a list too small to judge passes', async t => {
  told(t);
  store.clear();
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100)});
  assert.equal((await call(e, 'PUT', auth, {feeds: some(90)})).status, 200);
  store.clear();
  const small = withBot();
  await call(small, 'PUT', auth, {feeds: some(9)});
  assert.equal((await call(small, 'PUT', auth, {feeds: some(1)})).status, 200, 'under 10 stored: nothing to judge');
});

test('a deliberate move of role_kinds.SINCE: most kinds go, the publish passes, and the owner is told the same day', async t => {
  store.clear();
  const sent = told(t), e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100, hiring)});
  assert.equal((await call(e, 'PUT', auth, {feeds: keepingKinds(10)})).status, 200);
  assert.equal(await kindsStored(e.STATS), 10);
  assert.match(sent.join(), /10 feeds kept their kind · 90 lost it/);
});

test('kinds kept at half, or a list with under 10 kinds, tell nobody', async t => {
  store.clear();
  const sent = told(t), e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100, hiring)});
  await call(e, 'PUT', auth, {feeds: keepingKinds(50)});
  store.clear();
  const few = withBot({STATS: d1()});
  await call(few, 'PUT', auth, {feeds: keepingKinds(9, 30)});
  await call(few, 'PUT', auth, {feeds: some(30)});
  assert.doesNotMatch(sent.join(), /feeds with kinds/);
});

test('with no D1 the kinds count comes from the KV copy', async t => {
  store.clear();
  const sent = told(t), e = withBot();
  await call(e, 'PUT', auth, {feeds: some(20, hiring)});
  assert.equal((await call(e, 'PUT', auth, {feeds: some(20)})).status, 200);
  assert.match(sent.join(), /0 feeds kept their kind · 20 lost it/);
});

test('with D1 the kinds line is D1\'s count: an old KV copy that is no longer rewritten is not the line', async t => {
  store.clear();
  const sent = told(t), e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(20, hiring)});
  store.set('index:employers', JSON.stringify({version: 1, feeds: some(40, hiring)}));   // what an old copy, frozen once the list outgrew one KV value, can hold
  await call(e, 'PUT', auth, {feeds: [...some(12, hiring), ...some(40).slice(12)]});
  assert.doesNotMatch(sent.join(), /feeds with kinds/);
});

test('a refusal by the feed guard tells the owner, and a Telegram outage leaves the refusal as it is', async t => {
  store.clear();
  const sent = told(t), e = withBot();
  await call(e, 'PUT', auth, {feeds: some(20)});
  assert.equal((await call(e, 'PUT', auth, {feeds: some(5)})).status, 409);
  assert.match(sent.join(), /5 feeds would replace 20/);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('telegram down'); });
  assert.equal((await call(e, 'PUT', auth, {feeds: some(5)})).status, 409);
});

test('a Telegram outage never refuses a publish that only lost kinds', async t => {
  store.clear();
  told(t);
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100, hiring)});
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('telegram down'); });
  assert.equal((await call(e, 'PUT', auth, {feeds: some(100)})).status, 200);
});

test('89 of 100 employers kept is refused', async t => {
  told(t);
  store.clear();
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100)});
  assert.equal((await call(e, 'PUT', auth, {feeds: some(89)})).status, 409);
});

test('with D1 the employer count is D1\'s: an old KV copy that is no longer rewritten never refuses a normal publish (review)', async t => {
  told(t);
  store.clear();
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(20)});
  store.set('index:employers', JSON.stringify({version: 1, feeds: some(40)}));
  assert.equal((await call(e, 'PUT', auth, {feeds: some(20)})).status, 200);
});

test('a publish that writes D1 and then fails still tells the owner its kinds drop: the retry would compare with the drop (review)', async t => {
  store.clear();
  const sent = told(t), e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(100, hiring)});
  const breaking = {...e, WAITLIST: {...e.WAITLIST, put: async key => { if (key === 'index:generated') throw new Error('KV down'); }}};
  await assert.rejects(() => call(breaking, 'PUT', auth, {feeds: some(100)}));
  assert.match(sent.join(), /0 feeds kept their kind · 100 lost it/);
});

test('one stored body that is not JSON never stops a publish (review)', async t => {
  told(t);
  store.clear();
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(20, hiring)});
  e.STATS.db.prepare("UPDATE index_feeds SET body = 'not json' WHERE slug = 'f0'").run();
  assert.equal((await call(e, 'PUT', auth, {feeds: some(20, hiring)})).status, 200);
});

test('an emptied D1 table is not a line of zero: the KV copy guards the next publish', async t => {
  told(t);
  store.clear();
  const e = withBot({STATS: d1()});
  await call(e, 'PUT', auth, {feeds: some(20)});
  e.STATS.db.prepare('DELETE FROM index_feeds').run();
  assert.equal((await call(e, 'PUT', auth, {feeds: some(5)})).status, 409);
});

test('a scout board is measured for a role family only by that family\'s own jobs, served as a number with its day (13 Nov 2026, owner: "Why ? Let\'s fix it.")', async () => {
  store.clear();
  const e = {...env(), STATS: d1sitefacts()};
  const airline = {host: 'airline.es', url: 'https://airline.es/jobs/in-spain', country: 'es', local_jobs: 178, families: ['electrical_mechanical', 'service_hotel', 'construction'],
    family_jobs: {electrical_mechanical: 1, service_hotel: 150, construction: 2}};
  const jobeka = {host: 'jobeka.es', url: 'https://jobeka.es/?q={role}', country: 'es', local_jobs: 40, families: ['electrical_mechanical', 'teaching'],
    family_jobs: {electrical_mechanical: 19}};   // teaching: seen, never asked its own word: not measured
  const put = await (await call(e, 'PUT', auth, {feeds: [feed('a')], board_facts: [airline, jobeka]})).json();
  assert.equal(put.board_facts, 2);
  const {agreedSites} = await import('../../../api/employers.js');
  const cells = Object.fromEntries((await agreedSites(e)).filter(fact => fact.kind === 'board').map(fact => [fact.host, Object.fromEntries(fact.relevant.map(cell => [cell.family, cell]))]));
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(cells['airline.es'].electrical_mechanical, {family: 'electrical_mechanical', country: 'es', installs: 1, in_places: 1, fit70: 0, right: 1, day}, 'one electrician: a number, not measured');
  assert.equal(cells['airline.es'].construction.measured, undefined);
  assert.equal(cells['airline.es'].service_hotel.measured, true);
  assert.deepEqual(cells['jobeka.es'].electrical_mechanical, {family: 'electrical_mechanical', country: 'es', installs: 1, in_places: 19, fit70: 0, right: 19, day, measured: true});
  assert.deepEqual(cells['jobeka.es'].teaching, {family: 'teaching', country: 'es', installs: 1, in_places: 0, fit70: 0}, 'not measured: no number, never 0');
});

test('the scout\'s family counts are checked on publish: whole numbers of pool families only, a bad one drops the count and keeps the board', () => {
  assert.deepEqual(familyJobsOf({software_dev: 5, nonsense: 3, data_ai: -1, teaching: 2.5, it_support: '4', kitchen: 99999}), {software_dev: 5, kitchen: 5000});
  assert.deepEqual(familyJobsOf({}), {}, 'asked, found none anywhere: measured empty');
  assert.equal(familyJobsOf(undefined), undefined);
  assert.equal(familyJobsOf([3]), undefined);
  assert.equal(familyJobsOf('{"software_dev": 5}'), undefined);
});
