// The test-coverage card on /admin/testing/integrations (owner via a8, 1 Nov 2026): the nightly report's numbers validated, drawn, and read once per report by the hourly collector.
// Report only: a layer that was not measured is "not measured", never 0%.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanCoverage, KEEP_HISTORY} from '../../../admin/coverage-intel.js';
import {coverageCard, trend} from '../../../admin/coverage-card.js';
import {cleanSnapshot} from '../../../admin/integration-intel.js';
import {page} from '../../../admin/integration-page.js';
import {coverageFor, mergeCoverage, newestReport} from '../../../tools/ci-intel/jobs/coverage-intel.mjs';

const now = new Date('2026-11-02T12:00:00Z');
const measured = (covered, total) => ({state: 'measured', covered, total, pct: Math.round((1000 * covered) / total) / 10});
// The shape of tools/coverage-report.mjs's report.json (public repo): layers with a `total`, folders with a cell per layer id, journeys with a list.
const report = (at = '2026-11-02', extra = {}) => ({
  sha: 'abcdef1234567', at,
  layers: [{id: 'unit-py', label: 'Unit · Python', measured: true, total: measured(620, 1000)}, {id: 'unit-js', label: 'Unit · JS', measured: true, total: measured(500, 1000)},
    {id: 'integration', label: 'Integration · Node', measured: true, total: measured(300, 1000)}, {id: 'e2e', label: 'E2E · app, extension, engine', measured: false, why: 'no map', total: {state: 'not measured'}}],
  folders: [{folder: 'src', cells: {'unit-py': measured(620, 1000), 'unit-js': {state: 'n/a'}, integration: {state: 'n/a'}, e2e: {state: 'not measured'}}},
    {folder: 'extension', cells: {'unit-py': {state: 'n/a'}, 'unit-js': measured(40, 100), integration: measured(30, 100), e2e: {state: 'not measured'}}}],
  journeys: {total: 3, withTest: 2, without: 1, byLayer: {e2e: 1, integration: 2, unit: 1}, list: [
    {n: 1, name: 'Set up Jobadabra', priority: 'P0', layers: ['e2e', 'integration'], tested: true}, {n: 2, name: 'Export my data', priority: 'P1', layers: [], tested: false},
    {n: 3, name: 'Stop a fill', priority: 'P0', layers: ['integration', 'unit'], tested: true}]},
  ...extra,
});
const stored = (at, pct) => cleanCoverage(mergeCoverage(null, report(at, {layers: report().layers.map(l => (l.id === 'unit-py' ? {...l, total: measured(pct * 10, 1000)} : l))}), {runId: 7, sha: 'abcdef1'}));

test('the report is validated: unknown fields dropped, numbers clamped, "not measured" never becomes a number', () => {
  const clean = cleanCoverage({...report(), runId: 41337418754, evil: '<script>', layers: [...report().layers.slice(0, 3), {id: 'e2e', label: 'x'.repeat(300), total: {state: 'weird', pct: 99}}, {id: 'nope', total: measured(1, 2)}]});
  assert.deepEqual(clean.layers.map(layer => layer.id), ['unit-py', 'unit-js', 'integration', 'e2e']);
  assert.deepEqual(clean.layers[3].total, {state: 'not measured'}, 'a state the report does not use is "not measured", not 99%');
  assert.equal(clean.layers[3].label.length, 60);
  assert.equal(clean.evil, undefined);
  assert.equal(cleanCoverage({...report(), layers: [{id: 'unit-py', label: 'p', total: {state: 'measured', pct: 250, covered: 5, total: 5}}]}).layers[0].total.pct, 100);
  assert.equal(cleanCoverage({layers: 'x', at: '2026-11-02'}), null);
  assert.equal(cleanCoverage({...report(), at: 'last night'}), null);
  assert.deepEqual(cleanCoverage(cleanCoverage({...report(), runId: 5, history: [{day: '2026-11-01', pct: {'unit-py': 61.5, e2e: null}}]})), cleanCoverage({...report(), runId: 5, history: [{day: '2026-11-01', pct: {'unit-py': 61.5, e2e: null}}]}), 'cleaning its own output changes nothing: the stored part is sent forward as it is');
});

