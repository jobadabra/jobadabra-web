// The time-bomb card on /admin/testing/integrations (a8, 2 Nov 2026): the nightly clock-moved reports' numbers validated, drawn, and read once per run by the hourly collector.
// Report only: an area with no report that night is "not measured", never 0.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {cleanClockMoved, KEEP_HISTORY} from '../../admin/clock-moved-intel.js';
import {bombTrend, clockMovedCard} from '../../admin/clock-moved-card.js';
import {cleanSnapshot} from '../../admin/integration-intel.js';
import {page} from '../../admin/integration-page.js';
import {clockMovedFor, mergeClockMoved, newestRun, readReports} from '../../tools/ci-intel/jobs/clock-moved-intel.mjs';

const now = new Date('2026-11-02T12:00:00Z');
// The shape of tools/clock-moved.mjs's report.json (public repo): {judged, redToday, bombs: [{area, file, days, why}], unstable, seconds}.
const bomb = (area, file, days = 7) => ({area, file, days, why: 'AssertionError: stale'});
const reports = () => ({desktop: {judged: 400, redToday: 1, bombs: [], unstable: [], seconds: 300},
  e2e: {judged: 90, redToday: 0, bombs: [bomb('e2e', 'desktop/e2e/test/a.test.mjs', 1), bomb('e2e', 'desktop/e2e/test/b.test.mjs')], unstable: [], seconds: 200}, python: null});
const sample = (day = '2026-11-02') => mergeClockMoved(null, reports(), {runId: 7, sha: 'abcdef1234567', day});

test('the numbers are the sums over the measured areas, an area with no report is "not measured", never 0', () => {
  const clean = cleanClockMoved({runId: 7, sha: 'abcdef1234567', at: '2026-11-02', areas: reports(), evil: '<script>'});
  assert.deepEqual([clean.bombs, clean.redToday], [2, 1]);
  assert.equal(clean.areas.python, null);
  assert.equal(clean.evil, undefined);
  assert.equal(cleanClockMoved({at: '2026-11-02', areas: {desktop: null, e2e: null, python: null}}), null, 'no area measured: no part');
  assert.equal(cleanClockMoved({at: 'last night', areas: reports()}), null);
  assert.equal(cleanClockMoved({at: '2026-11-02', areas: {desktop: {bombs: 'x'}}}), null, 'a report without a bombs list is not measured');
});

test('cleaning its own output gives it back unchanged, and a long bomb list is cut to the rows kept', () => {
  const many = {...reports(), e2e: {judged: 9, redToday: 0, bombs: Array.from({length: 80}, (_, n) => bomb('e2e', `desktop/e2e/test/${n}.test.mjs`))}};
  const clean = cleanClockMoved({at: '2026-11-02', areas: many});
  assert.equal(clean.areas.e2e.bombs.length, 50, 'the rows are cut');
  assert.equal(clean.areas.e2e.bombCount, 80, 'the count is of the whole list (Gitar on #269)');
  assert.equal(clean.bombs, 80);
  assert.deepEqual(cleanClockMoved(clean), clean);
  assert.deepEqual(cleanClockMoved(sample()), sample());
});

