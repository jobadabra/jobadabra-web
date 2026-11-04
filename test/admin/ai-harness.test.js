// /admin/ai/harness (owner, 4 Nov 2026): the upload of kind "harness" refuses a malformed run record and clamps the rest, the page draws one card per run with escaped values, and the route answers the owner only.
// The fixture is the shape of the first real record (4 Nov 2026, run 41932545228), nothing else invented.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../workers/www/index.js';
import {cleanRun, cleanHarness} from '../../admin/harness-clean.js';
import {harnessPage} from '../../admin/ai-harness.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('x')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const now = new Date('2026-11-04T18:00:00Z');
const URL_BASE = 'https://github.com/jobadabra/jobadabra/actions/runs/';
const record = {v: 1, workflow: 'ai-fixer', run_id: 41932545228, url: `${URL_BASE}41932545228`, started: '2026-11-04T16:30:00Z', minutes: 4, source: 'linear', ref: 'JOB-271', round: 0, engine: 'codex/gpt-6.1-sol', model: 'gpt-6.1-sol',
  turns: 3, calls: 3, tokens_in: 48124, tokens_out: 220, steps: [{n: 1, action: 'search'}, {n: 2, action: 'read'}, {n: 3, action: 'finish'}], verdict: 'needs-human', reason: 'the walls deny tools/', changed_files: [], pr: null, stop: null, errors: []};
const card = {plan: {rows: [{n: 1, name: 'Plan and spec', state: 'done', pr: 3170}, {n: 2, name: 'Move walls', state: 'doing'}, {n: 3, name: 'Loop', state: 'weird'}], web: [{n: 1, name: 'One card per row', state: 'done'}]},
  layers: [{id: 'L0', name: 'Index', present: true, note: 'docs/map/index.md'}, {id: 'L1', name: 'Hubs', present: false, note: '0 of 10'}], sources: [{name: 'Linear', built: true}, {name: 'PostHog', built: false}], runs: [record]};

test('a run record is refused unless it is a v1 record of a real fixer run, and every field is clamped', () => {
  assert.equal(cleanRun(record).id, '41932545228');
  for (const bad of [{...record, v: 2}, {...record, workflow: 'other'}, {...record, run_id: 'x1'}, {...record, url: 'https://evil.example/jobadabra/jobadabra/actions/runs/41932545228'}, {...record, url: `${URL_BASE}1`}, {...record, started: 'yesterday'}, null, 'text', []]) assert.equal(cleanRun(bad), null);
  const wild = cleanRun({...record, ref: 'JOB 271 <b>', verdict: 'Needs Human!<x>', reason: `a\nb${'z'.repeat(900)}`, errors: Array(9).fill('e'.repeat(500)), changed_files: ['a/b<c>.js', 5], steps: [{action: 'rm -rf'}, {}], pr: -3, turns: 1e12, stop: 'ready<script>'});
  assert.equal(wild.ref, ''); assert.equal(wild.verdict, 'needshumanx'); assert.equal(wild.reason.length, 400); assert.ok(!wild.reason.includes('\n')); assert.equal(wild.errors.length, 5); assert.equal(wild.errors[0].length, 200);
  assert.deepEqual(wild.files, ['a/bc.js']); assert.deepEqual(wild.steps, ['rmrf']); assert.equal(wild.pr, null); assert.equal(wild.turns, 1e7); assert.equal(wild.stop, 'readyscript');
});
test('the harness card drops bad records and repeats, counts them, and sorts newest first', () => {
  const older = {...record, run_id: 41900000000, url: `${URL_BASE}41900000000`, started: '2026-11-03T10:00:00Z'};
  const clean = cleanHarness({...card, runs: [older, {...record, v: 9}, record, record]});
  assert.deepEqual(clean.runs.map(run => run.id), ['41932545228', '41900000000']); assert.equal(clean.dropped, 1);
  assert.equal(clean.plan.rows[2].state, 'next', 'an unknown state is "next"'); assert.equal(cleanHarness(null), null);
});
test('the page draws the run with its numbers, steps and log link, and never lets a value become HTML', () => {
  const html = harnessPage({...cleanHarness(card), at: '2026-11-04T17:00:00Z'}, now);
  assert.match(html, /1 run /); assert.match(html, /Needs a human/); assert.match(html, /linear JOB-271/); assert.match(html, /<b>3<\/b> turns/); assert.match(html, /48\.1k<\/b> in/); assert.match(html, /<i>search<\/i><u>→<\/u><i>read<\/i>/);
  assert.match(html, /href="https:\/\/github\.com\/jobadabra\/jobadabra\/actions\/runs\/41932545228"/); assert.match(html, /Plan and spec/); assert.match(html, /in progress/); assert.match(html, /✅ built · Linear/); assert.match(html, /⬜ not built · PostHog/);
  const evil = harnessPage(cleanHarness({...card, runs: [{...record, reason: '<img src=x onerror=alert(1)>', errors: ['<script>boom</script>'], files: [], changed_files: ['x<y>.js'], engine: '<b>e</b>'}], layers: [{id: 'L0', name: '<i>x</i>', present: true, note: '<u>n</u>'}]}), now);
  assert.ok(!/<(img|script|b>e|i>x|u>n)/.test(evil.replace(/<(b|i|u)>/g, m => m) .replace(/<\/?(b|i|u)>/g, '')) || true);
  for (const tag of ['<img', '<script', '<b>e</b>', '<i>x</i>', '<u>n</u>']) assert.ok(!evil.includes(tag), `${tag} must be escaped`);
  assert.match(evil, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
test('the page says so when nothing was uploaded, and a stopped run shows its stop word in red', () => {
  const empty = harnessPage(null, now);
  assert.match(empty, /No run recorded yet/); assert.match(empty, /Plan not reported yet/); assert.match(empty, /Not reported yet/);
  const stopped = harnessPage(cleanHarness({runs: [{...record, stop: 'refused', errors: ['wall: tools/ is denied']}]}), now);
  assert.match(stopped, /A wall refused the change/); assert.match(stopped, /ai-chip bad[^>]*>⛔ refused/); assert.match(stopped, /1 stopped red/); assert.match(stopped, /wall: tools\/ is denied/);
  const ready = harnessPage(cleanHarness({runs: [{...record, verdict: 'fix', pr: 3190, stop: 'ready', changed_files: ['a.js', 'b.js']}]}), now);
  assert.match(ready, /Reached READY on PR #3190/); assert.match(ready, /1 READY/); assert.match(ready, /2 files changed/);
  assert.ok(!harnessPage(cleanHarness({runs: [{...record, started: '2026-09-01T00:00:00Z'}]}), now).includes('run-41932545228'), 'a run older than 30 days is not drawn');
});
test('the route answers the owner only, stores the upload clamped, and the menu lists the tab', async () => {
  const e = env();
  assert.equal((await call(e, '/admin/ai/harness')).status, 404);
  assert.match(await (await call(e, '/admin/ai/harness', owner)).text(), /No run recorded yet/);
  const put = await call(e, '/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({kind: 'harness', days: [{day: '2026-11-04', ...card, runs: [record, {...record, v: 7}]}]})});
  assert.equal(put.status, 200);
  const html = await (await call(e, '/admin/ai/harness', owner)).text();
  assert.match(html, /Needs a human/); assert.match(html, /1 record unreadable/); assert.match(html, /href="\/admin\/ai\/harness"/, 'the AI group has the tab');
  assert.equal((await call(e, '/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({kind: 'harness', days: [{day: '2026-11-04', runs: 'x'}]})})).status, 200, 'an upload with no usable run still stores its plan and sources');
});
