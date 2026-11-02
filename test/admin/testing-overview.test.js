// /admin/testing/overview: the catalogue resolved against stored rows (last run, cadence, bugs caught), the page drawn, the route owner-only and first under Testing.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../../workers/www/index.js';
import {PAGES} from '../../admin/admin.js';
import {METHODS, PLANNED, RINGS} from '../../admin/testing-overview-methods.js';
import {resolve} from '../../admin/testing-overview-data.js';
import {ago, lastChip, page} from '../../admin/testing-overview.js';
import {daysTo, historyOf} from '../../admin/testing-overview-history.js';

const now = new Date('2026-11-01T12:00:00Z'), repo = 'GarryOne/jobadabra';
const run = (conclusion, at, n = 1) => ({at, conclusion, mins: 3, url: `https://github.com/${repo}/actions/runs/${n}`});
const job = (file, name, recent, crons = []) => ({repo, file, name, about: '', crons, source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
const data = (extra = {}) => ({repo, now,
  schedules: {jobs: [job('e2e.yml', 'CI · End-to-end on Mac + Linux', [run('success', '2026-11-01T02:00:00Z', 11)], ['47 21,23,1 * * *']), job('desktop.yml', 'Release · Build, test, beta', [run('success', '2026-11-01T05:30:00Z', 12)], ['17 5 * * *']),
    job('integration.yml', 'CI · Integration tests', [run('success', '2026-11-01T10:00:00Z', 13)]), job('smoke.yml', 'CI · Smoke (the app starts)', [run('failure', '2026-11-01T09:00:00Z', 14)]),
    job('mutation.yml', 'CI · Planted code bugs', [run('cancelled', '2026-10-25T01:10:00Z', 15), run('success', '2026-10-25T01:00:00Z', 16)], ['0 1 * * 0'])]},
  e2e: {latest: [{runId: 21, day: '2026-11-01', kind: 'pr', conclusion: 'failure'}, {runId: 20, day: '2026-11-01', kind: 'after-merge', conclusion: 'success'}, {runId: 19, day: '2026-10-31', kind: 'nightly', conclusion: 'failure'}],
    suiteNights: [{runId: 19, day: '2026-10-31', kind: 'nightly', suite: 'wander', platform: 'mac', green: true}, {runId: 19, day: '2026-10-31', kind: 'nightly', suite: 'interactions', platform: 'mac', green: false},
      {runId: 18, day: '2026-10-30', kind: 'nightly', suite: 'interactions', platform: 'mac', green: true}],
    caught: [{day: '2026-10-30', kind: 'scheduled', runId: 5, suite: 'jobs'}, {day: '2026-10-30', kind: 'scheduled', runId: 5, suite: 'apply'}, {day: '2026-10-29', kind: 'after-merge', runId: 6, suite: 'apply'},
      {day: '2026-10-28', kind: 'pr', runId: 7, suite: 'jobs'}, {day: '2026-10-27', kind: 'beta', runId: 8, suite: 'quality'}, {day: '2026-09-01', kind: 'nightly', runId: 1}]},
  integration: {runs: [{runId: 31, layer: 'app', platform: 'linux', day: '2026-11-01', on: 'main', conclusion: 'success', tests: 10, failed: 0, ms: 5}, {runId: 30, layer: 'store', platform: 'linux', day: '2026-10-31', on: 'main', conclusion: 'failure', tests: 10, failed: 1, ms: 5}]},
  healing: {day: '2026-11-01', periods: {last7: {byDetector: [{detector: 'AI screenshot review', fixed: 2, queued: 1}, {detector: 'AI code review', fixed: 0, queued: 0}]}}, quality: {mutation: {rate: 100, note: '12 of 12 planted code bugs caught'}}, recall: {planted: 13, caught: 11, missed: ['page-overflow']}},
  card: {month: '2026-11', days: 30, checks: [{name: 'CI · Integration tests', realCatches: 4}, {name: 'CI · Smoke (the app starts)', realCatches: 1}]},
  sentry: [{userCount: 3}, {userCount: 2}], ...extra});
const cardOf = (model, id) => model.rings.flatMap(ring => ring.cards).find(card => card.id === id);

test('every method sits in a ring, appears once, and every ring has cards', () => {
  const ids = [...METHODS, ...PLANNED].map(method => method.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const method of [...METHODS, ...PLANNED]) assert.ok(RINGS.some(ring => ring.id === method.ring), `${method.id} has a ring`);
  const model = resolve(data());
  for (const ring of model.rings) assert.ok(ring.cards.length, ring.title);
  assert.ok(!ids.some(id => /unit/.test(id)), 'unit tests are not on the page (owner, 1 Nov 2026)');
});

test('each catalogued workflow exists in the public repo', { skip: !existsSync('.github/workflows') }, () => {
  const files = METHODS.flatMap(method => method.lines.map(line => line.wf).filter(Boolean)).concat(METHODS.flatMap(method => method.bugs.checks || []));
  for (const file of new Set(files)) assert.ok(existsSync(`.github/workflows/${file}`), `${file} is a public workflow`);
});

test('last run: a workflow reads its newest finished run, the cadence is its cron in words, a skipped or cancelled run is not a result', () => {
  const model = resolve(data()), mutation = cardOf(model, 'mutation').lines[0];
  assert.equal(mutation.last.state, 'green');
  assert.equal(mutation.last.url, `https://github.com/${repo}/actions/runs/16`);
  assert.match(mutation.when, /^Weekly Sun/);
  const smoke = cardOf(model, 'smoke').lines[0];
  assert.deepEqual([smoke.last.state, smoke.when], ['red', 'every pull request']);
  assert.equal(cardOf(model, 'upgrade').lines[0].last.state, 'none', 'a workflow the snapshot does not list says so');
});

test('last run: e2e by run kind (PR runs do not stand in), suites by their newest night, integration by main', () => {
  const model = resolve(data()), e2e = cardOf(model, 'e2e').lines;
  assert.equal(e2e[0].last.state, 'green');
  assert.match(e2e[0].last.url, /runs\/20$/);
  assert.equal(e2e[1].last.state, 'red');
  assert.equal(e2e[2].last.state, 'none');
  assert.equal(cardOf(model, 'interactions').lines[0].last.state, 'red', 'run 19 is the newest night of the suite');
  assert.equal(cardOf(model, 'wander').lines[0].last.state, 'green');
  const integration = cardOf(model, 'integration').lines[0].last;
  assert.deepEqual([integration.state, integration.note], ['green', 'app layer on main']);
});

test('bugs caught come from stored rows, with their window, or say why not', () => {
  const model = resolve(data());
  assert.deepEqual(cardOf(model, 'integration').bugs, {text: '4 real catches', window: '30 days'});
  assert.deepEqual(cardOf(model, 'smoke').bugs, {text: '1 real catch', window: '30 days'});
  assert.deepEqual(cardOf(model, 'review').bugs, {text: '3 real bugs', window: '7 days'});
  assert.deepEqual(cardOf(model, 'code-review').bugs, {text: '0 real bugs', window: '7 days'});
  // 2 Nov 2026 (owner: "has this caught bug been counted?"): the count was PR runs only; main, the night and the beta do the catching since 1 Nov.
  assert.deepEqual(cardOf(model, 'e2e').bugs, {text: '4 reds that caught a bug', window: '30 days', detail: 'after merge 1 · before merge 1 · beta 1 · scheduled 1'}, 'every run kind, where each was caught; one run red in two suites is one red; a red older than 30 days is out');
  assert.equal(cardOf(model, 'mutation').bugs.text, '12 of 12 planted code bugs caught');
  assert.equal(cardOf(model, 'recall').bugs.text, '11 of 13 planted UI bugs caught');
  assert.deepEqual(cardOf(model, 'sentry').bugs, {text: '2 unresolved issues · 5 users hit', window: '14 days'});
  assert.match(cardOf(model, 'wander').bugs.why, /own name/, 'a short reason beside the number (the card is Wander\'s)');
  const empty = resolve(data({card: null, healing: null, e2e: null, sentry: null, integration: null, schedules: null}));
  for (const id of ['integration', 'review', 'e2e', 'mutation', 'recall', 'sentry']) assert.ok(cardOf(empty, id).bugs.why, `${id} says why it has no number`);
  assert.equal(cardOf(empty, 'e2e').state, 'none');
  assert.equal(empty.counts.green + empty.counts.red, 0);
});

test('the verdict counts live cards by their worst line; GTM readiness links only once its page is in the menu; planned cards are grey', () => {
  const model = resolve(data()), live = model.counts.live;
  assert.equal(model.counts.green + model.counts.red + model.counts.none, live);
  assert.ok(model.red.includes('Smoke') && model.red.includes('E2E · Tier 1 journeys'));
  assert.equal(cardOf(model, 'gtm').href, '');
  assert.equal(cardOf(model, 'gtm').pending, true);
  assert.equal(cardOf(resolve(data(), {pages: ['/admin/testing/gtm-readiness']}), 'gtm').href, '/admin/testing/gtm-readiness');
  const menu = resolve(data(), {pages: PAGES.map(item => item.path)});
  for (const card of menu.rings.flatMap(ring => ring.cards).filter(card => card.kind === 'live' && card.href)) assert.ok(PAGES.some(item => item.path === card.href), `${card.id} links to a menu page`);
  assert.equal(cardOf(menu, 'e2e').href, '/admin/testing/e2e');
  assert.deepEqual(PLANNED.map(card => card.id).sort(), ['agents', 'faults']);
  const html = page(model, {now});
  assert.equal((html.match(/class="mcard planned"/g) || []).length, PLANNED.length);
  assert.doesNotMatch(html, /testing\/scheduled/);
  assert.match(page(resolve(data(), {pages: ['/admin/testing/scheduled']}), {now}), /<a href="\/admin\/testing\/scheduled">Weekly Sun/);
  assert.match(html, /<title>Overview · Testing · Admin<\/title>/);
  assert.match(html, /red on the last run/);
  assert.doesNotMatch(html, /unit test(?!s are not listed)/i);
});

test('the chip names the result in words, with the time and the run link', () => {
  assert.equal(ago('2026-11-01T11:30:00Z', now), '30 min ago');
  assert.equal(ago('2026-11-01T06:00:00Z', now), '6 h ago');
  assert.equal(ago('2026-10-29T06:00:00Z', now), '3 days ago');
  assert.equal(ago('2026-11-01', now), 'today');
  assert.equal(ago('2026-10-31', now), 'yesterday');
  assert.match(lastChip({state: 'red', at: '2026-11-01T06:00:00Z', url: 'https://github.com/x/y/actions/runs/1'}, now), /<a href="https:\/\/github.com\/x\/y\/actions\/runs\/1"><span class="chip bad">✕ red · 6 h ago/);
  assert.match(lastChip({state: 'green', at: '2026-11-01T06:00:00Z', late: true}, now), /✓ green · 6 h ago.*late/s);
  assert.match(lastChip({state: 'none', why: 'no <b>run'}, now), /title="no &lt;b&gt;run".*◷ no run stored/s);
});

test('the route: owner only, Overview is the first page of Testing, every other visitor gets a 404', async () => {
  const testing = PAGES.filter(item => item.group === 'Testing');
  assert.equal(testing[0].path, '/admin/testing/overview');
  assert.ok(!testing[0].overview, 'its own page, not section-overview tiles');
  const env = {STATS_KEY: 'k3y', STATS_SALT: 's', STATS: {prepare: () => ({first: async () => null, bind() { return this; }, all: async () => ({results: []})})}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env, {});
  assert.equal((await get('/admin/testing/overview')).status, 404);
  const owner = await get('/admin/testing/overview', {Cookie: 'jp_stats=k3y'});
  assert.equal(owner.status, 200);
  const html = await owner.text();
  assert.match(html, /Testing overview/);
  assert.match(html, /<a href="\/admin\/testing\/overview" aria-current="page">🧭 Overview<\/a>/);
});

test('the map: one cell per day, red beats green on a day, a day before the stored runs is "not stored", never "no run"', () => {
  const d = data({e2e: {...data().e2e, days: [{day: '2026-10-31', kind: 'nightly', runs: 2, greens: 1, reds: 1}, {day: '2026-10-30', kind: 'nightly', runs: 1, greens: 1, reds: 0}]}});
  assert.deepEqual(daysTo(now).slice(-2), ['2026-10-31', '2026-11-01']);
  const night = historyOf(d, [{label: 'Night', last: {e2e: ['nightly']}}]);
  assert.equal(night.length, 14);
  assert.deepEqual(night.slice(-3).map(cell => cell.state), ['green', 'red', 'none']);
  const full = {...d, schedules: {jobs: [job('mutation.yml', 'x', Array.from({length: 14}, (_, i) => run('success', `2026-11-0${i < 1 ? 1 : 1}T0${i % 9}:00:00Z`, i)))]}};
  const cells = historyOf(full, [{label: 'x', wf: 'mutation.yml'}]);
  assert.equal(cells.at(-1).state, 'green');
  assert.equal(cells[0].state, 'unknown', 'a full window of 14 newest runs says nothing about the days before it');
  assert.ok(historyOf(d, [{label: 'Gitar', last: {none: 'x'}}]).every(cell => cell.state === 'unknown'));
  const html = page(resolve(d), {now});
  assert.match(html, /Every method, day by day/);
  assert.match(html, /title="Sat 31 Oct · 1 green run, 1 red run"/);
  assert.match(html, /methods · by their last run/);
});

test('the map: days after the snapshot was read are "not stored", never "no run" (a late collector upload; PR #260)', () => {
  const stale = data({e2e: {...data().e2e, at: '2026-10-30T23:00:00Z', days: [{day: '2026-10-30', kind: 'nightly', runs: 1, greens: 1, reds: 0}]}});
  const cells = historyOf(stale, [{label: 'Night', last: {e2e: ['nightly']}}]);
  assert.deepEqual(cells.slice(-3).map(cell => cell.state), ['green', 'unknown', 'unknown']);
  const fresh = historyOf(data({e2e: {...stale.e2e, at: '2026-11-01T08:00:00Z'}}), [{label: 'Night', last: {e2e: ['nightly']}}]);
  assert.deepEqual(fresh.slice(-3).map(cell => cell.state), ['green', 'none', 'none'], 'a read today covers today: no run is a real "no run"');
  const late = {...data(), schedules: {...data().schedules, at: '2026-10-31T10:00:00Z'}};
  assert.equal(historyOf(late, [{label: 'x', wf: 'smoke.yml'}]).at(-1).state, 'unknown');
});

// Synthetic monitoring is a live card (1 Nov 2026, to): shared/synthetic.js readCard / readDays give the rows, the card never reads D1 itself.
const probe = (id, label, extra = {}) => ({probe: id, label, ok: true, at: '2026-11-01T11:50:00Z', ms: 200, reason: '', state: 'up', since: '2026-10-30T00:00:00Z', uptime24h: 100, ...extra});
const probes = [probe('site', 'Website'), probe('index', 'Employer index pack'), probe('license', 'Licence and plan check'), probe('free-ai', 'Free AI key check'), probe('updates', 'Update feed'), probe('broker', 'Free AI broker')];
const week = Array.from({length: 14}, (_, i) => ({day: daysTo(now)[i], state: i === 0 ? 'none' : i === 9 ? 'red' : 'green'}));
const synthetic = (card, days = week) => data({synthetic: card, syntheticDays: days});

test('synthetic card, live: cadence every 15 min, the last round, green with all probes up; bugs say a probe finds outages', () => {
  const card = cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes})), 'synthetic'), line = card.lines[0];
  assert.equal(card.kind, 'live');
  assert.deepEqual([card.state, line.when, line.last.state, line.last.at, line.last.note], ['green', 'every 15 min', 'green', '2026-11-01T11:50:00Z', 'all 6 probes up']);
  assert.deepEqual(card.bugs, {why: 'a probe finds outages, not bugs'});
  assert.equal(card.href, '', 'it links to the Overview itself only once that page is in the menu');
  assert.equal(cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes}), {pages: ['/admin/testing/synthetic-monitoring']}), 'synthetic').href, '/admin/testing/synthetic-monitoring');   // its own tab (owner, 1 Nov 2026)
  assert.ok(!resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes})).rings.flatMap(ring => ring.cards).some(item => item.id === 'synthetic' && item.kind === 'planned'));
  const down = cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes: probes.map(item => (item.probe === 'broker' ? {...item, ok: false, state: 'down', reason: 'HTTP 503'} : item.probe === 'site' ? {...item, ok: false} : item))})), 'synthetic');
  assert.deepEqual([down.state, down.lines[0].last.note], ['red', 'Free AI broker down'], 'down = 2 reds in a row; one red alone is not yet a verdict');
  assert.equal(cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes: probes.slice(0, 5)})), 'synthetic').lines[0].last.note, 'all 5 probes up', 'broker may be absent');
  const html = page(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes})), {now});
  assert.match(html, /id="m-synthetic"[^]*every 15 min[^]*✓ green · 10 min ago[^]*all 6 probes up/);
});