test('the card: a tile per layer, "not measured" in words, a bar per folder cell, the journeys with no test first', () => {
  const html = coverageCard(cleanCoverage(report()));
  for (const [label, value] of [['Unit · Python', '62%'], ['Unit · JS', '50%'], ['Integration · Node', '30%']]) assert.match(html, new RegExp(`${label}</span><b>${value}`));
  assert.match(html, /E2E · app, extension, engine<\/span><b>not measured<\/b><span class="chip off">not measured tonight/);
  assert.doesNotMatch(html, /<b>0%/, 'never 0% for a layer nobody measured');
  assert.match(html, /620 of 1,000 lines/);
  assert.match(html, /<code>extension<\/code>[^]*covbar"><i style="width:40%"/, 'a bar per measured cell');
  assert.match(html, /2 of 3 GTM journeys have a test[^]*e2e 1 · integration 2 · unit 1/);
  assert.ok(html.indexOf('Export my data') < html.indexOf('Set up Jobadabra'), 'journeys with no test come first');
  assert.match(html, /Export my data[^]*chip warn">no test/);
  assert.match(html, /abcdef1<\/code>, 2 Nov/);
  assert.match(coverageCard(null), /No coverage report read yet/);
});

test('the trend is the change against the night before, in points; nothing when either night was not measured', () => {
  const one = cleanCoverage({...stored('2026-11-02', 62), history: [{day: '2026-11-01', pct: {'unit-py': 60.5, 'unit-js': null}}, {day: '2026-11-02', pct: {'unit-py': 62, 'unit-js': 50}}]});
  assert.equal(trend(one, 'unit-py'), '+1.5 pts vs 1 Nov');
  assert.equal(trend(one, 'unit-js'), '', 'the night before was not measured');
  assert.equal(trend({...one, at: '2026-11-03'}, 'unit-py'), '', 'a report that is not tonight\'s has no trend');
  assert.match(coverageCard(one), /\+1\.5 pts vs 1 Nov/);
});

const json = (newest, calls) => async (...args) => { calls.push(args); return newest; };
const artifact = (id, extra = {}) => ({id: id * 10, expired: false, workflow_run: {id, head_sha: 'f'.repeat(40)}, ...extra});

test('the collector reads the newest report once, keeps one total per night, and keeps what it has when none can be read', async () => {
  const calls = [], reads = [];
  const read = async (repo, runId) => { reads.push(runId); return report('2026-11-02'); };
  const first = await coverageFor(null, {repo: 'o/r', json: json(artifact(100), calls), read});
  assert.deepEqual([first.runId, first.at, first.history.length, first.sha], [100, '2026-11-02', 1, 'abcdef1234567']);
  assert.match(calls[0].join(' '), /repos\/o\/r\/actions\/artifacts\?name=coverage-report&per_page=1/);
  const again = await coverageFor(first, {repo: 'o/r', json: json(artifact(100), []), read});
  assert.equal(again, first, 'a report already read is not read again');
  assert.equal(reads.length, 1);
  const second = await coverageFor(first, {repo: 'o/r', json: json(artifact(101), []), read: async () => report('2026-11-03')});
  assert.deepEqual(second.history.map(row => row.day), ['2026-11-02', '2026-11-03']);
  assert.equal((await coverageFor(first, {repo: 'o/r', json: json(null, []), read})).runId, 100, 'no artifact: the stored one stays');
  assert.equal(await newestReport('o/r', json(artifact(5, {expired: true}), [])), null, 'an expired artifact is not read');
  const log = [];
  const realLog = console.log;
  console.log = line => log.push(line);
  try { assert.equal((await coverageFor(first, {repo: 'o/r', json: json(artifact(102), []), read: async () => { throw new Error('gh: rate limit'); }})).runId, 100, 'an unreadable report keeps the stored one'); } finally { console.log = realLog; }
  assert.match(log.join('\n'), /::warning::the coverage report was not read this hour: gh: rate limit/, 'and says so');
  // A report that parses but has a shape the site rejects (a full timestamp as `at`, no layers) keeps the stored part and its history.
  console.log = line => log.push(line);
  try {
    for (const bad of [{...report(), at: '2026-11-03T03:00:00Z'}, {sha: 'abc', at: '2026-11-03'}]) {
      assert.equal(await coverageFor(first, {repo: 'o/r', json: json(artifact(103), []), read: async () => bad}), first, 'a report the site would reject keeps the stored one');
    }
  } finally { console.log = realLog; }
  assert.match(log.join('\n'), /run 103 has a shape the site does not accept/);
});

test('the nights kept for the trend are the last 30, one per day', () => {
  let coverage = null;
  for (let day = 0; day < 40; day++) coverage = mergeCoverage(coverage, report(new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10)), {runId: day + 1, sha: ''});
  assert.ok(coverage.history.length <= KEEP_HISTORY);
  assert.equal(new Set(coverage.history.map(row => row.day)).size, coverage.history.length, 'a night read twice is one row');
  const twice = mergeCoverage(mergeCoverage(null, report('2026-11-02'), {runId: 1, sha: ''}), report('2026-11-02'), {runId: 2, sha: ''});
  assert.equal(twice.history.length, 1);
});

test('the snapshot keeps the coverage through the site\'s validation and the page draws it; a snapshot without one still draws', () => {
  const base = {runs: [{runId: 1, layer: 'app', day: '2026-11-01', on: 'main', platform: 'linux', sha: 'abcdef1', conclusion: 'success', tests: 3, failed: 0, ms: 100}]};
  const withCoverage = cleanSnapshot({...base, coverage: mergeCoverage(null, report('2026-11-02'), {runId: 9, sha: ''})}, now);
  assert.equal(withCoverage.coverage.runId, 9);
  assert.match(page(withCoverage, {now}), /Test coverage · line % per layer[^]*Unit · Python<\/span><b>62%/);
  const without = cleanSnapshot(base, now);
  assert.equal(without.coverage, null);
  assert.match(page(without, {now}), /No coverage report read yet/);
});
