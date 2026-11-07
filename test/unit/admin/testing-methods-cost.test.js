// Testing → Overview "Bugs found vs what they cost": each method's real bugs, false alarms, tokens, CI minutes and the cost per real bug, from the rows other pages already keep.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {DETECTORS} from '../../../desktop/e2e/lib/selfheal-stats.mjs';
import {METHODS} from '../../../admin/testing-overview-methods.js';
import {resolve} from '../../../admin/testing-overview-data.js';
import {costCard, costRows, lastDays, METHOD_COST, trendDays} from '../../../admin/testing-methods-cost.js';

const now = new Date('2026-11-07T12:00:00Z'), repo = 'GarryOne/jobadabra';
const detector = (name, fixed, queued, falsePositive, harness = 0, filed = fixed + queued + falsePositive + harness) => ({detector: name, filed, fixed, queued, falsePositive, harness});
const healing = {periods: {last7: {byDetector: [detector('AI user agent', 3, 2, 5), detector('AI code review', 8, 0, 5), detector('AI screenshot review', 2, 0, 8, 2), detector('Layout and DOM checks', 0, 0, 0, 0, 2),
  detector('Failed test steps', 0, 0, 0, 0, 3), detector('other', 4, 0, 1)]}}};
const entry = tokens => ({calls: 1, ok: 1, tokens, ms: 1, engines: {codex: 1}});
const tally = {days: {'2026-11-07': {'jobadabra/ai-user-agents.yml': entry(500000), 'jobadabra/code-review.yml': entry(80000), 'jobadabra/ui-findings.yml': entry(60000), 'jobadabra-web/code-review.yml': entry(9e9)},
  '2026-11-01': {'jobadabra/ai-user-agents.yml': entry(500000)}, '2026-10-30': {'jobadabra/ai-user-agents.yml': entry(7e9)}}};
const minutes = {'ai-user-agents.yml': 100, 'code-review.yml': 40, 'ui-findings.yml': 30};
const rows = (extra = {}) => Object.fromEntries(costRows({healing, tally, repo, now, minutesOf: file => minutes[file] ?? null, ...extra}).map(row => [row.id, row]));

test('every method reads its own detector row: real = fixed + queued, false = false positive + harness, precision of the judged', () => {
  const by = rows();
  assert.deepEqual([by.persona.real, by.persona.falsePositive, by.persona.filed], [5, 5, 10]);
  assert.deepEqual([by['code-review'].real, by['code-review'].falsePositive], [8, 5]);
  assert.deepEqual([by.screenshots.real, by.screenshots.falsePositive, by.screenshots.filed], [2, 10, 12]);
  assert.equal(by.persona.precision, 0.5);
  assert.equal(by.screenshots.precision, 2 / 12);
});

test('tokens and minutes per real bug: the workflow of the method, the same 7 days, the other repo and older days left out', () => {
  const by = rows();
  assert.equal(by.persona.tokens, 1000000);   // 7 Nov + 1 Nov; 30 Oct is outside the 7 days
  assert.equal(by.persona.tokensPerBug, 200000);
  assert.equal(by.persona.minutesPerBug, 20);
  assert.equal(by['code-review'].tokens, 80000);   // 'jobadabra-web/code-review.yml' is another repo's
  assert.equal(by['code-review'].tokensPerBug, 10000);
  assert.equal(by['code-review'].minutesPerBug, 5);
  assert.equal(by.screenshots.tokensPerBug, 30000);
});

test('a method that found nothing real but cost something reads ∞ per bug and a warning; one with no cost known reads —', () => {
  const none = rows({healing: {periods: {last7: {byDetector: [detector('AI user agent', 0, 0, 4)]}}}});
  assert.equal(none.persona.real, 0);
  assert.equal(none.persona.tokensPerBug, Infinity);
  assert.equal(none.persona.minutesPerBug, Infinity);
  assert.equal(none.persona.warn, true);
  const html = costCard(Object.values(none), []);
  assert.match(html, /∞ per bug/);
  assert.match(html, /no real bug/);
  const unknown = rows({tally: null, minutesOf: () => null});
  assert.equal(unknown.persona.tokens, null);
  assert.equal(unknown.persona.tokensPerBug, null);
  assert.equal(unknown.persona.minutes, null);
});

