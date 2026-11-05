// /admin/testing/report-only (owner, 1-2 Nov 2026): every report-only job on its own Testing page, grouped, each with its 14-night trend; the proof cards keep only proof and a one-line link.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {PAGES} from '../../../../admin/admin.js';
import {lastDays, nightlySummary} from '../../../../admin/nightly-summary.js';
import {finderJobs} from '../../../../admin/report-only-finders.js';
import {GROUPS, OPEN_ON_LINK, model, page} from '../../../../admin/report-only.js';
import {qualityModel} from '../../../../admin/product-quality-areas.js';
import {page as overviewPage} from '../../../../admin/testing-overview.js';
import {resolve} from '../../../../admin/testing-overview-data.js';
import {reportLine} from '../../../../admin/nightly-summary-html.js';

const now = new Date('2026-11-02T10:00:00Z');
const D = back => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10);
const days = lastDays(now);
const snap = (back, extra = {}) => ({day: D(back), periods: {last7: {byDetector: [{detector: 'Layout and DOM checks', fixed: 2, queued: 1}, {detector: 'AI screenshot review', fixed: 0, queued: 0}]}}, recall: {planted: 13, caught: 11, missed: ['page-overflow']}, quality: {mutation: {rate: 100, note: '12 of 12 planted code bugs caught'}}, ...extra});
const nights = {quality: [{runId: 1, day: D(0), pairs: 90, within8: 60, over20: 0, factsExact: 63, factsTotal: 63, judged: 18, invented: 1, promptCases: null}], suiteNights: [{runId: 2, day: D(0), kind: 'nightly', suite: 'wander', platform: 'mac', green: true}],
  days: [{day: D(0), kind: 'beta', runs: 1, wallMin: 30}]};
const job = (built, id) => built.jobs.find(item => item.id === id);

test('every report-only job sits in exactly one group: a measurement nobody listed is a failing test, not a missing card', () => {
  const built = model(nightlySummary({snapshot: nights}, now), [snap(0)], now);
  assert.deepEqual(built.unlisted, [], 'a job in no group');
  const ids = GROUPS.flatMap(group => group.jobs);
  assert.equal(new Set(ids).size, ids.length, 'a job in two groups');
  assert.deepEqual(built.groups.map(group => group.jobs.length), GROUPS.map(group => group.jobs.length), 'every listed id resolves to a job');
  assert.deepEqual(built.groups.map(group => group.id), ['ai', 'speed', 'explorers', 'finders', 'planted', 'real', 'agents']);
});

test('finders: real bugs filed in the 7 days up to each stored day (fixed + queued); a day with no snapshot is grey, never 0', () => {
  const jobs = finderJobs([snap(0), snap(2, {periods: {last7: {byDetector: [{detector: 'Layout and DOM checks', fixed: 1, queued: 0}]}}})], days);
  const layout = jobs.find(item => item.id === 'finder-layout');
  assert.deepEqual(layout.series.filter(point => point.value != null).map(point => [point.day, point.value]), [[D(2), 1], [D(0), 3]]);
  assert.deepEqual([layout.value, layout.series.length, layout.series[days.indexOf(D(1))].value], ['3', 14, null]);
  assert.equal(jobs.find(item => item.id === 'finder-review').value, '0', 'a finder that filed nothing says 0 on a day it was stored');
  const none = finderJobs([], days);
  for (const item of none) assert.deepEqual([item.value, item.status, item.series.length], ['–', 'none', 0], item.id);
  assert.match(none[0].sub, /no self-healing snapshot/);
  assert.deepEqual(finderJobs([snap(20)], days).map(item => item.value), ['–', '–', '–', '–', '–'], 'a snapshot older than the 14 days shown is not a number');
});