test('synthetic card, stale: no round for 45 min is a red "no round", never a stale green', () => {
  const card = cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T08:00:00Z', stale: true, probes})), 'synthetic');
  assert.deepEqual([card.state, card.lines[0].last.state, card.lines[0].last.word], ['red', 'red', 'no round']);
  assert.match(page(resolve(synthetic({lastRoundAt: '2026-11-01T08:00:00Z', stale: true, probes})), {now}), /✕ no round · 4 h ago/);
  const never = cardOf(resolve(synthetic({lastRoundAt: '', stale: true, probes: []})), 'synthetic');
  assert.equal(never.state, 'red');
  assert.match(page(resolve(synthetic({lastRoundAt: '', stale: true, probes: []})), {now}), /✕ no round<\/span>|✕ no round<\/a>/);
  assert.ok(resolve(synthetic({lastRoundAt: '2026-11-01T08:00:00Z', stale: true, probes})).red.includes('Synthetic monitoring'));
});

test('synthetic card, unreadable: null is "no run stored" with the reason, counted as no verdict, and the map says "not stored"', () => {
  const model = resolve(synthetic(null, null)), card = cardOf(model, 'synthetic');
  assert.deepEqual([card.state, card.lines[0].last.state], ['none', 'none']);
  assert.match(card.lines[0].last.why, /not readable/);
  assert.ok(card.days.every(cell => cell.state === 'unknown'));
  assert.ok(!model.red.includes('Synthetic monitoring'));
});

