// /admin/testing/e2e's scorecard and "Where e2e work goes" (admin/e2e-scorecard.js; spec rules I and J, owner 28 Oct 2026): a suite's catches vs its noise, shards as one suite, and the weekly plumbing share against 15%.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {baseSuite, scoreRows, scorecardCard, workCard, workWeeks} from '../../admin/e2e-scorecard.js';
import {page} from '../../admin/e2e-page.js';

const fail = (suite, cause, n = 1, min = 10, extra = {}) => ({day: '2026-10-27', suite, platform: 'mac', cause, n, min, kind: 'pr', ...extra});

test('a suite caught a bug only when the cause is "product"; shards count as one suite; the catching suites come first', () => {
  assert.equal(baseSuite('applyflows-2of2'), 'applyflows');
  assert.equal(baseSuite('quality'), 'quality');
  const rows = scoreRows([fail('applyflows-1of2', 'flake', 2), fail('applyflows-2of2', 'product'), fail('quality', 'ai', 3, 60), fail('quality', 'drift'), fail('strategy', 'open'), fail('settings', 'product', 2)]);
  assert.deepEqual(rows.map(row => [row.suite, row.caught, row.noise, row.ours, row.unnamed, row.min]),
    [['settings', 2, 0, 0, 0, 10], ['applyflows', 1, 2, 0, 0, 20], ['quality', 0, 1, 3, 0, 70], ['strategy', 0, 0, 0, 1, 10]]);
});

test('the scorecard card lists every red suite with chips and names the ones that caught nothing', () => {
  const html = scorecardCard({fails: [fail('apply', 'product'), fail('strategy', 'flake', 4)]}, 'Last 7 days');
  assert.match(html, /<code>apply<\/code><\/td><td class="num"><span class="chip good">1<\/span>/);
  assert.match(html, /<code>strategy<\/code><\/td><td class="num"><span class="muted">0<\/span><\/td><td class="num"><span class="muted">0<\/span><\/td><td class="num"><span class="chip warn">4<\/span>/);
  assert.match(html, /Red but caught nothing in this range: <code>strategy<\/code>/);
  assert.match(scorecardCard({fails: []}, 'x'), /No red suites in this range/);
});