test('finders: a finder that filed nothing is 0 to the newest snapshot, and the row says when it last filed (5 Nov 2026: layout 1 Nov, probe 24 Oct)', () => {
  // The writer (selfheal-stats.mjs) lists only detectors that filed in the window, so a silent finder has no row in a stored snapshot: that is 0, not "no data".
  const only = detector => ({periods: {last7: {byDetector: [{detector, filed: 2, fixed: 0, queued: 0}]}}});
  const jobs = finderJobs([snap(0, only('AI screenshot review')), snap(3, only('Layout and DOM checks'))], days);
  const layout = jobs.find(item => item.id === 'finder-layout'), probe = jobs.find(item => item.id === 'finder-interactions');
  assert.equal(layout.value, '0');
  assert.match(layout.sub, new RegExp(`in the 7 days to ${D(0)}\\b`), 'the date is the newest snapshot, not the last day this finder had a row');
  assert.match(layout.sub, new RegExp(`last filed in the week to ${D(3)}`));
  assert.equal(layout.series.at(-1).value, 0, 'the newest stored day is a 0 point');
  assert.match(probe.sub, /none filed in the 14 days/);
  assert.equal(probe.series[days.indexOf(D(1))].value, null, 'a day with no snapshot stays grey');
});

test('planted bugs: caught of planted per snapshot day, "watch" when one is missed; the mutation run as a share', () => {
  const jobs = finderJobs([snap(1), snap(0, {recall: {planted: 13, caught: 13, missed: []}, quality: {mutation: {rate: 92, note: '11 of 12 planted code bugs caught'}}})], days);
  const ui = jobs.find(item => item.id === 'planted-ui'), code = jobs.find(item => item.id === 'planted-code');
  assert.deepEqual([ui.value, ui.status, ui.series.at(-2).ok, ui.series.at(-1).ok], ['13/13', 'good', false, true]);
  assert.deepEqual([code.value, code.status], ['92%', 'warn']);
  assert.match(finderJobs([snap(0)], days).find(item => item.id === 'planted-ui').sub, /missed: page-overflow/);
});

test('the page draws every group with a trend per job, the exceptions in the band, and a job with nothing says so', () => {
  const html = page(model(nightlySummary({snapshot: nights}, now), [snap(0)], now));
  assert.match(html, /<h1>📊 Report only<\/h1>/);
  for (const group of GROUPS) assert.ok(html.includes(group.title), group.title);
  assert.equal((html.match(/class="card rjob"/g) || []).length, GROUPS.flatMap(group => group.jobs).length, 'one card per job');
  assert.equal((html.match(/class="nt"/g) || []).length, GROUPS.flatMap(group => group.jobs).length);
  assert.match(html, /id="r-beta-clock"[\s\S]*?<b>30 min<\/b>/);
  assert.match(html, /1 of \d+ numbers off their bar/, 'Quality AI at 67% is under its 80% bar');
  assert.match(html, /<a href="#r-quality-ai"><span class="chip bad">Quality AI/, 'the exception is a chip that jumps to its card');
  assert.match(html, /◷ no data/, 'Wander-less jobs say no data');
  const empty = page(model(null, [], now));
  assert.match(empty, /0 numbers measured, none off their bar/);
});

