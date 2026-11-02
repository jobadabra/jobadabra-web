// /admin/testing/gtm-readiness (owner, 1 Nov 2026): a journey's stability from the run rows (stable = last 10 runs green and no red in 3 days), the verdict in words, the gauge, Tier 2 from its tallies,
// the collector's PUT validated, owner only, in the Testing menu. Numbers are a hand count on a fixed fixture.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../workers/www/index.js';
import {PAGES} from '../../admin/admin.js';
import {cleanSnapshot, ingest, MAX_T1} from '../../admin/gtm-intel.js';
import {page} from '../../admin/gtm-readiness.js';
import {percentOf, shareTone, tier1Rows, tier2Rows, verdict} from '../../admin/gtm-readiness-data.js';

const now = new Date('2026-11-01T12:00:00Z');
const journeys = [{id: 'J0', name: 'The app starts: every screen draws', tier: 1}, {id: 'J1', name: 'Set up <the> app', tier: 1}, {id: 'J2', name: 'Find jobs', tier: 1}, {id: 'J3', name: 'Few runs', tier: 1}, {id: 'J4', name: 'No runs', tier: 1},
  {id: 'K', name: 'Kept steps', tier: 1}, {id: 'J8', name: 'Tailor a CV', tier: 2}, {id: 'J9', name: 'Board', tier: 2}];
// run n is on day (n/4 days back) and has id 1000 - n (a newer run has a higher id); row = [runId, day, kind, os, journey, seen, failed, cut]
const day = n => new Date(now.getTime() - Math.floor(n / 4) * 86400000).toISOString().slice(0, 10);
const rows = [], id = n => 1000 - n;
for (let n = 1; n <= 30; n++) {
  rows.push([id(n), day(n), 'after-merge', 'mac', 'J0', 1, 0, 0], [id(n), day(n), 'after-merge', 'windows', 'J0', 1, 0, 0]);   // 30 green runs: stable
  rows.push([id(n), day(n), 'beta', 'mac', 'J1', 2, 0, 0], [id(n), day(n), 'beta', 'windows', 'J1', 2, n === 5 ? 1 : 0, 0]);   // run 5 (day 1 = 31 Oct) red on Windows only: red for the run, inside the 3 days
  rows.push([id(n), day(n), 'nightly', 'mac', 'J2', 1, 0, n === 25 ? 1 : 0]);   // run 25 (6 days back) cut off: red, outside the 3 quiet days, and outside the last 10 runs
}
for (let n = 1; n <= 4; n++) rows.push([id(n), day(n), 'beta', 'mac', 'J3', 1, 0, 0]);
rows.push([id(1), day(1), 'beta', 'mac', 'K', 3, 1, 0]);
rows.push([id(2), day(2), 'beta', 'mac', 'J4', 0, 0, 0]);   // seen 0, no failure, no cut: the run never exercised the journey: no observation
const snapshot = cleanSnapshot({journeys, tier1: rows, tier2: [{day: '2026-11-01', journey: 'J8', tests: 4, runs: 50, red: 1}, {day: '2026-10-31', journey: 'J8', tests: 4, runs: 50, red: 0}, {day: '2026-10-31', journey: 'J9', tests: 2, runs: 10, red: 0}]}, now);

test('stable = the last 10 runs green and no red in 3 days; a red on one OS is a red run; fewer than 10 runs is not stable', () => {
  const by = Object.fromEntries(tier1Rows(snapshot, now).map(row => [row.id, row]));
  assert.equal(by.J0.state, 'stable');
  assert.equal(by.J0.runs, 30);
  assert.equal(by.J1.state, 'unstable', 'run 5 is red inside the last 10 runs and inside 3 days');
  assert.deepEqual([by.J1.lastBad.runId, by.J1.os.mac.green, by.J1.os.windows.green], [995, 1, 29 / 30]);
  assert.equal(by.J2.state, 'stable', 'a cut-off 6 days back, outside the last 10 runs and the quiet days');
  assert.equal(by.J2.lastBad.runId, 975);
  assert.equal(by.J3.state, 'few');
  assert.equal(by.J4.state, 'none', 'seen 0 is no observation');
  assert.equal(by.J2.share, 29 / 30);
});

