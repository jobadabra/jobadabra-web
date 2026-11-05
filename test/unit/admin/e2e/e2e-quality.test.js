// How steady the AI is in the quality suite, as rates over the last 90 score pairs (owner, 27 Oct 2026: "Code gate + AI rate"; bars: "Below 80% of last 90",
// "Above 2% of last 90"). The collector reads the night's live quality run's log (counts only), the site keeps one row per night, /admin/testing/e2e draws it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {BARS, cleanNight, cleanPrompt, nightOf, promptCasesOf, rateOf} from '../../../../admin/e2e-quality.js';
import {qualityCard} from '../../../../admin/e2e-page.js';
import {liveNights, nightFromJobs} from '../../../../tools/ci-intel/jobs/e2e-intel.mjs';

// Lines as a GitHub job log prints them (a timestamp first). Main 27 Oct 2026, run 40433806296: 3002 85 -> 75, 3005 65 -> 56.
const LOG = ['2026-10-27T01:56:14.1Z   scores: 3001=95 3002=85 3003=75 3004=35 3005=65 3006=35 3007=dropped 3008=85 3009=58 3010=85 3011=dropped',
  '2026-10-27T01:58:02.9Z   second scores: 3001=92 3002=75 3003=75 3004=35 3005=56 3006=35 3007=- 3008=78 3009=56 3010=60 3011=-',
  '2026-10-27T01:58:40.4Z   judged 18 score texts: 16 grounded, 18 useful, 2 with invented facts',
  '2026-10-27T01:59:10.0Z quality: 63/63 facts exact, ranking ok, 0 invented facts, scores stable within ±25',
  '2026-10-27T02:01:00.0Z   scores: 3001=10 3002=10',   // the retry's lines come after the first try's: never counted
  '2026-10-27T02:03:00.0Z   second scores: 3001=90 3002=90'].join('\n');

test('a live night is read from its log: pairs, within 8, over 20, facts and judge flags, first try only', () => {
  assert.deepEqual(nightOf(LOG), {pairs: 9, within8: 6, over20: 1, factsExact: 63, factsTotal: 63, judged: 18, invented: 2});
  assert.equal(nightOf(LOG.split('\n').filter(line => !line.includes('second scores')).join('\n')), null, 'a replayed gate scores nothing twice: no night');
  assert.equal(nightOf(''), null);
});

const night = (runId, pairs, within8, over20 = 0, day = '2026-10-27') => ({runId, day, pairs, within8, over20, factsExact: 63, factsTotal: 63, judged: 18, invented: 1});

test('the rate covers the newest nights holding the last 90 pairs, against the owner\'s bars', () => {
  assert.deepEqual([BARS.pairs, BARS.agree, BARS.jumps], [90, 0.8, 0.02]);
  const nights = Array.from({length: 12}, (_, i) => night(100 - i, 9, i < 10 ? 8 : 0));   // newest first; the two oldest nights would drag the rate down
  const rate = rateOf(nights);
  assert.equal(rate.nights, 10);
  assert.equal(rate.pairs, 90);
  assert.equal(rate.agree, 80 / 90);
  assert.equal(rate.agreeOk, true);
  assert.equal(rateOf([night(1, 90, 71), ...nights]).agreeOk, false, '71 of 90 within 8 (79%) is under the bar');
  assert.equal(rateOf([night(1, 90, 72), ...nights]).agreeOk, true, '72 of 90 (80%) holds it');
  assert.equal(rateOf([night(1, 90, 90, 2)]).jumpsOk, false, '2 of 90 over 20 is above 2%');
  assert.equal(rateOf([night(1, 90, 90, 1)]).jumpsOk, true);
  assert.equal(rateOf([]).agree, null);
});

test('a night that does not add up is dropped', () => {
  assert.ok(cleanNight(night(5, 9, 9)));
  for (const bad of [night(0, 9, 9), night(5, 0, 0), night(5, 9, 10), night(5, 9, 9, 10), {...night(5, 9, 9), day: 'x'}, {...night(5, 9, 9), invented: 30}, {...night(5, 9, 9), pairs: 1.5}]) assert.equal(cleanNight(bad), null, JSON.stringify(bad));
});

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}