test('work: weeks newest first, the plumbing share of each week, the over/under chip against 15%, and the week\'s most-changed files', () => {
  const work = [{day: '2026-10-27', kind: 'plumbing', commits: 3}, {day: '2026-10-26', kind: 'product', commits: 7}, {day: '2026-10-21', kind: 'plumbing', commits: 1}, {day: '2026-10-20', kind: 'product', commits: 9}];
  assert.deepEqual(workWeeks(work).map(row => [row.week, row.total, row.plumbing]), [['2026-10-26', 10, 0.3], ['2026-10-19', 10, 0.1]]);
  const wed = new Date('2026-10-28T12:00:00Z'), html = workCard({work, workFiles: [{week: '2026-10-26', file: '.github/workflows/e2e.yml', commits: 2}, {week: '2026-10-19', file: 'tools/old.sh', commits: 1}]}, wed);
  assert.match(html, /<b>30%<\/b><span class="chip bad">over 15%<\/span><div class="muted">3 of 10 commits since 26 Oct<\/div>/);
  assert.match(html, /<code>\.github\/workflows\/e2e\.yml<\/code>/);
  assert.doesNotMatch(html, /tools\/old\.sh/, 'only this week\'s files are listed');
  assert.match(workCard({work: [{day: '2026-10-27', kind: 'product', commits: 9}, {day: '2026-10-27', kind: 'plumbing', commits: 1}]}, wed), /chip good">under 15%/);
  const nextMonday = workCard({work, workFiles: []}, new Date('2026-11-02T06:00:00Z'));   // Gitar on #210: no row yet this week is an empty week, not last week's numbers
  assert.match(nextMonday, /Plumbing this week<\/span><b>–<\/b><div class="muted">no commit read since 2 Nov yet<\/div>/);
  assert.doesNotMatch(nextMonday, /class="chip (good|bad)">(over|under) 15%/);
  assert.match(nextMonday, /26 Oct<\/b>/, 'the past weeks still draw as bars');
  assert.match(workCard({}), /No commits read yet/);
});

test('the page shows both cards, and the scorecard follows the kind filter', () => {
  const snapshot = {at: '2026-10-27T12:00:00Z', days: [{day: '2026-10-27', kind: 'pr', runs: 2, reds: 2}], fails: [fail('apply', 'product'), fail('quality', 'ai', 1, 10, {kind: 'nightly'})], latest: [], work: [{day: '2026-10-27', kind: 'plumbing', commits: 1}]};
  const all = page(snapshot, {now: new Date('2026-10-27T12:00:00Z')}), pr = page(snapshot, {kind: 'pr', now: new Date('2026-10-27T12:00:00Z')});
  assert.match(all, /Scorecard: which suites catch bugs/);
  assert.match(all, /Where e2e work goes · per week/);
  assert.match(all, /caught nothing in this range: <code>quality<\/code>/);
  assert.doesNotMatch(pr, /<code>quality<\/code>/, 'a nightly red is not in the PR view');
});

const escapes = [
  {week: '2026-10-26', sha: 'a'.repeat(40), suites: ['settings'], none: false, journey: 'save settings'},
  {week: '2026-10-26', sha: 'b'.repeat(40), suites: [], none: true, journey: 'resume <a draft> & continue'},
];
const wed = new Date('2026-10-28T12:00:00Z');

test('a week with three catches and two escapes shows missed suites without reds and links the uncovered journey', () => {
  const snapshot = {at: wed.toISOString(), fails: [fail('apply', 'product', 3)], escapes, latest: []};
  const html = page(snapshot, {now: wed});
  assert.match(html, /This week: caught 3 bugs, missed 2 \(1 with no suite\)/);
  assert.match(html, /Caught a bug<\/th><th class="num">Missed \(escaped\)<\/th>/);
  assert.match(html, /<code>settings<\/code><\/td><td class="num"><span class="muted">0<\/span><\/td><td class="num"><span class="chip bad">1<\/span>/);
  assert.match(html, /Missed, no suite plays it/);
  assert.match(html, /https:\/\/github.com\/jobadabra\/jobadabra\/commit\/b{40}/);
  assert.match(html, /resume &lt;a draft&gt; &amp; continue/);
  assert.doesNotMatch(html, /<code>resume|<a draft>/);
  assert.doesNotMatch(html, /Red but caught nothing in this range: <code>settings/);
});

test('no trailers means zero misses; each commit counts once overall and once per base suite', () => {
  const noMiss = scorecardCard({fails: [fail('apply', 'product', 3)]}, 'Last 7 days', {now: wed});
  assert.match(noMiss, /This week: caught 3 bugs, missed 0 \(0 with no suite\)/);
  assert.match(noMiss, /chip good">3<\/span><\/td><td class="num"><span class="muted">0<\/span>/);
  assert.doesNotMatch(noMiss, /Missed, no suite plays it/);
  const rows = scoreRows([], [{...escapes[0], suites: ['applyflows-1of2', 'applyflows-2of2', 'jobs']}]);
  assert.deepEqual(rows.map(row => [row.suite, row.missed]), [['applyflows', 1], ['jobs', 1]]);
});

test('calendar week totals stay separate from the range table and public-main escapes ignore the run-kind filter', () => {
  const snapshot = {at: wed.toISOString(), latest: [], escapes: [...escapes,
    {...escapes[0], week: '2026-10-19', sha: 'c'.repeat(40), suites: ['last-week']},
    {...escapes[1], week: '2026-09-28', sha: 'd'.repeat(40), journey: 'too old'}],
    fails: [fail('apply', 'product', 3), fail('old', 'product', 9, 10, {day: '2026-10-23'}), fail('night', 'product', 2, 10, {kind: 'nightly'})]};
  const html = page(snapshot, {now: wed, kind: 'pr'});
  assert.match(html, /This week: caught 3 bugs, missed 2 \(1 with no suite\)/);
  assert.match(html, /<code>last-week<\/code>/);
  assert.doesNotMatch(html, /too old/);
  assert.match(page(snapshot, {now: new Date('2026-11-02T06:00:00Z')}), /This week: caught 0 bugs, missed 0 \(0 with no suite\)/);
});

test('ingestion keeps escapes in the snapshot, retains them after an unreadable main, replaces a fresh read and drops invalid rows', async () => {
  const {ingest} = await import('../../admin/e2e-intel.js');
  let stored = null;
  const statement = sql => ({bind: (...args) => ({...statement(sql), run: async () => { if (sql.startsWith('INSERT INTO e2e_snapshot')) stored = args[1]; }}),
    all: async () => ({results: []}), first: async () => stored ? {body: stored} : null});
  const env = {SELFHEAL_PUBLISH_KEY: 'test-only', STATS: {prepare: statement, batch: async () => {}}};
  const put = async extra => {
    const response = await ingest(new Request('https://example.test/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer test-only'},
      body: JSON.stringify({runs: [], fails: [], ...extra})}), env, wed);
    assert.equal(response.status, 200);
    return JSON.parse(stored);
  };
  assert.deepEqual((await put({escapes: [...escapes, {...escapes[0], sha: 'bad link'}, {...escapes[0], week: '2026-01-01'}]})).escapes, escapes);
  assert.deepEqual((await put({})).escapes, escapes);
  assert.deepEqual((await put({escapes: []})).escapes, []);
});
