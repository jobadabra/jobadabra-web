// The product-quality board (owner, 5 Nov 2026: "tell me what's the quality of our product... using graphs"): the judging helpers, the five areas from fixed inputs, "not measured" and "Too few installs (n)"
// instead of a number, and the one reader against a real SQLite with the site's migrations. Pure inputs and a temp database: no network, no AI.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {lastDays, nightlySummary} from '../../../../admin/nightly-summary.js';
import {judge, median, pooled, verdictOf, weeks} from '../../../../admin/product-quality.js';
import {aiQuality, areasOf, bugs, formFilling, reliability, speed} from '../../../../admin/product-quality-areas.js';
import {loadInputs, loadQuality} from '../../../../admin/product-quality-data.js';
import {areaCard, board} from '../../../../admin/product-quality-html.js';
import worker from '../../../../workers/www/index.js';

const now = new Date('2026-11-05T10:00:00Z');
const days = lastDays(now, 30), DAYS = back => days[29 - back];
const upTo = (from, to, make) => Object.fromEntries(Array.from({length: from - to + 1}, (_, i) => [from - i, make(from - i)])), entries = map => Object.entries(map).map(([back, value]) => ({day: DAYS(Number(back)), ...value}));

test('helpers: pooled weighs by n, a missing day is not a zero, judge needs both numbers', () => {
  assert.equal(pooled([{value: 80, n: 40}, {value: 100, n: 10}, {value: null}]), 84);
  assert.equal(pooled([{value: null}]), null);
  assert.equal(median([8, 2, 10, 4]), 6);
  assert.equal(median([]), null);
  assert.deepEqual([judge(90, 80, {tolerance: 1}), judge(80.5, 80, {tolerance: 1}), judge(11, 8, {higherIsBetter: false}), judge(null, 8), judge(8, undefined)], ['better', 'same', 'worse', null, null]);
  const series = days.map((day, i) => ({day, value: i >= 23 ? 10 : i >= 16 ? 4 : null}));
  assert.deepEqual(weeks(series), {now: 10, before: 4});
});

test('form filling: the last 7 days against the 7 before, from required fields filled; the benchmark sits beneath', () => {
  const rows = entries({...upTo(13, 7, () => ({filled: 80, required: 100})), ...upTo(6, 0, () => ({filled: 90, required: 100}))});
  const area = formFilling({days, fill: {rows, sample: {forms: 20, installs: 5, min: 3, enough: true}, benchmark: {value: '74% vs 68%'}}});
  assert.deepEqual([area.value, area.unit, area.trend, area.tone, area.delta], ['90', '%', 'better', 'good', '+10 pts vs last 7 days']);
  assert.equal(area.series.length, 30);
  assert.equal(area.series.filter(point => point.value == null).length, 16, 'a day with no fill is a gap, never a 0');
  assert.deepEqual(area.subs, ['Benchmark, ours vs best other tool: 74% vs 68%']);
  const first = formFilling({days, fill: {rows: entries(upTo(6, 0, () => ({filled: 9, required: 10}))), sample: {forms: 9, installs: 3, min: 3, enough: true}}});
  assert.deepEqual([first.value, first.trend, first.word, first.delta], ['90', 'new', '• first week', 'no earlier week to compare with']);
});

test('few installs: a real-user number under 3 installs is "Too few installs (n)", never a percentage or a time', () => {
  const rows = entries(upTo(6, 0, () => ({filled: 9, required: 10})));
  const form = formFilling({days, fill: {rows, sample: {forms: 4, installs: 2, min: 3, enough: false}}});
  assert.deepEqual([form.value, form.label, form.trend, form.tone, form.series.length], [null, 'Too few installs (2)', 'thin', 'none', 0]);
  assert.match(form.delta, /4 real reports from 2 installs; a number needs 3\+/);
  const few = speed({days, searches: {rows: [{day: DAYS(1), install: 'a', s: 9}, {day: DAYS(0), install: 'b', s: 12}]}});
  assert.deepEqual([few.value, few.label, few.trend], [null, 'Too few installs (2)', 'thin']);
  assert.match(verdictOf([form, few]).headline, /Form filling, Speed: too few installs/);
});