test('a suite that died before any step (seen 0, cut) is one red run; seen 0 without a failure or cut is no run', () => {
  const died = cleanSnapshot({journeys: [{id: 'J5', name: 'Apply', tier: 1}], tier1: [[7, '2026-11-01', 'beta', 'mac', 'J5', 0, 0, 1], [6, '2026-11-01', 'beta', 'mac', 'J5', 0, 0, 0]]}, now);
  const [row] = tier1Rows(died, now);
  assert.deepEqual([row.runs, row.share, row.days.reduce((n, item) => n + item.runs, 0), row.lastBad.runId], [1, 0, 1, 7]);
});

test('the kept row is last and is not in the gauge', () => {
  const list = tier1Rows(snapshot, now);
  assert.equal(list.at(-1).id, 'K');
  const say = verdict(list);
  assert.deepEqual([say.stable, say.total], [2, 4], 'J0 and J2 stable; J1 and J3 (few runs) not; K and J4 (no runs) left out');
  assert.equal(say.text, '2 of 4 Tier 1 journeys stable', 'a short line: the names are chips, never a sentence (owner, 1 Nov 2026: "here again too much text")');
  assert.deepEqual(say.chips, [{label: 'J1', tone: 'bad', title: 'J1 Set up <the> app: red 31 Oct'}, {label: 'J3', tone: 'warn', title: 'J3 Few runs: only 4 runs'}]);
});

// Why (2 Nov 2026, owner: "last 20 runs shows all green, but earlier on the row shows not stable or different percentages... is a bit contradictory"): the row mixed three windows (state: last 10 runs + 3 quiet
// days; Mac/Windows %: 14 days; strip: the last 20 runs). One window now: the 14 days. Every cell of a row is counted from the same runs, so the strip, the percentages, the last red and the state can never disagree.
const contradiction = (() => {
  const list = [[900, '2026-10-30', 'beta', 'mac', 'J1', 2, 1, 0]];   // a red 2 days ago
  for (let n = 0; n < 20; n++) list.push([901 + n, n < 10 ? '2026-10-31' : '2026-11-01', 'after-merge', 'mac', 'J1', 2, 0, 0]);   // then 20 greens (a journey that runs on every merge fills 20 runs in a day)
  return cleanSnapshot({journeys: [{id: 'J1', name: 'Find jobs', tier: 1}], tier1: list}, now);
})();

