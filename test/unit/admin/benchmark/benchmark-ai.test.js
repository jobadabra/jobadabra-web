// Which AI ran our job search in a benchmark round (owner, 13 Nov 2026: Haiku-only rounds and app-tiers rounds are not comparable, so the charts mark where it changed).
// Covers: the `ai` column (old rows read as Haiku), the break on the "Benchmark · right jobs" tile, the label on Admin's round links, the public sentence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spark} from '../../../../admin/admin.js';
import {aiOf, changes} from '../../../../admin/benchmark-ai.js';
import {clean} from '../../../../admin/benchmark-search.js';
import {summarize} from '../../../../admin/benchmark-search-data.js';
import {page} from '../../../../admin/benchmark-search-page.js';
import {JOB_SEARCH} from '../../../../admin/headlines-search.js';
import {searchSection} from '../../../../admin/benchmark-publish.js';

const run = (round, ai, extra = {}) => ({id: `${round}/a/Ours`, at: `${round}T10:00:00Z`, round, persona: 'Nurse · Town', kind: 'non-tech', country: 'Land', tool: 'Ours', ours: true, build: 'abc', found: 10, place: 5, role: 5, relevant: 4, employers: 1, seconds: 60, cents: 0, ai, ...extra});
const ROWS = [run('2026-11-10', undefined), run('2026-11-11', ''), run('2026-11-13', 'app', {relevant: 6}), {...run('2026-11-13', 'app'), id: 'x/Other', tool: 'Other', ours: false, ai: undefined}];
const snapshot = () => ({...summarize(ROWS), at: '2026-11-13T12:00:00Z'});

test('a run without a value reads as Haiku (every round before jobadabra-benchmarks #31 on 13 Nov 2026); an unknown word is not an AI', () => {
  assert.deepEqual([aiOf(undefined), aiOf(''), aiOf('haiku'), aiOf('app'), aiOf('gpt')], ['haiku', 'haiku', 'haiku', 'app', 'haiku']);
  assert.equal(clean(run('2026-11-13', 'app')).ai, 'app');
  assert.equal(clean(run('2026-11-10', undefined)).ai, '', 'stored empty = not said, read as Haiku');
  assert.equal(clean(run('2026-11-10', 'gpt')).ai, '');
});

test('a round knows which AI ours used; the change between rounds is found once, at the first app-tiers round', () => {
  const rounds = snapshot().rounds;
  assert.deepEqual(Object.values(rounds).map(round => round.ai), ['haiku', 'haiku', 'app']);
  assert.deepEqual(changes(rounds), [{round: '2026-11-13', index: 2, from: 'haiku', to: 'app'}]);
  assert.deepEqual(changes({a: {ai: 'app'}, b: {ai: 'app'}}), [], 'no change, no mark');
  assert.deepEqual(changes({a: {}, b: {}}), [], 'a snapshot built before the column existed has no mark');
});

test('the bar chart leaves a gap and a mark at the break, and draws no arrow across it', () => {
  const across = spark([4, 4, 6], {breaks: [2]}), within = spark([4, 4, 6]);
  assert.match(across, /class="brk"/);
  assert.match(across, /AI changed/);
  assert.doesNotMatch(across, /▲|▼/, 'the last two bars are on different AIs: no "better / worse"');
  assert.match(within, /▲/);
  assert.doesNotMatch(within, /class="brk"/);
  assert.match(spark([4, 6, 7], {breaks: [1]}), /▲/, 'the last two bars share an AI: the arrow stays');
});

test('the "Benchmark · right jobs" tile marks the break and says the rounds are not comparable', async () => {
  const body = JSON.stringify(snapshot());
  const env = {STATS: {prepare: () => ({first: async () => ({body})})}};
  const [tile] = await JOB_SEARCH['/admin/job-search/benchmark'](env);
  assert.deepEqual(tile.breaks, [2]);
  assert.match(tile.mark, /AI changed 2026-11-13: Haiku → app tiers, not comparable/);
  const old = JSON.stringify(summarize(ROWS.slice(0, 2)));
  const [plain] = await JOB_SEARCH['/admin/job-search/benchmark']({STATS: {prepare: () => ({first: async () => ({body: old})})}});
  assert.equal(plain.mark, undefined);
  assert.deepEqual(plain.breaks, []);
});

test('Admin: the round links say which AI, and a round on a new AI says the earlier ones are not comparable', () => {
  const html = page(snapshot(), {round: '2026-11-13'});
  // Why (13 Nov 2026, owner: "Full rounds by date + time"): 2026-11-13 has a rival's rows for the widest set of people (here 1), so it is a full round and reads as its time and AI; the others are ours alone, test runs, each saying what it is with the key last.
  assert.match(html, /2026-11-13 10:00 UTC · App tiers</);
  assert.match(html, /2026-11-11 10:00 UTC · ours only · 1 person · Haiku · 2026-11-11/);
  assert.match(html, /AI changed: Haiku → app tiers, not comparable with the rounds before/);
  assert.match(page(snapshot(), {round: '2026-11-10'}), /Ours ran on Haiku only in this round/);
});

test('the published section carries the AI (the public sentence: test/unit/website/benchmark-page.test.js)', () => {
  const snap = snapshot(), part = searchSection('2026-11-13', snap.rounds['2026-11-13'], snap.at);
  assert.equal(part.ai, 'app');
});