test('AI quality: the nightly series as percent against its 80% bar; below the bar is bad even when steady', () => {
  const series = days.map((day, i) => ({day, value: i >= 20 ? 0.96 : null}));
  const nightly = {jobs: [{id: 'quality-ai', value: '96%', sub: '', series, bar: {value: 0.8}}, {id: 'prompt-cases', value: '47/48', sub: 'none got worse · 2 model noise (2026-11-05)', series: []}]};
  const answers = {claude: {now: {fields: 100, keptRate: 0.93}}, openai: {now: {fields: 100, keptRate: 0.88}}};
  const ok = aiQuality({nightly, answers});
  assert.deepEqual([ok.value, ok.trend, ok.tone, ok.bar], ['96', 'same', 'good', 80]);
  assert.deepEqual(ok.subs, ['Prompt cases: 47/48 right, none got worse', 'AI answers kept on a field: 91% (Claude 93%, OpenAI 88%)']);
  const low = aiQuality({nightly: {jobs: [{id: 'quality-ai', value: '70%', sub: '', series: series.map(point => ({...point, value: point.value == null ? null : 0.7})), bar: {value: 0.8}}]}});
  assert.deepEqual([low.value, low.tone], ['70', 'bad']);
  const none = aiQuality({nightly: {jobs: [{id: 'quality-ai', value: '–', sub: 'no live quality night stored yet', series: []}]}});
  assert.deepEqual([none.value, none.label, none.tone], [null, 'no live quality night stored yet', 'none']);
  assert.equal(nightlySummary({}, now, 30).jobs[0].series.length, 0, 'no snapshot: no invented nights');
  assert.equal(nightlySummary({}, now, 30).days.length, 30, 'the board asks for 30 days; the default stays 14');
  assert.equal(nightlySummary({}, now).days.length, 14);
});

test('speed: the median first-job time of real searches, lower is better; a slower week is "worse" and bad', () => {
  const searches = {rows: [...Array.from({length: 7}, (_, i) => ({day: DAYS(13 - i), install: `i${i % 4}`, s: 8})), ...Array.from({length: 7}, (_, i) => ({day: DAYS(6 - i), install: `i${i % 4}`, s: 11}))]};
  const answers = {claude: {now: {calls: 10, median: '≤ 10 s'}}, openai: {now: {calls: 3, median: '≤ 20 s'}}};
  const area = speed({days, searches, answers, probes: {card: {probes: [{probe: 'site', ms: 240}]}}});
  assert.deepEqual([area.value, area.unit, area.trend, area.tone, area.delta], ['11', ' s', 'worse', 'bad', '+3 s vs last 7 days']);
  assert.deepEqual(area.subs, ['Median AI answer call: ≤ 10 s', 'Website answers in 240 ms (live check)']);
});

test('reliability: the share of check rounds that were up, against 99%; crashes and Sentry beneath, each "not measured" on its own', () => {
  const rounds = entries(upTo(29, 0, back => ({n: 100, good: back === 2 ? 96 : 100})));
  const area = reliability({days, probes: {rows: rounds}, crashes: {now: {n: 2, installs: 1}, before: {n: 3}}, sentry: 3});
  assert.deepEqual([area.value, area.label, area.trend, area.tone, area.bar], ['99.4', 'live checks passed, last 7 days', 'worse', 'warn', 99], 'still above the bar, but this week had a dip the week before did not: to watch, not bad');
  const calm = reliability({days, probes: {rows: entries(upTo(29, 0, back => ({n: 100, good: back === 10 ? 90 : 100})))}, crashes: null, sentry: null});
  assert.deepEqual([calm.value, calm.trend, calm.tone], ['100', 'better', 'good']);
  const old = reliability({days, probes: {rows: entries(upTo(29, 0, back => ({n: 100, good: back === 25 ? 50 : 100})))}, crashes: null, sentry: null});
  assert.deepEqual([old.value, old.trend, old.tone], ['100', 'same', 'good'], 'an outage 25 days ago does not make the number, its trend and the verdict disagree today');
  assert.deepEqual(area.subs, ['2 crash reports from 1 install in 7 days (3 the week before)', '3 unresolved Sentry issues']);
  const bare = reliability({days, probes: {rows: rounds}, crashes: null, sentry: null});
  assert.deepEqual(bare.subs, ['Crash reports: not measured', 'Sentry: not measured']);
  const down = reliability({days, probes: {rows: entries(upTo(29, 0, () => ({n: 100, good: 95})))}, crashes: null, sentry: null});
  assert.deepEqual([down.value, down.tone], ['95', 'bad']);
});

