// The per-source chart (owner, 11 Nov 2026, asked via AskUserQuestion: "Build as drawn (Recommended)", after job boards gave 0 jobs for two weeks unseen) and the ONE rule behind its LOST chip, its "dropped to 0" mark
// and the morning line (admin/search-source-zero.js). Guard for admin/search-source-trend.js, search-source-zero.js and the card's place on the tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {finishSection} from '../../../../admin/search-finish-page.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {MIN_READ, WATCHED, nightOf, statusOf, zeroNow} from '../../../../admin/search-source-zero.js';
import {daysOf, sourceTrendCard} from '../../../../admin/search-source-trend.js';

const NOW = new Date('2026-12-31T09:00:00Z');
const STEPS = ['employer_sites', 'job_boards', 'free_job_apis'].map(step => ({step, seconds: 5, jobs: 1, local: 1, scored: 1, fit70: 0, local_fit70: 0}));
// One 18-person night: `right` per source for every person (a number, or null = the person sent no count for it), `blind` people are not measured.
const make = (day, right = {}, {blind = 0, eures = 'off', steps = true, people = 18, extra = {}} = {}) => clean({state: 'success', head: 'measured', eures, ...extra, rows: Array.from({length: people}, (_, i) => ({
  persona: i + 1, label: `p${i + 1} Role, Place`, kind: i < blind ? 'unmeasured' : 'measured', local: 2, found: 9, seconds: 100, step_yield: steps ? STEPS : undefined,
  sources: Object.fromEntries(Object.entries(right).filter(([, value]) => value !== undefined).map(([source, value]) => [source, {right: value}]))}))}, {night: day}, NOW);
const OK = {employer_sites: 1, job_boards: 1, free_job_apis: 1, web_search: 1};
const day = n => new Date(Date.parse('2026-10-27') + n * 86400000).toISOString().slice(0, 10);

test('the rule: a night is switched on for a source only when at least 6 measured people sent a count for it; EURES counts only on nights with EURES on', () => {
  assert.equal(MIN_READ, 6, 'the twin of tools/persona-search/lost.py MIN_READ');
  assert.deepEqual(nightOf(make('2026-11-12', OK), 'job_boards'), {state: 'some', readers: 18, right: 18});
  assert.deepEqual(nightOf(make('2026-11-12', {job_boards: 0}), 'job_boards'), {state: 'zero', readers: 18, right: 0});
  assert.equal(nightOf(make('2026-11-12', {employer_sites: 1}), 'job_boards').state, 'off', 'no row for the source = not read, neither fires nor counts');
  assert.equal(nightOf(make('2026-11-12', {job_boards: 0}, {blind: 13}), 'job_boards').state, 'off', '5 measured people are no evidence');
  assert.equal(nightOf(make('2026-11-12', {job_boards: 0}, {blind: 12}), 'job_boards').state, 'zero', '6 measured people are');
  assert.equal(nightOf(make('2026-11-12', {eures: 0}), 'eures').state, 'off', 'EURES off never fires or counts');
  assert.equal(nightOf(make('2026-11-12', {eures: 0}, {eures: 'on'}), 'eures').state, 'zero');
  assert.equal(nightOf(make('2026-11-12', {job_boards: 0}, {extra: {state: 'not-run'}}), 'job_boards').state, 'off', 'a night that did not run says nothing');
  assert.equal(nightOf(make('2026-11-12', {linkedin: 0}), 'linkedin').state, 'off', 'LinkedIn is never read');
  assert.ok(!WATCHED.includes('linkedin'));
});

test('a count not sent is not a reader: an odd count beside good ones never reads as 0', () => {
  const stored = make('2026-11-12', {job_boards: 0});
  stored.rows.slice(0, 13).forEach(row => { row.sources.job_boards.right = null; });
  assert.deepEqual(nightOf(stored, 'job_boards'), {state: 'off', readers: 0, right: null}, '5 people with a count: not enough, and the 13 without are not 0s');
});

