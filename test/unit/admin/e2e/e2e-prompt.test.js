// The nightly prompt-case replay is kept for every night, not only a night whose quality job scored twice (jobadabra-web#259: it was stored on the e2e_quality row, so a night without
// that row lost it and the Quality AI card's prompt tile had holes). Guard for admin/e2e-prompt.js, the ingest in admin/e2e-intel.js and the readers (page tile, nightly summary).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {qualityCard} from '../../../../admin/e2e-page.js';
import {cleanPromptNight, promptNightsOf} from '../../../../admin/e2e-prompt.js';
import {nightlySummary} from '../../../../admin/nightly-summary.js';

const MIGRATIONS = new URL('../../../../db/migrations/', import.meta.url);
const migrations = () => readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort();
function d1(skip = () => false) {
  const db = new DatabaseSync(':memory:');
  for (const file of migrations().filter(name => !skip(name))) db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args), _sql: sql, _args: args});
  return {db, prepare: sql => statement(sql), batch: async list => list.map(item => db.prepare(item._sql).run(...item._args))};
}
const D = back => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
const replay = (over = {}) => ({status: 'asked', total: 63, right: 60, flipped: 0, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66, ...over});
const night = (runId, day) => ({runId, day, pairs: 9, within8: 8, over20: 0, factsExact: 63, factsTotal: 63, judged: 18, invented: 1});
const put = (e, body) => worker.fetch(new Request('https://www.jobpilotto.top/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({rules: 1, runs: [], fails: [], ...body})}), e, {});
const snapshotOf = e => JSON.parse(e.STATS.db.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').get().body);

test('a night with a replay and no second quality scoring keeps its replay, in the snapshot and in what the collector is told it has', async () => {
  const e = {STATS: d1(), SELFHEAL_PUBLISH_KEY: 'pub'};
  assert.equal((await put(e, {quality: [night(10, D(1))], promptNights: [{runId: 11, day: D(0), promptCases: replay({right: 61})}, {runId: 10, day: D(1), promptCases: replay()}]})).status, 200);
  const snapshot = snapshotOf(e);
  assert.deepEqual(snapshot.promptNights.map(row => [row.runId, row.day, row.promptCases.right]), [[11, D(0), 61], [10, D(1), 60]], 'night 11 has no quality row and is still there, newest first');
  assert.deepEqual(snapshot.quality.map(row => row.runId), [10], 'the quality table holds only the night that scored twice');
  const told = await (await worker.fetch(new Request('https://www.jobpilotto.top/e2e/data?v=1', {headers: {Authorization: 'Bearer pub'}}), e, {})).json();
  assert.deepEqual([told.quality, told.prompts.sort()], [[10], [10, 11]], 'a replay-only run is told as stored, so it is not read again every hour');
});

test('a replay that does not add up is dropped, a second send of a night keeps the first, and nights sent both ways are one row', async () => {
  const e = {STATS: d1(), SELFHEAL_PUBLISH_KEY: 'pub'};
  await put(e, {promptNights: [{runId: 5, day: D(0), promptCases: replay({right: 99})}, {runId: 0, day: D(0), promptCases: replay()}, {runId: 6, day: 'x', promptCases: replay()}, {runId: 7, day: D(0), promptCases: replay()}]});
  await put(e, {promptNights: [{runId: 7, day: D(0), promptCases: replay({right: 1})}], quality: [{...night(7, D(0)), promptCases: replay()}]});
  assert.deepEqual(snapshotOf(e).promptNights.map(row => [row.runId, row.promptCases.right]), [[7, 60]]);
  assert.equal(cleanPromptNight({runId: 1, day: D(0), promptCases: replay(), extra: 1}).extra, undefined);
});

test('the replays already stored with their quality night move to the new table when the migration runs', () => {
  const e = d1(name => name.startsWith('0131_'));
  e.db.prepare("INSERT INTO e2e_quality (run_id, day, pairs, within8, over20, prompt_cases) VALUES (1, '2026-11-02', 9, 8, 0, ?), (2, '2026-11-03', 9, 8, 0, NULL)").run(JSON.stringify(replay()));
  e.db.exec(readFileSync(new URL('0131_e2e_prompt_cases.sql', MIGRATIONS), 'utf8'));
  assert.deepEqual(e.db.prepare('SELECT run_id, day FROM e2e_prompt_cases').all().map(row => ({...row})), [{run_id: 1, day: '2026-11-02'}]);
});

test('the Quality AI card shows the newest replay even when that night has no quality row, and finds each night\'s replay by its day', () => {
  const promptNights = [{runId: 30, day: D(0), promptCases: replay({right: 61})}, {runId: 20, day: D(1), promptCases: replay({flipped: 2})}];
  const html = qualityCard([night(21, D(1)), night(19, D(2))], undefined, promptNights);
  assert.match(html, /Prompt cases \(newest night\)<\/span><b>61\/63<\/b>/, 'the tile reads the replay-only night');
  assert.match(html, new RegExp(`<td>${D(1)}</td>.*?<span class="chip bad">60/63</span>`), 'the table row of a quality night shows the replay of its day');
  assert.match(html, new RegExp(`<td>${D(2)}</td>.*?<span class="chip off">–</span>`), 'a night with no replay shows a dash');
});

test('the nightly summary draws a replay-only night as a point of the trend', () => {
  const now = new Date(), snapshot = {quality: [], promptNights: [{runId: 3, day: D(0), promptCases: replay()}, {runId: 2, day: D(1), promptCases: replay({flipped: 1})}]};
  const job = nightlySummary({snapshot}, now).jobs.find(item => item.id === 'prompt-cases');
  assert.equal(job.value, '60/63');
  assert.deepEqual(job.series.slice(-2).map(point => point.ok), [false, true], 'yesterday got worse, today did not');
});

test('a snapshot stored before the key existed still reads its replays from the quality rows, newest first', () => {
  assert.deepEqual(promptNightsOf({quality: [{runId: 1, day: D(2), promptCases: replay()}, {runId: 2, day: D(1), promptCases: null}, {runId: 3, day: D(0), promptCases: replay({right: 1})}]}).map(row => row.runId), [3, 1]);
  assert.deepEqual(promptNightsOf({quality: [{runId: 1, day: D(2), promptCases: replay()}], promptNights: []}), [], 'the key, when there, is the one owner');
  assert.deepEqual(promptNightsOf(null), []);
});