test('the site stores each night once, puts the nights in the snapshot and tells the collector which it has', async () => {
  const e = {STATS: d1(), SELFHEAL_PUBLISH_KEY: 'pub'};
  const put = body => worker.fetch(new Request('https://www.jobpilotto.top/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(body)}), e, {});
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await put({rules: 1, runs: [], fails: [], quality: [night(7, 9, 8, 0, today), night(8, 9, 0, 9, 'bad')]})).status, 200);
  await put({rules: 1, runs: [], fails: [], quality: [{...night(7, 9, 1, 0, today)}]});   // the same night again: kept as first stored
  const snapshot = JSON.parse(e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body);
  assert.deepEqual(snapshot.quality.map(row => [row.runId, row.within8]), [[7, 8]]);
  const listed = await (await worker.fetch(new Request('https://www.jobpilotto.top/e2e/data?v=1', {headers: {Authorization: 'Bearer pub'}}), e, {})).json();
  assert.deepEqual(listed.quality, [7]);
});

test('the page shows the rate against each bar, red when a bar fails, and each night', () => {
  const ok = qualityCard([night(41, 90, 85, 1)]);
  assert.match(ok, /94\.4%/);
  assert.match(ok, /<span class="chip good">bar ≥ 80%<\/span>/);
  assert.match(ok, /actions\/runs\/41/);
  const red = qualityCard([night(42, 90, 60, 5)]);
  assert.match(red, /<span class="chip bad">bar ≥ 80%<\/span>/);
  assert.match(red, /<span class="chip bad">bar ≤ 2%<\/span>/);
  assert.match(qualityCard([]), /No live quality night yet/);
});

test('the collector picks the night by what ran, not by its title\'s pass number or its hour: Night burn-in 1/5 at 21:00 UTC counts', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const run = (databaseId, createdAt, displayTitle, conclusion = 'success') => ({databaseId, createdAt, displayTitle, conclusion});
  const listed = [run(1, '2026-11-01T21:00:40Z', 'Night burn-in 1/5 · main'), run(2, '2026-11-01T23:30:40Z', 'Night burn-in 2/5 · main', 'failure'), run(3, '2026-11-01T21:47:00Z', 'E2E check · on time (Worker cron)'),
    run(4, '2026-11-01T09:10:00Z', 'E2E check · GitHub schedule (backup)'), run(5, '2026-11-01T21:50:00Z', 'E2E after merge · abc · settings'), run(6, '2026-11-01T21:49:00Z', 'Night burn-in 3/5 · main', 'cancelled'),
    run(7, '2026-11-01T21:20:00Z', 'Night burn-in 4/5 · main'), run(8, '2026-10-28T21:00:00Z', 'Night burn-in 1/5 · main'), run(9, '2026-11-01T05:30:00Z', 'Beta E2E tests desktop-v0.8.60')];
  assert.deepEqual(liveNights(listed, new Set([7]), now).map(item => item.databaseId), [1, 2, 3, 4], 'stored (7), cancelled (6), other kinds (5, 9) and runs older than two days (8) are not read again');
});

const JOBS = [{id: 11, name: 'quality'}, {id: 12, name: 'qualityai'}, {id: 13, name: 'prompt-cases-night / Prompt cases, nightly (report only)'}, {id: 14, name: 'settings'}];
const PROMPT_LINE = '2026-11-01T21:40:00.1Z PROMPT_CASES_NIGHT {"set":"form","status":"asked","sha":"abc1234","total":63,"right":60,"flipped":1,"noise":2,"newWrong":0,"unconfirmed":0,"calls":66}';
const logs = {11: LOG.split('\n').filter(line => !line.includes('second scores')).join('\n'), 12: LOG, 13: `some line\n${PROMPT_LINE}\n::notice title=Prompt cases::x`, 14: ''};
const logOf = async id => logs[id];