test('layout checks and failed steps ride another workflow (no cost of their own, never counted twice); people are free and never warned', () => {
  const by = rows();
  for (const id of ['layout', 'steps']) { assert.equal(by[id].tokens, null); assert.equal(by[id].minutes, null); assert.equal(by[id].tokensPerBug, null); assert.equal(by[id].warn, true); assert.ok(by[id].rides); }
  assert.equal(by.layout.filed, 2);
  assert.equal(by.people.real, 4);
  assert.equal(by.people.free, true);
  assert.equal(by.people.warn, false);
  assert.equal(by.people.tokens, null);
  const none = rows({healing: {periods: {last7: {byDetector: []}}}});
  assert.equal(none.people.warn, false);
  assert.equal(none.persona.warn, true);
});

test('a snapshot with no 7-day view gives no rows and the card says so', () => {
  assert.deepEqual(costRows({healing: null, tally}), []);
  assert.deepEqual(costRows({healing: {periods: {}}, tally}), []);
  assert.match(costCard([], []), /No self-healing snapshot/);
});

test('lastDays keeps today and the 6 days before it', () => {
  assert.deepEqual(Object.keys(lastDays(tally, now).days), ['2026-11-07', '2026-11-01']);
  assert.equal(lastDays(null, now), null);
});

test('the trend: one value per method per day; a day with no snapshot is null, a snapshot with no row for a method is 0', () => {
  const days = ['2026-11-05', '2026-11-06', '2026-11-07'];
  const snapshots = [{day: '2026-11-07', ...healing}, {day: '2026-11-05', periods: {last7: {byDetector: [detector('AI code review', 1, 1, 0)]}}}];
  const trend = trendDays(snapshots, days);
  const at = id => METHOD_COST.findIndex(method => method.id === id);
  assert.equal(trend[0].values[at('code-review')], 2);
  assert.equal(trend[0].values[at('persona')], 0);
  assert.equal(trend[1].values[at('code-review')], null);
  assert.equal(trend[2].values[at('persona')], 5);
  assert.match(trend[1].tip, /no snapshot/);
  const html = costCard(costRows({healing, tally, repo, now}), trend);
  assert.match(html, /<svg class="vz-cols"/);
});

test('the card is a table row per method with the numbers in it', () => {
  const html = costCard(costRows({healing, tally, repo, now, minutesOf: file => minutes[file] ?? null}), []);
  for (const method of METHOD_COST) assert.ok(html.includes(method.title), method.title);
  assert.match(html, /200k/);   // persona: tokens per real bug
  assert.match(html, /50%/);
});

test('the catalogue names real detectors and real workflows', () => {
  const labels = new Set([...Object.values(DETECTORS), 'other']);
  for (const method of METHOD_COST) assert.ok(labels.has(method.detector), `${method.id}: "${method.detector}" is not a label of selfheal-stats DETECTORS`);
  for (const method of METHODS.filter(item => item.bugs?.detector)) assert.ok(labels.has(method.bugs.detector), `${method.id}: "${method.bugs.detector}" is not a label of selfheal-stats DETECTORS`);
  if (existsSync('.github/workflows')) for (const file of METHOD_COST.flatMap(method => [...method.wf, method.rides].filter(Boolean))) assert.ok(existsSync(`.github/workflows/${file}`), `${file} is a public workflow`);
  assert.equal(new Set(METHOD_COST.map(method => method.id)).size, METHOD_COST.length);
});

test('the overview model carries the card rows from its stored data', () => {
  const model = resolve({repo, now, schedules: {jobs: [{repo, file: 'code-review.yml', name: 'x', crons: [], recent: [], weeklyMin: 40}]}, healing, snapshots: [{day: '2026-11-07', ...healing}], tally});
  const by = Object.fromEntries(model.cost.rows.map(row => [row.id, row]));
  assert.equal(by['code-review'].minutes, 40);
  assert.equal(by.persona.minutes, null);   // the schedules snapshot does not list ai-user-agents.yml here
  assert.equal(model.cost.trend.length, 14);
});