test('one window per row: the days, the percentages, the last red and the state are all counted from the same 14 days (a red 2 days ago + 20 greens after it)', () => {
  const [row] = tier1Rows(contradiction, now);
  assert.equal(row.days.length, 14);
  assert.deepEqual(row.days.map(item => item.day).slice(-3), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(row.days.slice(-3).map(item => [item.runs, item.red]), [[1, 1], [10, 0], [10, 0]], 'the red is a cell of its own day: it cannot fall off a 20-run strip');
  assert.deepEqual([row.days.reduce((n, item) => n + item.runs, 0), row.days.reduce((n, item) => n + item.red, 0)], [row.runs, 1], 'the cells add up to the runs the percentages count');
  assert.deepEqual([row.runs, row.share, row.lastBad.runId, row.state], [21, 20 / 21, 900, 'unstable']);
  assert.equal(row.why, 'red 30 Oct · inside the 3 quiet days', 'the state says which rule it is');
  const every = tier1Rows(snapshot, now);
  for (const item of every.filter(one => one.runs)) assert.equal(item.days.reduce((n, day) => n + day.runs, 0), item.runs, item.id);
  assert.match(every.find(item => item.id === 'J2').why, /^last 10 runs green, no red in 3 days$/, 'J2: its red 6 days back is outside the quiet days and the last 10 runs');
  assert.match(every.find(item => item.id === 'J3').why, /4 runs, needs 10/);
  assert.match(every.find(item => item.id === 'J1').why, /^red 31 Oct · inside the 3 quiet days/);
});

test('a red older than the 14 days is no red of this row: not the last red, not the state', () => {
  const list = [[10, '2026-10-05', 'beta', 'mac', 'J1', 2, 1, 0]];
  for (let n = 0; n < 12; n++) list.push([20 + n, '2026-10-30', 'beta', 'mac', 'J1', 2, 0, 0]);
  const [row] = tier1Rows(cleanSnapshot({journeys: [{id: 'J1', name: 'Find jobs', tier: 1}], tier1: list}, now), now);
  assert.deepEqual([row.lastBad, row.state, row.share], [null, 'stable', 1]);
});

test('the page draws one cell per day of the same 14 days: green, red, amber for a mixed day, grey for no run; the state chip carries its reason', () => {
  const html = page(contradiction, {now});
  const strip = html.match(/<span class="strip"[^>]*>([\s\S]*?)<\/span>/)[1];
  assert.equal((strip.match(/<(a|i) /g) || []).length, 14, '14 cells, one a day');
  assert.match(strip, /class="r" href="https:\/\/github.com\/jobadabra\/jobadabra\/actions\/runs\/900" title="30 Oct · 1 run · 1 red"/, 'the red day links to its red run');
  assert.match(strip, /title="31 Oct · 10 runs · all green"/);
  assert.match(strip, /<i class="e" title="[^"]*no run"/);
  assert.match(html, /Last 14 days/);
  assert.match(html, /Not stable<\/span><div class="muted small">red 30 Oct · inside the 3 quiet days<\/div>/);
  const mixed = cleanSnapshot({journeys: [{id: 'J1', name: 'Find jobs', tier: 1}], tier1: [[1, '2026-11-01', 'beta', 'mac', 'J1', 2, 1, 0], [2, '2026-11-01', 'beta', 'mac', 'J1', 2, 0, 0]]}, now);
  assert.match(page(mixed, {now}), /class="m" href="[^"]*runs\/1" title="1 Nov · 2 runs · 1 red"/, 'a day with a red and a green run is amber and links to the red');
});

// Owner, 2 Nov 2026: "another gauge/circle that will tell us percentage. If we have 20 journeys x 20 runs... that would be 400; if only 5 failures, then 395 out of 400. A raw number is too basic."
test('the second gauge: every Tier 1 run of the 14 days counts once, a red run is a failure, the kept steps are not counted', () => {
  const say = verdict(tier1Rows(snapshot, now));
  assert.deepEqual([say.runs, say.green, say.share], [94, 92, 92 / 94], 'J0 30 + J1 30 (1 red) + J2 30 (1 red) + J3 4; K and J4 are left out');
  assert.equal(say.percent, '97.9%');
  assert.deepEqual([verdict([]).runs, verdict([]).share, verdict([]).percent], [0, null, '–'], 'no run is no percentage, never 100%');
  const html = page(snapshot, {now});
  assert.match(html, /97\.9%<\/text>/, 'the circle shows the percentage');
  assert.match(html, /92 of 94 runs green/, 'with the count behind it, in the owner\'s words: 395 of 400');
  assert.match(html, /aria-label="92 of 94 Tier 1 runs green"/);
  const odd = cleanSnapshot({journeys: [{id: 'J1', name: 'A', tier: 1}], tier1: Array.from({length: 400}, (_, i) => [2000 + i, '2026-11-01', 'after-merge', 'mac', 'J1', 2, i < 5 ? 1 : 0, 0])}, now);
  assert.equal(verdict(tier1Rows(odd, now)).percent, '98.8%', '395 of 400 (98.75%) reads 98.8%');
});

// Owner, 2 Nov 2026: "same size, same alignment/positioning... and green is only if 100%... everything below is orange/yellow/red".
test('one colour scale: green only at exactly 100%, then yellow, orange, red; 99.96% never reads as 100%', () => {
  assert.deepEqual([1, 0.9999, 0.98, 0.979, 0.9, 0.899, 0].map(shareTone), ['good', 'warn', 'warn', 'orange', 'orange', 'bad', 'bad']);
  assert.equal(shareTone(null), 'off');
  assert.deepEqual([1, 1999 / 2000, 0.9996, 395 / 400, null].map(percentOf), ['100%', '99.9%', '99.9%', '98.8%', '–']);
  assert.deepEqual([0.97996, 0.8996, 0.98, 0.9, 0.5].map(percentOf), ['97.9%', '89.9%', '98%', '90%', '50%'], 'a number never sits in a colour band its share does not reach (Gitar on #306)');
  for (const share of [0.97996, 0.8996, 0.9996, 0.98, 0.9]) assert.equal(shareTone(share), shareTone(parseFloat(percentOf(share)) / 100), `${share}: the shown number and the colour agree`);
  const html = page(snapshot, {now});
  const rings = html.match(/<div class="gtmgauge">[\s\S]*?<\/svg><\/div>/g) || [];
  assert.equal(rings.length, 2, 'two rings, one wrapper class: the same size and place');
  assert.match(rings[0], /stroke="#e5484d"/, '2 of 4 journeys stable is 50%: red');
  assert.match(rings[1], /stroke="#f08a3c"/, '97.9% is orange: not green, not yet yellow');
  assert.doesNotMatch(html, /class="muted small">92 of 94/, 'no caption under one ring only: the count is in the note beside them');
  assert.match(html, /92 of 94 runs green in the last 14 days/);
  const perfect = cleanSnapshot({journeys: [{id: 'J1', name: 'A', tier: 1}], tier1: Array.from({length: 12}, (_, i) => [3000 + i, '2026-11-01', 'after-merge', 'mac', 'J1', 2, 0, 0])}, now);
  const all = page(perfect, {now});
  assert.match(all, /100%<\/text>/);
  assert.equal((all.match(/stroke="#3fb68b"/g) || []).length, 2, 'both rings green: 1/1 stable and 100% of runs');
  assert.match(html, /<span class="chip warn">96\.7%<\/span>/, 'a 96.7% chip is amber, never green');
  assert.match(html, /<span class="chip good">100%<\/span>/);
});

test('the trend compares two 14-day windows, and needs 5 runs in each', () => {
  const old = [];
  for (let n = 0; n < 6; n++) old.push([500 + n, '2026-10-10', 'beta', 'mac', 'J0', 1, n < 3 ? 1 : 0, 0]);   // 14 to 27 days back: half red
  const withOld = cleanSnapshot({journeys, tier1: [...rows, ...old]}, now);
  assert.equal(tier1Rows(withOld, now).find(row => row.id === 'J0').trend, 'up');
  assert.equal(tier1Rows(snapshot, now).find(row => row.id === 'J0').trend, null, 'no previous window');
});

test('Tier 2: runs, reds and the last red per journey from the daily tallies', () => {
  const by = Object.fromEntries(tier2Rows(snapshot, now).map(row => [row.id, row]));
  assert.deepEqual([by.J8.runs, by.J8.red, by.J8.share, by.J8.tests, by.J8.lastRed.day], [100, 1, 0.99, 4, '2026-11-01']);
  assert.deepEqual([by.J9.runs, by.J9.lastRed], [10, null]);
});

test('the page: gauge, verdict, states with words, run links, the Trello card, no unescaped name; no data and an empty snapshot say so', () => {
  const html = page(snapshot, {now});
  assert.match(html, /2\/4<\/text>/);
  assert.match(html, /<b>2 of 4 Tier 1 journeys stable<\/b>/);
  assert.match(html, /<span title="J1 Set up &lt;the&gt; app: red 31 Oct"><span class="chip bad">J1<\/span><\/span>/, 'a red journey is a chip, its name and date on hover');
  assert.match(html, /<span class="chip warn">J3<\/span>/);
  assert.doesNotMatch(html, /stable; J1/, 'no sentence of names');
  assert.doesNotMatch(html, /Set up <the>/);
  assert.match(html, /Not stable<\/span>/);
  assert.match(html, /Under 10 runs/);
  assert.match(html, /actions\/runs\/995">#995<\/a>/);
  assert.match(html, /Trello 02/, 'J1 maps to card 02');
  assert.match(html, /Tier 2[^]*J8[^]*99%/);
  assert.match(page(null, {now}), /No data yet/);
});

test('the collector body is validated: old rows, unknown journeys, kinds and OSes are dropped; a long list keeps its newest rows', () => {
  assert.equal(cleanSnapshot({journeys: 'x'}, now), null);
  const clean = cleanSnapshot({journeys: [...journeys, {id: 'bad id', name: 'x', tier: 1}, {id: 'J9', name: '', tier: 2}], tier1: [[1, '2026-11-01', 'beta', 'mac', 'J0', 1, 0, 0], [2, '2026-09-01', 'beta', 'mac', 'J0', 1, 0, 0], [3, '2026-11-01', 'pr', 'mac', 'J0', 1, 0, 0],
    [4, '2026-11-01', 'beta', 'linux', 'J0', 1, 0, 0], [5, '2026-11-01', 'beta', 'mac', 'J99', 1, 0, 0], [6, '2026-11-01', 'beta', 'mac', 'J0', 1, 0, 0, 'extra']], tier2: [{day: '2026-11-01', journey: 'J99', tests: 1, runs: 1, red: 0}], read: {e2e: [5, 'x', 7]}}, now);
  assert.deepEqual(clean.tier1.map(row => row[0]), [1, 6]);
  assert.equal(clean.tier1[1].length, 8);
  assert.deepEqual([clean.journeys.length, clean.tier2.length, clean.read.e2e], [8, 0, [5, 7]], 'a bad id and an empty name are dropped from the 8 journeys');
  const long = cleanSnapshot({journeys, tier1: Array.from({length: MAX_T1 + 500}, (_, i) => [1000 + i, '2026-11-01', 'beta', 'mac', 'J0', 1, 0, 0])}, now);
  assert.deepEqual([long.tier1.length, long.tier1[0][0]], [MAX_T1, 1500]);
});

const env = (stored = null, saved = []) => ({STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', STATS: {prepare: () => ({first: async () => (stored ? {body: JSON.stringify(stored)} : null), bind(...args) { saved.push(args); return this; }, run: async () => ({}), all: async () => ({results: []})})}});
const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env(snapshot), {});

test('owner only, in the Testing menu; the PUT needs the publish key and a snapshot-shaped body and stores one row; the GET returns it', async () => {
  assert.equal((await get('/admin/testing/gtm-readiness')).status, 404);
  const response = await get('/admin/testing/gtm-readiness', {Cookie: 'jp_stats=k3y'});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /GTM readiness/);
  assert.equal(PAGES.find(item => item.path === '/admin/testing/gtm-readiness').group, 'Testing');
  const saved = [], put = (key, body) => worker.fetch(new Request('https://www.jobpilotto.top/gtm/data', {method: 'PUT', headers: key ? {Authorization: `Bearer ${key}`} : {}, body}), env(null, saved), {});
  assert.equal((await put(null, '{}')).status, 404);
  assert.equal((await put('wrong', '{}')).status, 404);
  assert.equal((await put('pub', 'nope')).status, 400);
  assert.equal((await put('pub', '{"journeys":"x"}')).status, 400);
  assert.equal((await put('pub', 'x'.repeat(900001))).status, 413);
  const ok = await put('pub', JSON.stringify({journeys, tier1: [[1, new Date().toISOString().slice(0, 10), 'beta', 'mac', 'J0', 1, 0, 0]]}));
  assert.equal(ok.status, 200);
  assert.equal(saved.length, 1);
  assert.equal((await ingest(new Request('https://x/gtm/data', {headers: {Authorization: 'Bearer pub'}}), env(snapshot), now)).status, 200);
  assert.equal((await ingest(new Request('https://x/gtm/data', {headers: {Authorization: 'Bearer pub'}}), env(null), now)).status, 404, 'no snapshot yet');
  const broken = {SELFHEAL_PUBLISH_KEY: 'pub', STATS: {prepare: () => ({first: async () => { throw new Error('D1 down'); }})}};
  assert.equal((await ingest(new Request('https://x/gtm/data', {headers: {Authorization: 'Bearer pub'}}), broken, now)).status, 503, 'a D1 error is not "no snapshot yet": the collector must not start from nothing');
});
