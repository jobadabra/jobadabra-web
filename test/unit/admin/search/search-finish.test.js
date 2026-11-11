// The Finish line (owner, 10 Nov 2026, picture approved via AskUserQuestion): the row fields kept in fixed words, in = out per person, the weakest rows, the sources table, the tab, and a stored night that carries them.
// Guard for admin/search-finish.js, search-finish-page.js, viz-stack.js and the inout/sources fields of admin/search-night.js clean().
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {OWN, SOURCES, STAGES, cleanInout, cleanSources, lostTotals, ownOf, peopleOf, sideOf, sourcesOf, tally, weakest} from '../../../../admin/search-finish.js';
import {finishSection} from '../../../../admin/search-finish-page.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {page} from '../../../../admin/search-lab-page.js';
import {stacked} from '../../../../admin/viz-stack.js';

const NOW = new Date('2026-11-19T09:00:00Z');
const io = (inn, out, lost = {}) => ({eures: {in: inn, out, lost}});
const row = (persona, extra = {}) => ({persona, label: `p${persona} Role, Place`, kind: 'measured', why: '', local: 3, found: 9, seconds: 100, ...extra});
const night = (day, rows, extra = {}) => clean({state: 'success', head: 'measured', rows, ...extra}, {night: day}, NOW);

test('the v2 word lists are the plan\'s; an unknown word, a non-whole count or a missing in/out is dropped, never zeroed', () => {
  assert.deepEqual(SOURCES, ['eures', 'employer_sites', 'job_boards', 'free_job_apis', 'web_search', 'linkedin', 'public_board']);
  assert.deepEqual(STAGES, ['not_read', 'never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'listed']);
  assert.deepEqual(cleanInout({eures: {in: 19, out: 14, lost: {never_asked: 5, bogus: 3, ai_no: 1.5, listed: 4}}, adzuna: {in: 1, out: 1, lost: {}}, job_boards: {in: 3}}), {eures: {in: 19, out: 14, lost: {never_asked: 5}}}, 'bogus stage, a fraction, `listed` (it is out) and an unknown source are dropped; a source without out is dropped');
  assert.equal(cleanInout({}), null);
  assert.equal(cleanInout('x'), null);
  assert.deepEqual(cleanSources({eures: {right: 12, seconds: 40}, web_search: {}}), {eures: {right: 12, only: null, fit70: null, seconds: 40}, web_search: {right: null, only: null, fit70: null, seconds: null}}, 'a field not sent is null: "not sent yet", never 0');
  assert.equal(cleanSources({nope: {right: 1}}), null);
});

test('a stored night keeps inout and sources per person; a row without them keeps null', () => {
  const stored = night('2026-11-18', [row(1, {inout: io(19, 14, {never_asked: 5}), sources: {eures: {right: 6, seconds: 30}}}), row(2)]);
  assert.deepEqual(stored.rows[0].inout, io(19, 14, {never_asked: 5}));
  assert.equal(stored.rows[0].sources.eures.right, 6);
  assert.equal(stored.rows[1].inout, null);
  assert.equal(stored.rows[1].sources, null);
});

test('in = out per person: at the line from 95% of in; a blind person is neither; no reference is neither at nor below', () => {
  const stored = night('2026-11-18', [row(1, {inout: io(20, 19)}), row(2, {inout: io(20, 18, {never_asked: 2})}), row(3, {kind: 'unmeasured', inout: io(5, 0)}), row(4, {inout: io(0, 0)}), row(5), row(6, {inout: io(6, 0, {not_read: 6})})]);
  assert.deepEqual(peopleOf(stored).map(person => person.atLine), [true, false, false, false, false, false]);
  assert.deepEqual(tally(stored), {night: '2026-11-18', atLine: 1, some: 1, none: 1, blind: 1, noReference: 2, total: 6, hasInout: true});
});

test('weakest: the worst person x source x stage rows of the newest night that sent inout, by right jobs lost, with the earlier values', () => {
  const nights = [night('2026-11-18', [row(13, {inout: io(43, 23, {after_kept: 20})}), row(1, {inout: io(19, 14, {never_asked: 5})}), row(2, {inout: io(5, 5)})]),
    night('2026-11-17', [row(13, {inout: io(43, 25, {after_kept: 18})}), row(1), row(2)]), night('2026-11-16', [row(1)])];
  const {night: at, rows} = weakest(nights);
  assert.equal(at, '2026-11-18');
  assert.deepEqual(rows.map(item => [item.persona, item.stage, item.lost, item.history]), [[13, 'after_kept', 20, [18]], [1, 'never_asked', 5, [null]]], 'nothing lost = no row; a night that did not send inout is not a run');
  assert.deepEqual(weakest([night('2026-11-18', [row(1)])]), {night: null, rows: []});
  const zero = weakest([night('2026-11-18', [row(1, {inout: io(19, 14, {never_asked: 5})})]), night('2026-11-17', [row(1, {inout: io(19, 19)})])]);
  assert.deepEqual(zero.rows[0].history, [0], 'a night that sent in = out with nothing lost at the stage is 0, not unknown');
});

test('sources: right jobs, share, "only it" stays null until sent, people served, the average over the runs that sent it', () => {
  const mk = (day, eures, boards) => night(day, [row(1, {sources: {eures: {right: eures, seconds: 40}, job_boards: {right: boards, seconds: 60}}}), row(2, {sources: {eures: {right: 0, seconds: 50}}})]);
  const {rows} = sourcesOf([mk('2026-11-18', 6, 2), mk('2026-11-17', 4, 0)]);
  const eures = rows.find(item => item.source === 'eures');
  assert.deepEqual([eures.right, eures.share, eures.only, eures.people, eures.average, eures.runs], [6, null, null, 1, 5, 2], 'EURES is a side check: never a share of our result');
  assert.equal(Math.round(rows.find(item => item.source === 'job_boards').share * 100), 100, 'the share is over our own sources only');
  assert.deepEqual(rows.map(item => item.source), ['eures', 'job_boards'], 'biggest first; a source appears by itself');
  assert.equal(sourcesOf([night('2026-11-18', [row(1)])]).rows.length, 0);
});

test('the tab: band, weakest, chart, per-person bars, sources; empty says so; by-hand runs are hollow; another candidate set is left out', () => {
  const six = night('2026-11-10', [row(1)].concat(Array.from({length: 5}, (_, i) => row(i + 2))));
  const full = n => night('2026-11-1' + n, Array.from({length: 18}, (_, i) => row(i + 1, {inout: i < 12 ? io(10, i < 8 ? 10 : 6, i < 8 ? {} : {after_kept: 4}) : null, sources: {eures: {right: 3, seconds: 40}, job_boards: {right: 2, seconds: 60}}})));
  const html = finishSection(judgeAll([full(8), full(7), six]), [{day: '2026-11-18', at: '2026-11-18T14:20:00.000Z', engine: 'unknown', eures: 'on', rows: full(9).rows}]);
  for (const id of ['finish-band', 'finish-weakest', 'finish-side', 'finish-over', 'finish-inout', 'finish-lost', 'finish-sources', 'finish-reached']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /36 <small>right jobs<\/small>[\s\S]*for <b>18 of 18<\/b> people/, 'the headline counts our own sources: 18 people x 2 right jobs, EURES is not in it');
  assert.match(html, /EURES on: not in this number/);
  assert.match(html, /SIDE CHECK<\/span> with EURES on, our list keeps <b>104 of 120<\/b>/, 'EURES in = out is the small side check');
  assert.match(html, /unexplained/, 'after_kept has its own words');
  assert.match(html, /nobody on it/, 'no Moves: line is read yet');
  assert.match(html, /stroke-dasharray="3 2"/, 'the by-hand run is hollow');
  assert.match(html, /not sent yet/);
  assert.equal((html.match(/id="finish-inout"/g) || []).length, 1);
  assert.doesNotMatch(html, />2026-11-10</, 'the six-candidate night is another series and is not a run here');
  assert.match(finishSection(judgeAll([night('2026-11-18', [row(1)])]), []), /no run has sent in = out yet/);
  assert.match(finishSection(null), /could not be read/);
  assert.match(page([], 'finish', [], null, [], judgeAll([full(8)]), {}, []), /Finish line/);
});

test('the stacked chart: a column per run, states add up under the top, a dashed finish line, a hollow by-hand column, no run = no chart', () => {
  const svg = stacked([{day: '2026-11-17', values: [3, 5, 2, 1], tip: 'a'}, {day: '2026-11-18', hand: true, values: [4, 4, 2, 0], tip: 'b'}], [{name: 'At', tone: 's3'}, {name: 'Some', tone: 's1'}, {name: 'None', tone: 's2'}, {name: 'Blind', tone: 'off'}], {top: 18});
  assert.equal((svg.match(/<rect[^>]*fill="var\(--s3\)"/g) || []).length, 1, 'one solid at-the-line column');
  assert.match(svg, /stroke-dasharray="3 2"/);
  assert.match(svg, /stroke-dasharray="5 4"/);
  assert.equal(stacked([], [], {top: 18}), '');
});

// The headline on our own sources (owner, 11 Nov 2026): EURES is never in it, a person who sent no own-source number is not counted (never 0), a blind person is counted apart.
test('ownOf: right jobs and people from our own sources only; unsent is not 0; blind apart; EURES and LinkedIn are out', () => {
  assert.deepEqual(OWN, ['employer_sites', 'job_boards', 'free_job_apis', 'web_search']);
  const run = {rows: [row(1, {sources: {eures: {right: 9}, employer_sites: {right: 3}, job_boards: {right: 2}, linkedin: {right: 7}}}), row(2, {sources: {job_boards: {right: 0}}}), row(3, {sources: {eures: {right: 5}}}), row(4), row(5, {kind: 'unmeasured', sources: {job_boards: {right: 4}}})]};
  assert.deepEqual(ownOf(run), {right: 5, people: 1, sent: 2, blind: 1, total: 5}, 'p3 sent only EURES and p4 nothing: not counted; p5 is blind');
  assert.equal(ownOf({rows: [row(1, {sources: {eures: {right: 9}}})]}), null, 'EURES alone is no headline');
  assert.match(finishSection(judgeAll([night('2026-11-18', [row(1, {sources: {eures: {right: 9}}})])]), []), /no run has sent per-source counts yet/);
});

test('the side check: in = out summed over the people with a reference, and where the missing jobs were lost, all people together', () => {
  const run = night('2026-11-18', [row(1, {inout: io(19, 14, {never_asked: 5})}), row(2, {inout: io(10, 6, {after_kept: 3, ai_no: 1})}), row(3, {inout: io(0, 0)}), row(4, {kind: 'unmeasured', inout: io(8, 0, {not_read: 8})})]);
  assert.deepEqual(sideOf(run), {in: 29, out: 20, atLine: 0, referenced: 2}, 'no reference (in 0) and a blind person are out of both sums');
  assert.deepEqual(lostTotals(run), {in: 29, out: 20, lost: {never_asked: 5, after_kept: 3, ai_no: 1}});
  assert.equal(lostTotals(night('2026-11-18', [row(1)])), null);
  const html = finishSection(judgeAll([run]), []);
  assert.match(html, /id="finish-lost"[\s\S]*never_asked[\s\S]*<b>5<\/b> of 29/);
});

test('the Sources table and the Market card default to the EURES-off nights; EURES carries the SIDE CHECK chip', () => {
  const src = {eures: {right: 8, seconds: 40}, job_boards: {right: 3, seconds: 50}};
  const off = night('2026-11-17', [row(1, {sources: src})], {eures: 'off'}), on = night('2026-11-18', [row(1, {sources: {...src, job_boards: {right: 9}}})]);
  assert.equal(sourcesOf([on, off]).night, '2026-11-17', 'the older EURES-off night is the default over the newer EURES-on one');
  assert.equal(sourcesOf([on]).night, '2026-11-18', 'with no EURES-off night the newest one is used');
  assert.match(finishSection(judgeAll([off]), []), /<b>EURES<\/b> <span class="chip warn">SIDE CHECK<\/span>/);
});
