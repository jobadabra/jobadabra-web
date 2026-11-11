// "What a search read" (owner, 11 Nov 2026, asked via AskUserQuestion: "Build as shown (Recommended)" and "Yes, add merge marks (Recommended)"): jobs listed, employer sites read (of the employers in their places) and titles judged,
// the median of the people per run, each panel from 0 with its own scale. Guard for admin/search-finish-read.js, cleanRead and the `read` field of admin/search-night.js clean(), and the card's place in finishSection.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {cleanRead} from '../../../../admin/search-finish.js';
import {finishSection} from '../../../../admin/search-finish-page.js';
import {readCard, readOf, runOf} from '../../../../admin/search-finish-read.js';

const NOW = new Date('2026-11-19T09:00:00Z');
const row = (persona, listed, employers, sites, titles, kind = 'measured') => ({persona, label: `p${persona} Role, Place`, kind, read: cleanRead({listed, employers}), counters: sites == null && titles == null ? null : {sites, titles}});
const run = (night, rows, extra = {}) => ({night, hand: false, eures: 'off', rows, ...extra});
const people = [row(1, 40, 140, 10, 100), row(2, 60, 142, 14, 140), row(3, 100, 141, 20, 300), row(4, 80, 141, 16, 200)];

test('a verdict row keeps `read` as whole counts or null, and no other word: a fraction, a negative or a text is "not sent yet", never 0', () => {
  assert.deepEqual(cleanRead({listed: 46, employers: 141, extra: 'x'}), {listed: 46, employers: 141});
  assert.deepEqual(cleanRead({listed: 46}), {listed: 46, employers: null});
  assert.deepEqual(cleanRead({listed: 1.5, employers: -2}), null, 'neither is a whole count');
  assert.equal(cleanRead({listed: '46'}), null);
  assert.equal(cleanRead(null), null);
  assert.equal(cleanRead([46]), null);
  const stored = clean({state: 'success', head: 'h', rows: [{persona: 1, label: 'p1', kind: 'measured', read: {listed: 0, employers: 141}}, {persona: 2, label: 'p2', kind: 'measured'}]}, {night: '2026-11-18'}, NOW);
  assert.deepEqual(stored.rows[0].read, {listed: 0, employers: 141}, 'a measured 0 stays 0');
  assert.equal(stored.rows[1].read, null);
});

test('readOf takes listed and employers from `read`, sites and titles from the stored counters; a row that sent none is all null', () => {
  assert.deepEqual(readOf({read: {listed: 5, employers: 9}, counters: {sites: 3, titles: 7, eu: 99}}), {listed: 5, employers: 9, sites: 3, titles: 7});
  assert.deepEqual(readOf({}), {listed: null, employers: null, sites: null, titles: null});
  assert.deepEqual(readOf({counters: {sites: 0, titles: null}}), {listed: null, employers: null, sites: 0, titles: null}, 'a measured 0 sites read is 0');
});

test('a run is the median of the people who sent each number (an even count rounds the middle two), with how many sent it and the median employers behind the sites', () => {
  const item = runOf(run('2026-11-18', people));
  assert.deepEqual([item.listed.median, item.listed.n], [70, 4]);
  assert.deepEqual([item.sites.median, item.sites.n, item.sites.of], [15, 4, 141]);
  assert.deepEqual([item.titles.median, item.titles.n], [170, 4]);
  const some = runOf(run('2026-11-18', [...people, row(5, null, null, null, null)]));
  assert.deepEqual([some.listed.median, some.listed.n, some.total], [70, 4, 5], 'a person who sent nothing is out of the median, not a 0 in it');
  assert.deepEqual([runOf(run('2026-11-18', [row(1, null, null, null, null)])).listed.median], [null]);
});

