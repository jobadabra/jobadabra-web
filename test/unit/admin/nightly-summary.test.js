// admin/nightly-summary.js: the nightly report-only numbers (owner, 1 Nov 2026), computed once from the e2e snapshot row and the agent-coding rows; the Testing Overview and the Scheduled rows only draw them.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {page} from '../../../admin/schedules.js';
import {resolve} from '../../../admin/testing-overview-data.js';
import {detailHtml, summaryLine, toggleHtml, trendHtml, NIGHTLY_STYLE} from '../../../admin/nightly-summary-html.js';
import {NIGHTS, lastDays, loadNightlySummary, nightlySummary, summaryFor} from '../../../admin/nightly-summary.js';

const now = new Date('2026-11-02T10:00:00Z');
const D = back => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10);
const night = (runId, day, pairs, within8, extra = {}) => ({runId, day, pairs, within8, over20: 0, factsExact: 63, factsTotal: 63, judged: 18, invented: 1, promptCases: null, ...extra});
const replay = (extra = {}) => ({status: 'asked', total: 63, right: 60, flipped: 0, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66, ...extra});
const job = (summary, id) => summary.jobs.find(item => item.id === id);

test('there are 14 days, oldest first, ending today; every job lists them in the same order', () => {
  assert.equal(NIGHTS, 14);
  const days = lastDays(now);
  assert.deepEqual([days.length, days[0], days.at(-1)], [14, D(13), D(0)]);
  const summary = nightlySummary({snapshot: {quality: [night(1, D(1), 9, 8)]}}, now);
  for (const item of summary.jobs.filter(item => item.series.length)) assert.deepEqual(item.series.map(point => point.day), days, item.id);
});

test('with nothing stored every job says so and draws no night', () => {
  const summary = nightlySummary({}, now);
  assert.deepEqual(summary.jobs.map(item => item.id), ['quality-ai', 'prompt-cases', 'interactions', 'wander', 'notion-real', 'agent-coding', 'beta-clock', 'night-clock']);
  for (const item of summary.jobs) assert.deepEqual([item.value, item.status, item.series.length], ['–', 'none', 0], item.id);
});

test('Quality AI: last night\'s same-score rate and the 14 nights against the 80% bar, the status from the 90-pair rate the e2e page uses', () => {
  const quality = [night(30, D(0), 9, 8), night(29, D(1), 9, 6), night(28, D(1), 9, 9), night(27, D(3), 9, 5)];   // two runs on D(1): the newest run counts
  const item = job(nightlySummary({snapshot: {quality}}, now), 'quality-ai');
  assert.equal(item.value, '89%');
  assert.deepEqual(item.bar.value, 0.8);
  const byDay = Object.fromEntries(item.series.filter(point => point.value != null).map(point => [point.day, [Math.round(point.value * 100), point.ok]]));
  assert.deepEqual(byDay, {[D(0)]: [89, true], [D(1)]: [67, false], [D(3)]: [56, false]});
  assert.equal(item.status, 'bad', '28 of 36 pairs (78%) is under the bar');
  assert.match(item.sub, /78% over the last 36 pairs/);
  const good = job(nightlySummary({snapshot: {quality: [night(30, D(0), 90, 80)]}}, now), 'quality-ai');
  assert.equal(good.status, 'good');
});

test('prompt cases: right of total on the newest replayed night, bad when one got worse, grey-free when not asked', () => {
  const at = promptCases => job(nightlySummary({snapshot: {quality: [night(2, D(1), 9, 8, {promptCases: replay()}), night(3, D(0), 9, 8, {promptCases})]}}, now), 'prompt-cases');
  assert.deepEqual([at(replay()).value, at(replay()).status], ['60/63', 'good']);
  assert.deepEqual([at(replay({flipped: 2})).status, at(replay({flipped: 2})).series.at(-1).ok], ['bad', false]);
  assert.equal(at(replay({status: 'not-asked'})).status, 'warn');
  assert.match(at(replay({status: 'carried', calls: 0})).sub, /no prompt changed/);
  assert.equal(at(null).series.at(-2).value, 60 / 63, 'a night without a replay keeps the earlier night\'s point on its own day only');
  assert.equal(at(null).series.at(-1).value, null);
});