test('bugs: found (tests + finders) against escaped (new problems real users reported); an escape makes it "to watch", more escaped than found makes it bad', () => {
  const snapshot = {caught: [{day: DAYS(1), runId: 1, line: 'a'}, {day: DAYS(1), runId: 2, line: 'b'}, {day: DAYS(1), runId: 2, line: 'b'}, {day: DAYS(9), runId: 3, line: 'c'}, {day: DAYS(0), runId: 4, line: 'd'}]};
  const area = bugs({days, snapshot, newProblems: [{day: DAYS(2), n: 1}], finders: 2});
  assert.deepEqual([area.kind, area.value, area.tone, area.trend, area.label, area.delta], ['columns', '5', 'warn', 'worse', 'in the last 7 days · 1 reached a user', '1 reached a user vs 0 the week before']);
  assert.deepEqual(area.series.at(-2), {day: DAYS(1), found: 2, escaped: 0});
  assert.equal(bugs({days, snapshot, newProblems: [], finders: null}).tone, 'good');
  assert.equal(bugs({days, snapshot: {caught: []}, newProblems: [{day: DAYS(1), n: 2}], finders: null}).tone, 'bad');
  assert.match(bugs({days, snapshot: null, newProblems: []}).label, /the e2e snapshot could not be read/);
});

test('tone: without a bar, a small worse week is "to watch" and only a change beyond twice the tolerance is "slipping"', () => {
  const week = (past, now) => entries({...upTo(13, 7, () => ({filled: past, required: 100})), ...upTo(6, 0, () => ({filled: now, required: 100}))});
  const form = (past, now) => formFilling({days, fill: {rows: week(past, now), sample: {forms: 20, installs: 5, min: 3, enough: true}}});
  assert.deepEqual([form(95, 93.5).trend, form(95, 93.5).tone], ['worse', 'warn']);
  assert.deepEqual([form(95, 92).trend, form(95, 92).tone], ['worse', 'bad']);
  assert.deepEqual([form(20, 21).tone, form(20, 40).tone], ['good', 'good'], 'no bar: on target means not getting worse');
  const seconds = (past, now) => speed({days, searches: {rows: [...Array.from({length: 7}, (_, i) => ({day: DAYS(13 - i), install: `i${i % 4}`, s: past})), ...Array.from({length: 7}, (_, i) => ({day: DAYS(6 - i), install: `i${i % 4}`, s: now}))]}});
  assert.deepEqual([seconds(10, 11.5).tone, seconds(8, 11).tone], ['warn', 'bad']);
});

test('old data is "not measured", not "Too few installs (0)": the thin rule only judges a period that has data', () => {
  const old = entries(upTo(25, 20, () => ({filled: 9, required: 10})));
  const form = formFilling({days, fill: {rows: old, sample: {forms: 0, installs: 0, min: 3, enough: false}}});
  assert.deepEqual([form.trend, form.label], ['none', 'no real fill in the last 14 days']);
  const search = speed({days, searches: {rows: [{day: DAYS(22), install: 'a', s: 9}]}});
  assert.deepEqual([search.trend, search.label], ['none', 'no real search in the last 14 days']);
});