test('Testing → Overview: the proof cards keep a one-line link to Report only, not the nightly charts; without the page in the menu they carry neither', () => {
  const data = {e2e: {...nights}, now, repo: 'GarryOne/jobadabra'};
  const linked = overviewPage(resolve(data, {pages: ['/admin/testing/report-only']}), {now});
  assert.doesNotMatch(linked, /class="nts"/, 'no chart on a proof card');
  assert.doesNotMatch(linked, /class="nbars/);
  const e2e = linked.match(/<article class="mcard" id="m-e2e">[\s\S]*?<\/article>/)[0];
  assert.match(e2e, /<div class="rline"><a href="\/admin\/testing\/report-only">📊 Report only<\/a>.*Beta wall clock 30 min/);
  assert.equal((e2e.match(/class="rline"/g) || []).length, 1, 'one line, not one per job');
  assert.match(linked.match(/<article class="mcard" id="m-wander">[\s\S]*?<\/article>/)[0], /class="rline"/);
  assert.doesNotMatch(linked.match(/<article class="mcard" id="m-smoke">[\s\S]*?<\/article>/)[0], /class="rline"/, 'a card with no report-only number has no line');
  assert.doesNotMatch(overviewPage(resolve(data), {now}), /class="rline"|class="nts"/);
  assert.equal(reportLine([], '/x'), '');
  assert.match(reportLine([{title: 'Wander', value: '–'}], '/x'), /no night stored yet/);
});

test('the route: owner only, in the Testing menu after GTM readiness, every other visitor gets a 404', async () => {
  const testing = PAGES.filter(item => item.group === 'Testing').map(item => item.path);
  assert.equal(testing[testing.indexOf('/admin/testing/gtm-readiness') + 1], '/admin/testing/report-only');
  const env = {STATS_KEY: 'k3y', STATS_SALT: 's', STATS: {prepare: () => ({first: async () => null, bind() { return this; }, all: async () => ({results: []})})}, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')}};
  const get = (path, headers = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, {headers, redirect: 'manual'}), env, {});
  assert.equal((await get('/admin/testing/report-only')).status, 404);
  const owner = await get('/admin/testing/report-only', {Cookie: 'jp_stats=k3y'});
  assert.equal(owner.status, 200);
  const html = await owner.text();
  assert.match(html, /Report only/);
  assert.match(html, /aria-current="page">📊 Report only<\/a>/);
});

test('plumbing toggle (owner, 5 Nov 2026): with the board the nightly cards hide in a closed toggle, the red chips stay visible outside it and a click on one opens it; no board, no toggle', () => {
  const built = model(nightlySummary({snapshot: nights}, now), [snap(0)], now), html = page(built, qualityModel({}));
  const toggle = html.indexOf('<details class="plumb" id="plumbing">'), chip = html.indexOf('<a href="#r-quality-ai"><span class="chip bad">Quality AI');
  assert.ok(toggle > 0 && !/<details class="plumb" id="plumbing" open/.test(html), 'closed by default');
  assert.ok(html.indexOf('class="qgrid"') < chip && chip < toggle, 'the board, then the red chip, both outside the toggle');
  const inside = html.slice(toggle, html.indexOf('</details>', toggle) + 10);
  assert.equal((inside.match(/class="card rjob"/g) || []).length, GROUPS.flatMap(group => group.jobs).length, 'every nightly card is inside the toggle');
  assert.equal((html.match(/<\/?details/g) || []).filter(tag => tag === '<details').length, (html.match(/<\/details>/g) || []).length, 'every details closes');
  // The script, run against a stub DOM: a hash on a card inside the toggle opens it and scrolls to it; no hash does nothing; a click on a chip opens it again after it was closed (no hashchange then).
  const run = hash => {
    const calls = [], details = {open: false}, card = {closest: sel => (sel === 'details' ? details : null), scrollIntoView: () => calls.push('scroll')}, handlers = {};
    const doc = {getElementById: id => (id === 'r-quality-ai' ? card : null), addEventListener: (name, fn) => { handlers[`doc:${name}`] = fn; }};
    new Function('document', 'location', 'addEventListener', OPEN_ON_LINK.replace(/^<script>|<\/script>$/g, ''))(doc, {hash}, (name, fn) => { handlers[name] = fn; });
    return {details, calls, handlers};
  };
  const loaded = run('#r-quality-ai');
  assert.deepEqual([loaded.details.open, loaded.calls, Object.keys(loaded.handlers)], [true, ['scroll'], ['hashchange', 'doc:click']]);
  assert.deepEqual([run('').details.open, run('').calls], [false, []]);
  assert.deepEqual([run('#%E0%A4%A').details.open, run('#%E0%A4%A').calls], [false, []], 'a malformed hash ends quietly');
  const again = run('');
  again.handlers['doc:click']({target: {closest: () => ({getAttribute: () => '#r-quality-ai'})}});
  assert.deepEqual([again.details.open, again.calls], [true, ['scroll']], 'the second click on the same chip, with the toggle closed, opens it');
  again.details.open = false;
  again.handlers['doc:click']({target: {closest: () => null}});
  assert.equal(again.details.open, false, 'a click that is not on an in-page link does nothing');
  const bare = page(built, null);
  assert.doesNotMatch(bare, /<details class="plumb"|<script>/, 'a failed board leaves the nightly cards in the open, as before');
  assert.match(bare, /<a href="#r-quality-ai"><span class="chip bad">Quality AI/);
});