test('the card draws three panels from a zero baseline, each with its own scale, and says "of M" for the sites read', () => {
  const html = readCard([run('2026-11-18', people), run('2026-11-17', people.map(item => ({...item, read: cleanRead({listed: 10, employers: 141})})))]);
  assert.match(html, /id="finish-read"/);
  for (const id of ['read-listed', 'read-sites', 'read-titles']) assert.match(html, new RegExp(`id="${id}"`));
  assert.equal((html.match(/<svg class="rd-svg"/g) || []).length, 3);
  assert.match(html, /class="vz-axis">0<\/text>/, 'a 0 baseline');
  assert.match(html, /<div class="rd-big">70 <small>jobs/);
  assert.match(html, /<div class="rd-big">15 <small>of 141<\/small> <small>sites/);
  assert.match(html, /<div class="rd-big">170 <small>titles/);
  assert.match(html, /median 70 jobs · 4 of 4 people/, 'the tooltip has the exact number');
});

test('a run that sent no number is a dashed stub, never a 0 bar; a by-hand run is hollow; a run with EURES on has a grey jobs-listed bar and an unchanged sites bar', () => {
  const html = readCard([run('2026-11-19', people, {hand: true}), run('2026-11-18', people, {eures: 'on'}), run('2026-11-17', people.map(item => ({...item, read: null, counters: null})))]);
  assert.match(html, /2026-11-17 · jobs listed in their places: not sent yet/);
  assert.match(html, /stroke-dasharray="2 2"/);
  assert.match(html, /2026-11-19 · by hand · median 70 jobs/);
  assert.match(html, /fill="none" stroke="var\(--s3\)" stroke-width="2"/, 'the by-hand run is a hollow bar');
  assert.match(html, /EURES was on: the jobs include its own/);
  assert.match(html, /fill="var\(--off\)"/, 'the EURES-on jobs bar is grey');
  assert.equal((html.match(/EURES was on: the jobs include its own/g) || []).length, 1, 'only the jobs-listed tooltip says so');
});

test('before any run sent a number the card is an empty state with the chip, no chart', () => {
  const html = readCard([run('2026-11-18', [row(1, null, null, null, null)])]);
  assert.match(html, /id="finish-read"/);
  assert.match(html, /not sent yet/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(readCard([]), /not sent yet/);
});

test('a night with merged PRs carries a mark with its PR numbers and titles on every panel, a by-hand run never, and the PR table lists them', () => {
  const prs = [{n: 3709, title: 'Read the employer pages in one pass'}, {n: 3712, title: 'Raise the AI call cap'}];
  const html = readCard([run('2026-11-19', people, {hand: true, prs}), run('2026-11-18', people, {prs}), run('2026-11-17', people, {prs: []})]);
  assert.equal((html.match(/class="vz-mark"/g) || []).length, 3, 'one mark per panel, on the night only');
  assert.match(html, /2 search PRs merged since the night before:\n#3709 Read the employer pages in one pass\n#3712 Raise the AI call cap/);
  assert.match(html, /Search PRs behind the marks/);
  assert.match(html, /pull\/3709/);
  const none = readCard([run('2026-11-18', people)]);
  assert.doesNotMatch(none, /vz-mark/);
  assert.doesNotMatch(none, /mk-swatch">7/, 'no mark, no key line');
});

test('the per-person fold lists the newest run with sites as "n of M" and "not sent yet" for a person who sent none', () => {
  const html = readCard([run('2026-11-18', [...people, row(5, null, null, null, null)])]), table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'));
  assert.match(table, /p1<\/b> Role, Place<\/td><td class="num">40<\/td><td class="num">10 <span class="muted">of 140<\/span><\/td><td class="num">100<\/td>/);
  assert.match(table, /p5<\/b> Role, Place<\/td><td class="num"><span class="chip off">not sent yet<\/span><\/td>/);
});

test('the Finish tab shows the card after the sources-night-by-night card', () => {
  const html = finishSection([clean({state: 'success', head: 'h', rows: people.map(item => ({...item, read: {listed: 5, employers: 9}, counters: {sites: 1, titles: 2}}))}, {night: '2026-11-18'}, NOW)], [], {}, null);
  assert.ok(html.indexOf('id="finish-nights"') < html.indexOf('id="finish-read"') && html.indexOf('id="finish-read"') < html.indexOf('id="finish-week"'));
});