test('the run: nights in a row at 0 from the newest switched-on night; a blind night or a night without the row neither fires nor breaks it; a night with right jobs ends it', () => {
  const nights = [make(day(5), {job_boards: 0, employer_sites: 4}), make(day(4), {employer_sites: 4}), make(day(3), {job_boards: 0}, {blind: 14}), make(day(2), {job_boards: 0}), make(day(1), {job_boards: 3}), make(day(0), {job_boards: 0})];
  const boards = statusOf(nights, 'job_boards');
  assert.deepEqual([boards.state, boards.run, boards.since, boards.dropped], ['lost', 2, day(2), true], 'night 5 and night 2 are at 0; 4 (no row) and 3 (blind) are skipped; night 1 had 3');
  assert.equal(statusOf(nights, 'employer_sites').state, 'reading');
  assert.deepEqual(statusOf(nights, 'web_search'), {state: 'unseen', run: 0, since: null, dropped: false, latest: null});
  assert.equal(statusOf([make(day(0), {job_boards: 0})], 'job_boards').dropped, false, 'a source that never had a right job did not drop');
});

test('a source last counted weeks ago is stale, not lost: no LOST chip, no run that never advances (Gitar on #559)', () => {
  const nights = [make(day(30), {employer_sites: 4}), make(day(29), {employer_sites: 4}), make(day(10), {job_boards: 0}), make(day(9), {job_boards: 0})];
  assert.deepEqual([statusOf(nights, 'job_boards').state, statusOf(nights, 'job_boards').latest.night], ['stale', day(10)]);
  assert.equal(statusOf(nights, 'employer_sites').state, 'reading');
  const html = sourceTrendCard(nights), boards = html.slice(html.indexOf('id="source-job_boards"'), html.indexOf('id="source-free_job_apis"'));
  assert.match(boards, /class="chip off">not sent since /);
  assert.doesNotMatch(boards, /LOST|dropped to 0/);
  assert.deepEqual(zeroNow(nights, day(30)), [], 'and the morning line only reads the newest night');
});

test('the morning line reads the same rule: only the newest night, one entry per source at 0, also when the night is otherwise fine; EURES off and LinkedIn never', () => {
  const nights = [make(day(3), {...OK, job_boards: 0, eures: 0}), make(day(2), {...OK, job_boards: 0}), make(day(1), OK)];
  assert.deepEqual(zeroNow(nights, day(3)), [{source: 'job_boards', run: 2, readers: 18, total: 18}], 'job boards at 0 for the 2nd night; EURES is off; the rest bring jobs');
  assert.deepEqual(zeroNow(nights, day(2)), [], 'an older night filled in late is never news');
  assert.deepEqual(zeroNow([make(day(0), OK)], day(0)), [], 'nothing at 0: nothing to say');
  assert.deepEqual(zeroNow([], day(0)), []);
});

test('the owner\'s case, 27 Oct to 11 Nov: job boards at 0 for 14 of 16 nights says so on each of them, counting up; employer sites never; not-read nights keep the count', () => {
  const nights = Array.from({length: 16}, (_, i) => make(day(i), {...OK, job_boards: i < 2 ? 5 : 0, ...(i === 8 ? {job_boards: undefined} : {})}, i === 11 ? {blind: 15} : {})).reverse();
  const told = [];
  for (let i = nights.length - 1; i >= 0; i--) {
    const line = zeroNow(nights.slice(i), nights[i].night);
    assert.ok(!line.some(item => item.source === 'employer_sites'), 'employer sites bring jobs every night');
    if (line.length) told.push(line[0].run);
  }
  assert.deepEqual(told, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '14 nights at 0, 2 of them (not read, blind) say nothing and do not break the count');
});

test('the chart and the message cannot disagree: for every prefix of the 16 nights the LOST chip is there exactly when zeroNow names job boards', () => {
  const all = Array.from({length: 16}, (_, i) => make(day(i), {...OK, job_boards: i < 2 || i === 9 ? 5 : 0}, i === 5 ? {blind: 15} : {})).reverse();
  for (let i = all.length - 1; i >= 0; i--) {
    const nights = all.slice(i), card = sourceTrendCard(nights), panel = card.slice(card.indexOf('id="source-job_boards"'), card.indexOf('id="source-free_job_apis"'));
    const status = statusOf(nights, 'job_boards'), fires = zeroNow(nights, nights[0].night).some(item => item.source === 'job_boards');
    assert.equal(/✖ LOST/.test(panel), status.state === 'lost', nights[0].night);
    assert.equal(fires, nightOf(nights[0], 'job_boards').state === 'zero', 'the line is about the newest night being at 0');
    assert.equal(/dropped to 0/.test(panel), status.state === 'lost' && status.dropped && daysOf(nights, 'job_boards').some(item => item.day === status.since), 'the mark is the rule\'s drop');
  }
});