test('synthetic card, the map: readDays maps 1:1 to the cells, a red day is red, a day before monitoring is "no run", the tooltip says what happened', () => {
  const card = cardOf(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes})), 'synthetic');
  assert.equal(card.days.length, 14);
  assert.deepEqual(card.days.map(cell => cell.state), week.map(item => ({none: 'none', green: 'green', red: 'red'}[item.state])));
  assert.deepEqual(card.days.map(cell => cell.day), week.map(item => item.day));
  const html = page(resolve(synthetic({lastRoundAt: '2026-11-01T11:50:00Z', stale: false, probes})), {now});
  assert.match(html, /title="Wed 28 Oct · a probe was down \(2 reds in a row\)"/);
  assert.match(html, /title="Sun 1 Nov · rounds ran, no probe down"/);
});

test('the synthetic demo seeds run together in one database, as the phone check seeds them (a plain INSERT hit the primary key in CI, PR #270)', async () => {
  const {workerServer} = await import('../../tools/worker-server.mjs');
  const site = await workerServer(process.cwd(), ['synthetic-card', 'synthetic-card-stale']);
  site.close();
});

test('readable (owner, 1 Nov 2026: "one per row rather than 3, being so crowded"; "too much text"): a short verdict with red chips that jump to their card, one card per row with short words', () => {
  const html = page(resolve(data()), {now});
  assert.match(html, /<p class="vb-line">.*<b>\d+ of \d+ methods (red|green) on the last run<\/b><\/p>/);
  assert.doesNotMatch(html, /class="big"/, 'the old sentence band is gone');
  assert.match(html, /\.grid\{display:grid;grid-template-columns:1fr/, 'one card per row, not auto-fill columns');
  for (const method of METHODS) assert.ok(method.proves.split(' ').length <= 9, `${method.id}: the purpose is a short line`);
  assert.equal((html.match(/class="mc-head"/g) || []).length, (html.match(/class="mcard/g) || []).length, 'every card has the same three-part build');
});