test('the night is the first quality job that scored twice (the live qualityai, not the exact quality job), with the same run\'s prompt cases', async () => {
  const night = await nightFromJobs(JOBS, logOf);
  assert.deepEqual([night.pairs, night.within8, night.over20], [9, 6, 1]);
  assert.deepEqual(night.promptCases, {status: 'asked', total: 63, right: 60, flipped: 1, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66});
  assert.equal(await nightFromJobs(JOBS.filter(job => job.id !== 12), logOf), null, 'the exact quality job scores nothing twice: no night, nothing stored');
  assert.equal((await nightFromJobs(JOBS.filter(job => job.id !== 13), logOf)).promptCases, null, 'a run without the replay job still gives the quality night');
  assert.equal((await nightFromJobs(JOBS, async id => (id === 13 ? 'no counts printed' : logs[id]))).promptCases, null);
});

test('the prompt-case counts are read from one log line and dropped, not repaired, when they do not add up', () => {
  assert.equal(promptCasesOf(PROMPT_LINE).right, 60);
  assert.equal(promptCasesOf('PROMPT_CASES_NIGHT {not json'), null);
  const line = {status: 'asked', total: 63, right: 60, flipped: 1, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66};
  assert.ok(cleanPrompt(line));
  for (const bad of [{...line, status: 'maybe'}, {...line, right: 64}, {...line, flipped: 64}, {...line, calls: -1}, {...line, calls: 1.5}, {...line, total: '63'}, null, 'x']) assert.equal(cleanPrompt(bad), null, JSON.stringify(bad));
  assert.equal(cleanNight({...night(5, 9, 9), promptCases: {...line, right: 99}}).promptCases, null, 'a bad replay leaves off the replay, the quality night stays');
  assert.equal(cleanNight(night(5, 9, 9)).promptCases, null);
});

test('a replay sent with its night (the collector before #259) lands in the replay table, and an old damaged row reads as none', async () => {
  const e = {STATS: d1(), SELFHEAL_PUBLISH_KEY: 'pub'};
  const put = body => worker.fetch(new Request('https://www.jobpilotto.top/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify(body)}), e, {});
  const today = new Date().toISOString().slice(0, 10), promptCases = {status: 'asked', total: 63, right: 60, flipped: 1, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66};
  assert.equal((await put({rules: 1, runs: [], fails: [], quality: [{...night(21, 9, 8, 0, today), promptCases}, night(20, 9, 8, 0, today)]})).status, 200);
  e.STATS.db.prepare("INSERT INTO e2e_prompt_cases (run_id, day, json) VALUES (19, ?, '{broken')").run(today);
  await put({rules: 1, runs: [], fails: [], quality: []});
  const snapshot = JSON.parse(e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body);
  assert.deepEqual(snapshot.promptNights, [{runId: 21, day: today, promptCases}], 'the damaged row is left out');
  assert.equal(e.STATS.db.prepare('SELECT prompt_cases FROM e2e_quality WHERE run_id = 21').get().prompt_cases, null, 'the quality row no longer carries it');
});

test('the page shows the newest replay beside the score numbers: green when nothing got worse, red when a prompt did, grey when nothing changed, amber when not asked', () => {
  const prompt = (over = {}) => ({status: 'asked', total: 63, right: 60, flipped: 0, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66, ...over});
  const nights = promptCases => [{...night(51, 90, 85), promptCases}];
  const ok = qualityCard(nights(prompt()));
  assert.match(ok, /Prompt cases \(newest night\)/);
  assert.match(ok, /<b>60\/63<\/b><div><span class="chip good">none got worse<\/span><\/div><span class="muted">2 model noise · 0 new wrong · 0 unconfirmed · 66 calls<\/span>/);
  assert.match(ok, /<th class="num">Prompt cases<\/th>/);
  assert.match(qualityCard(nights(prompt({flipped: 3}))), /<span class="chip bad">3 got worse<\/span>/);
  assert.match(qualityCard(nights(prompt({status: 'carried', calls: 0, noise: 0}))), /nothing asked, 60 of 63 right as last asked/);
  assert.match(qualityCard(nights(prompt({status: 'not-asked'}))), /<span class="chip warn">not asked<\/span>/);
  assert.match(qualityCard(nights(null)), /no night reported yet/, 'a night from before the replay: the tile says there is none, the score tiles stay');
  assert.match(qualityCard([{...night(52, 90, 85), promptCases: null}, {...night(51, 90, 85), promptCases: prompt()}]), /<b>60\/63<\/b>/, 'the tile shows the newest night that has a replay');
});