test('a panel: LOST chip with the run, a red 0 per night, the drop mark, a dashed gap for a night not stored, the read strip from step_yield, bars from 0', () => {
  const nights = [make(day(7), {...OK, job_boards: 0}), make(day(6), {...OK, job_boards: 0}), make(day(5), {...OK, job_boards: 0}), make(day(3), OK), make(day(2), OK)];   // day 4 was not stored
  const html = sourceTrendCard(nights), boards = html.slice(html.indexOf('id="source-job_boards"'), html.indexOf('id="source-free_job_apis"'));
  assert.match(boards, /class="chip bad">✖ LOST · 0 right jobs since 2026-11-01 · night 3 in a row</);
  assert.match(boards, /▼ dropped to 0/);
  assert.equal((boards.match(/class="st-bad">0<\/text>/g) || []).length, 3, 'a red 0 on each night at 0');
  assert.match(boards, /data-tip="2026-10-31 · no night stored"/);
  assert.match(boards, /read by 18 of 18/, 'the strip reads step_yield');
  assert.match(boards, /people who read it \(of 18\)/);
  const employer = html.slice(html.indexOf('id="source-employer_sites"'), html.indexOf('id="source-job_boards"'));
  assert.match(employer, /class="chip good">✔ reading/);
  assert.doesNotMatch(employer, /dropped to 0|LOST/);
  assert.match(html, /<table>.*2026-11-02/s, 'the table is behind "Show table"');
});

test('what is not sent says so: web search and EURES "not sent yet" / side check, the read strip only for the three finder steps, never a flat 0', () => {
  const html = sourceTrendCard([make(day(0), {employer_sites: 4, job_boards: 2, free_job_apis: 1})]);
  assert.match(html.slice(html.indexOf('id="source-web_search"'), html.indexOf('id="source-eures"')), /right jobs: not sent yet[\s\S]*people who read it: not sent yet/);
  assert.match(html.slice(html.indexOf('id="source-eures"')), /SIDE CHECK · not read on nights with EURES off/);
  assert.match(html.slice(html.indexOf('id="source-free_job_apis"'), html.indexOf('id="source-web_search"')), /✔ reading[\s\S]*<b>18<\/b> right jobs from <b>18<\/b> people/, 'a sent count is drawn as one');
  const noSteps = sourceTrendCard([make(day(0), OK, {steps: false})]);
  assert.doesNotMatch(noSteps, /read by \d+ of/, 'no step_yield: no read count, never 0 read');
});

test('nothing sent at all: the empty state says "not sent yet" and draws no chart or zero; the tab carries the card in place of the stacked chart', () => {
  const empty = sourceTrendCard([make(day(0), {}, {steps: false})]);
  assert.match(empty, /id="finish-nights"[\s\S]*not sent yet/);
  assert.doesNotMatch(empty, /<svg|>0</);
  assert.equal(sourceTrendCard([]).includes('<svg'), false);
  const tab = finishSection(judgeAll([make(day(1), {...OK, job_boards: 0}), make(day(0), OK)]), []);
  assert.match(tab, /id="finish-nights"[\s\S]*Each source, night after night/);
  assert.doesNotMatch(tab, /Right jobs per night, by source group/);
});

test('a by-hand run is not a night here, and a person the night could not measure is not a reader', () => {
  const nights = [{...make(day(1), {job_boards: 0}), hand: true}, make(day(0), OK)];
  assert.equal(statusOf(nights.filter(item => !item.hand), 'job_boards').state, 'reading');
  assert.match(sourceTrendCard(nights).slice(sourceTrendCard(nights).indexOf('id="source-job_boards"')), /✔ reading/);
});