test('nothing read: every area says "not measured" with its reason, none shows a 0, the verdict says so', () => {
  const areas = areasOf({days, fill: null, nightly: null, answers: null, searches: null, probes: null, crashes: null, sentry: null, newProblems: null, snapshot: null, finders: null});
  assert.equal(areas.length, 5);
  for (const area of areas) assert.deepEqual([area.value, area.tone, area.trend, area.word, area.series.length], [null, 'none', 'none', 'not measured', 0], area.id);
  const verdict = verdictOf(areas);
  assert.deepEqual([verdict.icon, verdict.headline, verdict.counts], ['⚪', '0 of 5 areas on target · Form filling, AI quality, Speed, Reliability, Bugs not measured', {good: 0, warn: 0, bad: 0, none: 5}]);
});

test('the verdict names what slips and what to watch', () => {
  const area = (name, tone) => ({area: name, tone, trend: 'same', word: '→ same'});
  const verdict = verdictOf([area('Form filling', 'good'), area('AI quality', 'good'), area('Speed', 'bad'), area('Reliability', 'good'), area('Bugs', 'warn')]);
  assert.deepEqual([verdict.icon, verdict.headline], ['🟠', '3 of 5 areas on target · Speed slipping · Bugs to watch']);
  assert.equal(verdictOf([area('A', 'good'), area('B', 'good')]).icon, '🟢');
});

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}

test('the reader: one pass over the site tables gives the inputs; a broken source is null and the others still answer', async () => {
  const STATS = d1(), {db} = STATS, env = {STATS};
  const card = (id, day, install, filled) => db.prepare("INSERT INTO fill_cards (id, day, board, required, filled, source, install) VALUES (?, ?, 'ashby', 10, ?, 'user', ?)").run(id, day, filled, install);
  [['c1', DAYS(0), 'i1', 9], ['c2', DAYS(1), 'i2', 8], ['c3', DAYS(2), 'i3', 10], ['p1', DAYS(2), '', 1]].forEach(args => card(...args));
  db.prepare("INSERT INTO fill_cards (id, day, board, required, filled, source, install) VALUES ('lab1', ?, 'ashby', 10, 1, 'pool', 'x')").run(DAYS(0));
  const event = (kind, day, install, fingerprint, data = {}) => db.prepare("INSERT INTO telemetry (day, at, kind, install, version, platform, fingerprint, summary, data) VALUES (?, ?, ?, ?, '1', 'mac', ?, 's', ?)").run(day, `${day}T08:00:00Z`, kind, install, fingerprint, JSON.stringify(data));
  event('search', DAYS(0), 'i1', 'search|a', {first_s: 12}); event('search', DAYS(1), 'i2', 'search|a', {first_s: 8}); event('search', DAYS(1), 'i2', 'search|a', {});
  event('crash', DAYS(1), 'i1', 'crash|x'); event('crash', DAYS(9), 'i2', 'crash|x'); event('run_failed', DAYS(3), 'i3', 'run|y');
  db.prepare("INSERT INTO synthetic_probes (probe, at, ok, ms, reason) VALUES ('site', ?, 1, 240, '')").run(`${DAYS(0)}T09:05:00Z`);
  db.prepare("INSERT INTO synthetic_probes (probe, at, ok, ms, reason) VALUES ('site', ?, 0, 900, 'HTTP 502')").run(`${DAYS(0)}T09:20:00Z`);
  const inputs = await loadInputs(env, now);
  assert.equal(inputs.days.length, 30);
  assert.deepEqual([inputs.fill.rows.length, inputs.fill.sample.installs, inputs.fill.sample.enough, inputs.fill.rows.find(row => row.day === DAYS(2)).filled], [3, 3, true, 11], 'user cards only (the pool card is not real use); a card from before the install column still counts in the share, as on the Form filling page, but not as an install');
  assert.deepEqual(inputs.searches.rows.map(row => [row.day, row.install, row.s]), [[DAYS(0), 'i1', 12], [DAYS(1), 'i2', 8]], 'newest first, so a cap never drops the latest days; a search with no first-job time is not a number');
  assert.deepEqual(inputs.probes.rows.map(row => ({...row})), [{day: DAYS(0), n: 2, good: 1}]);
  assert.deepEqual(inputs.crashes, {now: {n: 1, installs: 1}, before: {n: 1}});
  assert.deepEqual(inputs.newProblems.map(row => [row.day, row.n]).sort(), [[DAYS(9), 1], [DAYS(3), 1]]);
  assert.equal(inputs.sentry, null, 'no Sentry token: not measured');
  assert.equal(inputs.finders, null, 'no self-healing snapshot: not measured');
  const heal = (back, fixed) => db.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?)').run(DAYS(back), `${DAYS(back)}T04:00:00Z`, JSON.stringify({periods: {last7: {byDetector: [{detector: 'Layout and DOM checks', fixed, queued: 1}]}}}));
  heal(20, 9);
  assert.equal((await loadInputs(env, now)).finders, null, 'a snapshot three weeks old is not this week: a stopped job is not measured, never a stale count');
  heal(2, 3);
  assert.equal((await loadInputs(env, now)).finders, 4, 'a snapshot of the last 7 days counts (fixed + queued)');
  db.exec('DELETE FROM selfheal_snapshots');
  const areas = areasOf(inputs);
  assert.deepEqual(areas.map(area => [area.id, area.trend]), [['form', 'new'], ['ai', 'none'], ['speed', 'thin'], ['reliability', 'new'], ['bugs', 'none']]);
  assert.equal(areas[0].value, '70', '28 of 40 required fields filled in the last 7 days');
  STATS.db.exec('DROP TABLE synthetic_probes');
  const broken = await loadInputs(env, now);
  assert.equal(broken.probes, null);
  assert.equal(broken.fill.rows.length, 3, 'the other sources still answer');
  assert.equal(areasOf(broken)[3].tone, 'none');
});