const row = (runId, day, suite, green, rates, extra = {}) => ({runId, day, kind: 'scheduled', suite, platform: 'mac', green, ...(rates ? {rates} : {}), ...extra});

test('interactions: the recall is the key number, the lowest rate of the night counts, and a night before the parser says rates are coming', () => {
  const suiteNights = [row(1, D(2), 'interactions', true), row(2, D(1), 'interactions', true, {recall: 0.875, clean: 0.92, still: 0.75}), row(3, D(1), 'interactions', true, {recall: 0.75, clean: 0.95}, {platform: 'windows'})];
  const item = job(nightlySummary({snapshot: {suiteNights}}, now), 'interactions');
  assert.equal(item.value, '75%', 'the lower of the two platforms');
  assert.match(item.sub, /recall of planted bugs · 92% controls clean · 75% pages still/);
  assert.equal(item.series.find(point => point.day === D(2)).value, null, 'no rates that night');
  const old = job(nightlySummary({snapshot: {suiteNights: [row(1, D(1), 'interactions', true)]}}, now), 'interactions');
  assert.deepEqual([old.value, old.status], ['green', 'good']);
  assert.match(old.sub, /rates start with the next night/);
  assert.equal(job(nightlySummary({snapshot: {suiteNights: [row(1, D(0), 'interactions', false)]}}, now), 'interactions').status, 'bad');
});

test('wander and real Notion are a 14-night green/red trend; a red platform makes the night red; shard names merge; PR rows do not count', () => {
  const suiteNights = [row(1, D(2), 'wander', true), row(2, D(1), 'wander', true), row(3, D(1), 'wander', false, null, {platform: 'windows'}), row(4, D(0), 'wander', true),
    row(5, D(0), 'wander', false, null, {kind: 'pr'}), row(6, D(0), 'notion-real-1of2', true), row(7, D(0), 'notion-real-2of2', false)];
  const summary = nightlySummary({snapshot: {suiteNights}}, now);
  const wander = job(summary, 'wander');
  assert.deepEqual(wander.series.filter(point => point.ok != null).map(point => [point.day, point.ok]), [[D(2), true], [D(1), false], [D(0), true]]);
  assert.deepEqual([wander.value, wander.status, wander.sub], ['green', 'good', `2 of 3 nights green · ${D(0)}`]);
  assert.deepEqual([job(summary, 'notion-real').value, job(summary, 'notion-real').status], ['red', 'bad']);
});

test('agent coding: areas with 3+ fix PRs in the 7 days up to each day, bar none', () => {
  const ci = (day, fixPrs) => ({kind: 'ci', day, card: JSON.stringify({fixPrs})});
  const agentRows = [ci(D(3), {panel: 1, site: 1}), ci(D(2), {panel: 1}), ci(D(1), {panel: 1, site: 1}), ci(D(0), {site: 1}), {kind: 'gate', day: D(0), card: '{}'}];
  const item = job(nightlySummary({agentRows}, now), 'agent-coding');
  assert.deepEqual(item.series.filter(point => point.value != null).map(point => [point.day, point.value]), [[D(3), 0], [D(2), 0], [D(1), 1], [D(0), 2]], 'panel reaches 3 on D(1); site reaches 3 on D(0) while panel is still inside its 7 days');
  assert.deepEqual([item.value, item.status, item.bar.value], ['2', 'bad', 0]);
  assert.equal(job(nightlySummary({agentRows: [ci(D(0), {})]}, now), 'agent-coding').status, 'good');
  assert.equal(job(nightlySummary({agentRows: [{kind: 'ci', day: D(0), card: '{broken'}]}, now), 'agent-coding').value, '0', 'a damaged card reads as no fix PRs, not a crash');
});