test('the card: the two numbers, a chip per area, the bombs in a list, "none found" when there are none', () => {
  const html = clockMovedCard(sample());
  assert.match(html, /Time bombs/);
  assert.match(html, /<b>2<\/b>/);
  assert.match(html, /Red on today's clock/);
  assert.match(html, /python not measured/);
  assert.match(html, /desktop 0/);
  assert.match(html, /desktop\/e2e\/test\/a\.test\.mjs/);
  assert.match(clockMovedCard(null), /No clock-moved report read yet/);
  const none = clockMovedCard(mergeClockMoved(null, {desktop: reports().desktop, e2e: {...reports().e2e, bombs: []}, python: null}, {runId: 8, sha: '', day: '2026-11-02'}));
  assert.match(none, /none found/);
  assert.doesNotMatch(none, /<details/);
  assert.doesNotMatch(clockMovedCard({...sample(), sha: '<img>'}), /<img>/, 'texts are escaped');
});

test('the trend compares with the last earlier night only', () => {
  const second = mergeClockMoved(sample('2026-11-01'), reports(), {runId: 9, sha: '', day: '2026-11-02'});
  assert.equal(bombTrend(second), 'same as 1 Nov');
  const more = mergeClockMoved(second, {...reports(), python: {judged: 5, redToday: 0, bombs: [bomb('python', 'tests/test_x.py')]}}, {runId: 10, sha: '', day: '2026-11-03'});
  assert.equal(bombTrend(more), '+1 vs 2 Nov');
  assert.equal(bombTrend(sample()), '', 'a first night has no trend');
  assert.equal(second.history.length, 2);
  assert.equal(mergeClockMoved(null, {desktop: null, e2e: null, python: null}, {runId: 1, sha: '', day: '2026-11-02'}), null);
});

const json = (answer, calls) => async (...args) => { calls.push(args); return /actions\/runs\//.test(args.join(' ')) ? {status: 'completed'} : answer(args.join(' ')); };
const artifact = (id, extra = {}) => ({id: id * 10, expired: false, created_at: '2026-11-02T03:41:00Z', workflow_run: {id, head_sha: 'f'.repeat(40)}, ...extra});

test('the collector reads the newest run once, keeps one total per night, and keeps what it has when none can be read', async () => {
  const calls = [], reads = [];
  const read = async (repo, runId) => { reads.push(runId); return reports(); };
  const at = id => json(args => (/name=clock-moved-python/.test(args) ? null : artifact(id)), calls);
  const first = await clockMovedFor(null, {repo: 'o/r', json: at(100), read});
  assert.deepEqual([first.runId, first.at, first.history.length, first.bombs, first.redToday], [100, '2026-11-02', 1, 2, 1]);
  assert.deepEqual(calls.filter(call => /artifacts\?name=/.test(call.join(' '))).map(call => /name=(clock-moved-\w+)/.exec(call.join(' '))[1]).sort(), ['clock-moved-desktop', 'clock-moved-e2e', 'clock-moved-python']);
  assert.equal(await clockMovedFor(first, {repo: 'o/r', json: at(100), read}), first, 'a run already read is not read again');
  assert.equal(reads.length, 1);
  const second = await clockMovedFor(first, {repo: 'o/r', json: json(() => artifact(101, {created_at: '2026-11-03T03:40:00Z'}), []), read});
  assert.deepEqual(second.history.map(row => row.day), ['2026-11-02', '2026-11-03']);
  assert.equal((await clockMovedFor(first, {repo: 'o/r', json: json(() => null, []), read})).runId, 100, 'no artifact: the stored one stays');
  // Gitar on #269: the artifacts of a run still uploading are listed already; it is read once it has completed, not before.
  const running = async (...args) => (/actions\/runs\//.test(args.join(' ')) ? {status: 'in_progress'} : artifact(104));
  const readsBefore = reads.length;
  assert.equal(await clockMovedFor(first, {repo: 'o/r', json: running, read}), first, 'a run still in progress is left for the next hour');
  assert.equal(reads.length, readsBefore, 'and was not read');
  assert.equal(await newestRun('o/r', json(() => artifact(5, {expired: true}), [])), null, 'an expired artifact is not read');
  const log = [], realLog = console.log;
  console.log = line => log.push(line);
  try {
    assert.equal((await clockMovedFor(first, {repo: 'o/r', json: at(102), read: async () => { throw new Error('gh: rate limit'); }})).runId, 100, 'an unreadable run keeps the stored part');
    assert.equal(await clockMovedFor(first, {repo: 'o/r', json: at(103), read: async () => ({desktop: null, e2e: null, python: null})}), first, 'a run with no readable area keeps the stored part');
  } finally { console.log = realLog; }
  assert.match(log.join('\n'), /::warning::the clock-moved reports were not read this hour: gh: rate limit/, 'and says so');
  assert.match(log.join('\n'), /run 103 have a shape the site does not accept/);
});

test('readReports gives null for an area folder the run lacks, and the snapshot and the page carry the part', async () => {
  const got = await readReports('o/r', 5, async (repo, id, dir) => { mkdirSync(path.join(dir, 'clock-moved-e2e')); writeFileSync(path.join(dir, 'clock-moved-e2e', 'report.json'), JSON.stringify(reports().e2e)); });
  assert.deepEqual([got.desktop, got.python, got.e2e.judged], [null, null, 90]);
  const snapshot = cleanSnapshot({runs: [], clockMoved: sample()}, now);
  assert.equal(snapshot.clockMoved.bombs, 2);
  assert.equal(cleanSnapshot({runs: []}, now).clockMoved, null);
  assert.match(page(snapshot, {now}), /Time bombs · tests that fail when the clock moves/);
  assert.match(page(cleanSnapshot({runs: []}, now), {now}), /No clock-moved report read yet/);
  assert.equal(KEEP_HISTORY, 30);
});