test('the board draws every value escaped, and an unknown tone never prints "undefined"', () => {
  const hostile = {id: 'x', area: '<b>Area</b>', question: '<i>q</i>', value: '9<script>', unit: '<u>', label: '<img src=x onerror=1>', trend: 'better', word: '<w>', tone: 'mystery', delta: '<d>', subs: ['<s>'], src: '<src>'};
  const html = areaCard(hostile) + board({verdict: {icon: '🟢', headline: '<h>', chips: [{area: '<a>', tone: 'mystery', word: '<w>'}]}, areas: [hostile], gaps: [{area: '<g>', question: '<q>', why: '<y>'}]});
  assert.doesNotMatch(html, /<script>|<img |<b>Area|<i>q|<h>|<s>|<d>|<w>|<src>|<g>|<y>/, 'a value in a tag');
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /&lt;b&gt;Area&lt;\/b&gt;/);
});

test('a card with no number is dashed: "not measured" says why, "too few installs" shows its count', () => {
  const area = (extra) => ({id: 'a', area: 'A', question: 'q?', value: null, unit: '', label: 'why', trend: 'none', word: 'not measured', tone: 'none', delta: 'd', subs: [], src: '', ...extra});
  assert.match(areaCard(area({})), /class="card qc nm"[\s\S]*not measured<\/div><div class="lbl">why/);
  assert.match(areaCard(area({trend: 'thin', label: 'Too few installs (2)'})), /class="card qc nm"[\s\S]*<div class="num">Too few installs \(2\)<\/div>/);
  assert.match(areaCard(area({value: '9', unit: '%', trend: 'same'})), /class="card qc"[\s\S]*9<small>%<\/small>/);
});

test('the page never goes down with the board: a failing board is null, the page keeps its nightly cards, and a broken source is logged by name', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  assert.equal(await loadQuality(null), null, 'a throw anywhere in the board gives null');
  assert.match(String(errors.mock.calls.at(-1).arguments[0]), /board failed/);
  const boom = () => { throw new Error('boom'); };
  const env = {STATS_KEY: 'k3y', STATS_SALT: 's', STATS: {prepare: boom, batch: boom}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  const response = await worker.fetch(new Request('https://www.jobpilotto.top/admin/testing/report-only', {headers: {Cookie: 'jp_stats=k3y'}}), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Did the nightly jobs run/);
  assert.match(html, /0 of 5 areas on target/);
  assert.ok(errors.mock.calls.some(call => /fill cards unreadable: boom/.test(String(call.arguments[0]))), 'the broken source is named in the log');
});