test('wall clocks: minutes per run per day for the beta and for the nights, from the days rows', () => {
  const days = [{day: D(2), kind: 'beta', runs: 2, wallMin: 60}, {day: D(0), kind: 'beta', runs: 1, wallMin: 24}, {day: D(0), kind: 'nightly', runs: 3, wallMin: 90}, {day: D(0), kind: 'scheduled', runs: 1, wallMin: 30},
    {day: D(0), kind: 'pr', runs: 9, wallMin: 900}, {day: D(1), kind: 'beta', runs: 1}];
  const summary = nightlySummary({snapshot: {days}}, now);
  const beta = job(summary, 'beta-clock'), night = job(summary, 'night-clock');
  assert.deepEqual([beta.value, beta.median, beta.status, beta.bar], ['24 min', 27, 'none', null], 'no bar is set for a wall clock: the page draws the median');
  assert.equal(night.value, '30 min', '(90 + 30) / (3 + 1)');
  assert.match(beta.sub, /median of 2 days: 27 min/);
  const before = job(nightlySummary({snapshot: {days: [{day: D(0), kind: 'beta', runs: 1}]}}, now), 'beta-clock');
  assert.match(before.sub, /stored from the next collector pass/, 'a snapshot from before the wall minutes were kept says so, not 0');
});

test('summaryFor gives the Scheduled row its jobs by workflow file', () => {
  const summary = nightlySummary({}, now);
  assert.deepEqual(summaryFor(summary, 'e2e.yml').map(item => item.id), ['quality-ai', 'interactions', 'wander', 'notion-real', 'night-clock']);
  assert.deepEqual(summaryFor(summary, 'prompt-cases-night.yml').map(item => item.id), ['prompt-cases']);
  assert.deepEqual(summaryFor(summary, 'desktop.yml').map(item => item.id), ['beta-clock']);
  assert.deepEqual(summaryFor(summary, 'agent-coding-stats.yml').map(item => item.id), ['agent-coding']);
  assert.deepEqual(summaryFor(summary, 'mutation.yml'), []);
  assert.deepEqual(summaryFor(null, 'e2e.yml'), []);
});

test('the one reader reads the snapshot row and the agent rows, and a broken store gives an empty summary, not an error', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE e2e_snapshot (id INTEGER PRIMARY KEY, at TEXT, body TEXT); CREATE TABLE agent_coding_days (kind TEXT, day TEXT, card TEXT, updated_at TEXT)');
  db.prepare('INSERT INTO e2e_snapshot VALUES (1, ?, ?)').run('x', JSON.stringify({quality: [night(30, D(0), 9, 8)]}));
  db.prepare('INSERT INTO agent_coding_days VALUES (?, ?, ?, ?)').run('ci', D(0), JSON.stringify({fixPrs: {site: 3}}), 'x');
  const STATS = {prepare: sql => { const statement = db.prepare(sql); return {bind: (...args) => ({all: async () => ({results: statement.all(...args)}), first: async () => statement.get(...args) ?? null}), first: async () => statement.get() ?? null}; }};
  const summary = await loadNightlySummary({STATS}, now);
  assert.equal(job(summary, 'quality-ai').value, '89%');
  assert.equal(job(summary, 'agent-coding').value, '1');   // one area with 3 fix PRs
  const broken = await loadNightlySummary({STATS: {prepare: () => { throw new Error('down'); }}}, now);
  assert.ok(broken.jobs.every(item => item.status === 'none'));
});

test('one renderer: a rate has its bar line and a verdict chip, a wall clock a number with no verdict chip, and a job with nothing says no data', () => {
  const summary = nightlySummary({snapshot: {quality: [night(30, D(0), 90, 80)], days: [{day: D(0), kind: 'beta', runs: 1, wallMin: 30}]}}, now);
  const quality = trendHtml(job(summary, 'quality-ai'));
  assert.match(quality, /<b>89%<\/b> <span class="nchip good">✓ ok<\/span>/);
  assert.match(quality, /<s style="bottom:80%"/, 'the dashed line sits at the 80% bar');
  assert.equal((quality.match(/<i /g) || []).length, 14, 'one cell per night');
  const clock = trendHtml(job(summary, 'beta-clock'));
  assert.match(clock, /<b>30 min<\/b>/);
  assert.doesNotMatch(clock, /nchip/, 'no bar exists for a wall clock, so no verdict chip');
  assert.match(trendHtml(job(summary, 'wander')), /<span class="nchip off">◷ no data<\/span>/);
  assert.match(trendHtml(job(nightlySummary({snapshot: {suiteNights: [row(1, D(0), 'wander', false)]}}, now), 'wander')), /✕ off/);
});

test('Testing → Scheduled: the column has its header and one cell in every row, one line and a toggle only on the workflows that have a summary, the detail on its own full-width row', () => {
  const snapshot = {at: now.toISOString(), repos: [], jobs: [
    {repo: 'GarryOne/jobadabra', file: 'e2e.yml', name: 'CI · E2E', about: '', crons: ['0 2 * * *'], recent: []},
    {repo: 'GarryOne/jobadabra', file: 'mutation.yml', name: 'CI · Mutation', about: '', crons: ['0 3 * * 1'], recent: []}]};
  const summary = nightlySummary({snapshot: {quality: [night(30, D(0), 9, 8)]}}, now);
  const html = page(snapshot, {only: 'testing', now, summary});
  const header = html.match(/<tr><th>Job<\/th>.*?<\/tr>/s)[0], rows = [...html.matchAll(/<tr class="[^"]*"?><td><b><a/g)].length;
  assert.match(header, /<th>Last night<\/th>/);
  const cells = row => (row.match(/<td[ >]/g) || []).length, bodies = [...html.matchAll(/<tr class=""><td>.*?<\/tr>/gs)].map(match => match[0]);
  assert.equal(bodies.length, 2, `${rows} rows`);
  for (const body of bodies) assert.equal(cells(body), (header.match(/<th/g) || []).length, 'a td for every th');
  assert.match(bodies[0], /class="nline"/);
  assert.match(bodies[0], /Quality AI no data|◷ \d+ no data/);
  assert.doesNotMatch(bodies[0], /class="nt"|class="nbars/, 'the 14-night blocks are not in the row itself (owner, 2 Nov 2026: too crowded)');
  assert.doesNotMatch(bodies[1], /nline|ntoggle/, 'a workflow with no summary shows a dash and no toggle');
  const detail = html.match(/<tr class="ndetail" id="(nd-GarryOne-jobadabra-e2e-yml)" hidden><td colspan="(\d+)">(.*?)<\/td><\/tr>/s);
  assert.ok(detail, 'the e2e row has a hidden detail row under it');
  assert.equal(detail[2], String((header.match(/<th/g) || []).length), 'it spans every column');
  assert.match(bodies[0], /aria-controls="nd-GarryOne-jobadabra-e2e-yml" aria-expanded="false"|aria-expanded="false" aria-controls="nd-GarryOne-jobadabra-e2e-yml"/);
  assert.match(detail[3], /class="nt"/);
  assert.match(detail[3], /href="\/admin\/testing\/report-only">All measurements → Report only/);
  assert.equal((html.match(/class="ndetail"/g) || []).length, 1, 'no detail row for a workflow without a summary');
  assert.match(page(snapshot, {only: 'testing', now}), /<th>Last night<\/th>/, 'a page with no summary still draws the column, empty');
});

test('Testing → Overview: the cards of e2e, interactions, wander and quality-ai carry their trends, every other card none', () => {
  const model = resolve({e2e: {quality: [night(30, D(0), 9, 8)], suiteNights: [row(1, D(0), 'wander', true)]}, now, repo: 'GarryOne/jobadabra'});
  const cards = model.rings.flatMap(ring => ring.cards).filter(card => card.kind === 'live'), byId = id => cards.find(card => card.id === id).trends.map(item => item.id);
  assert.deepEqual(byId('e2e'), ['notion-real', 'beta-clock', 'night-clock'], 'in the summary\'s own order');
  assert.deepEqual([byId('interactions'), byId('wander'), byId('quality-ai')], [['interactions'], ['wander'], ['quality-ai', 'prompt-cases']]);
  assert.deepEqual(cards.filter(card => !['e2e', 'interactions', 'wander', 'quality-ai'].includes(card.id) && card.trends.length).map(card => card.id), []);
});

test('rows older than the 14 nights shown never make a job throw: each says there is nothing in the window (Gitar on #266: both pages answered 500)', () => {
  const old = D(20), snapshot = {quality: [night(5, old, 9, 8, {promptCases: replay()})], suiteNights: ['interactions', 'wander', 'notion-real'].map((suite, i) => row(i, old, suite, true, suite === 'interactions' ? {recall: 0.8} : null)),
    days: [{day: old, kind: 'beta', runs: 1, wallMin: 30}, {day: old, kind: 'nightly', runs: 1, wallMin: 30}]};
  const agentRows = [{kind: 'ci', day: D(18), card: JSON.stringify({fixPrs: {site: 4}})}];
  const summary = nightlySummary({snapshot, agentRows}, now);
  assert.equal(summary.jobs.length, 8);
  for (const item of summary.jobs) assert.deepEqual([item.value, item.status, item.series.length], ['–', 'none', 0], item.id);
  assert.match(job(summary, 'quality-ai').sub, /last 14 nights/);
  assert.match(job(summary, 'agent-coding').sub, /last 14 days/);
});

test('the row keeps one line: what is off or missing by name (a count from 3), the ok ones counted, a wall clock as "night 10.5 min"; nothing for no jobs', () => {
  const summary = nightlySummary({snapshot: {suiteNights: [row(1, D(0), 'interactions', true), row(2, D(0), 'wander', true), row(3, D(0), 'notion-real', true)], days: [{day: D(0), kind: 'nightly', runs: 2, wallMin: 21}]}}, now);
  const line = summaryLine(summaryFor(summary, 'e2e.yml'));
  assert.match(line, /◷ Quality AI no data/);
  assert.match(line, /✓ 3 green/);
  assert.match(line, /night <b>10\.5 min<\/b>/);
  assert.doesNotMatch(line, /class="nbars/);
  const red = nightlySummary({snapshot: {suiteNights: [row(1, D(0), 'wander', false)]}}, now);
  assert.match(summaryLine(summaryFor(red, 'e2e.yml')), /✕ Wander off/);
  assert.match(summaryLine(summaryFor(nightlySummary({}, now), 'e2e.yml')), /◷ 5 no data/, 'three or more with nothing are one count');
  assert.equal(summaryLine([]), ''); assert.equal(summaryLine(null), ''); assert.equal(detailHtml([], 8, 'x', '/r'), ''); assert.equal(toggleHtml([], 'x'), '');
});

test('two cards a row on a desktop, one on a phone, in the one stylesheet both pages use (owner, 2 Nov 2026: "2 columns per row, not 3")', () => {
  assert.match(NIGHTLY_STYLE, /\.rgrid,\.ngrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(NIGHTLY_STYLE, /@media \(max-width:640px\)\{\.rgrid,\.ngrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.doesNotMatch(NIGHTLY_STYLE, /auto-fill/);
});

test('two repos that schedule the same file name get two different detail ids, so each Details button opens its own row (Gitar on #330)', () => {
  const job = repo => ({repo, file: 'e2e.yml', name: 'CI · E2E', about: '', crons: ['0 2 * * *'], recent: []});
  const html = page({at: now.toISOString(), repos: [], jobs: [job('GarryOne/jobadabra'), job('GarryOne/jobadabra-lab')]}, {only: 'testing', now, summary: nightlySummary({}, now)});
  const ids = [...html.matchAll(/<tr class="ndetail" id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, ids.join(' '));
  assert.deepEqual([...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]), ids);
});
