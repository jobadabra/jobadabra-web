// /admin/operations/scheduled (and its Notify column): workflow parsing, cron words and next/previous start, areas, health, the collector on a fake GitHub, the ingest, and the page in each state.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {PAGES} from '../../../admin/admin.js';
import {HEADLINES} from '../../../admin/headlines.js';
import {collect} from '../../../jobs/schedules-snapshot.mjs';
import {AREAS, areaOf, billedWeight, missed, nextOf, parseWorkerCrons, parseWorkflow, prevOf, stateOf, words, whenWords} from '../../../shared/schedules-model.js';
import {clean, counts, decorate, page} from '../../../admin/schedules.js';

const now = new Date('2026-10-20T17:30:00Z');   // 19:30 in Zurich (CEST)
const WORKFLOW = `name: CI · Ops overview
# Where our engineering time goes: the merged PRs of the last 30 days.
# Hourly backup.
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
jobs:
  publish:
    runs-on: macos-14
    steps:
      - run: node tools/ai-cost-report.mjs
`;

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('')}});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});

const run = (at, conclusion, mins = 3) => ({run_started_at: at, created_at: at, updated_at: new Date(Date.parse(at) + mins * 60000).toISOString(), status: conclusion ? 'completed' : 'in_progress', conclusion, html_url: 'https://github.com/jobadabra/x/actions/runs/1'});
function fakeGh(repos) {
  return (path, raw) => {
    const [, repo, rest] = path.match(/^repos\/([^/]+\/[^/?]+)(?:\/(.*))?$/) || [];
    const data = repos[repo]; if (!data) throw new Error('404');
    if (!rest) return {private: data.private};
    if (rest.startsWith('actions/workflows?')) return {workflows: data.files.map((file, i) => ({id: i + 1, path: `.github/workflows/${file.name}`, state: file.state || 'active'}))};
    if (rest.startsWith('contents/')) return raw ? data.files.find(file => rest.endsWith(file.name)).text : data.code?.[rest.replace('contents/', '')];
    const id = Number(rest.match(/workflows\/(\d+)\/runs/)[1]);
    return {total_count: data.files[id - 1].runs.length, workflow_runs: data.files[id - 1].runs};
  };
}
const files = [
  {name: 'ops-overview.yml', text: WORKFLOW, runs: Array.from({length: 20}, (_, i) => run(new Date(now - (i + 1) * 3600000).toISOString(), i === 0 ? 'failure' : 'success'))},
  {name: 'manual.yml', text: 'name: Manual\non:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-24.04\n', runs: []},
  {name: 'old.yml', state: 'disabled_manually', text: "name: Old\non:\n  schedule:\n    - cron: '0 5 * * *'\njobs:\n  a:\n    runs-on: ubuntu-24.04\n", runs: []}];
const SCHEDULER = `  if (cron === '40 */3 * * *') return [{workflow: 'ops-overview.yml', inputs: {}}];\n`;
const gh = fakeGh({'jobadabra/jobadabra': {private: false, files: [files[0]], code: {'app-core/src/scheduler.js': SCHEDULER}}, 'jobadabra/jobadabra-web': {private: true, files}});
gh.raw = true;
const realGh = (path, raw) => (path.endsWith('app-core/src/scheduler.js') ? SCHEDULER : gh(path, raw));

test('a workflow file gives its name, first comment, crons, hand-run flag, runner and AI use', () => {
  const parsed = parseWorkflow(WORKFLOW);
  assert.deepEqual([parsed.name, parsed.crons, parsed.manual, parsed.runner, parsed.ai], ['CI · Ops overview', ['17 * * * *'], true, 'macos-14', true]);
  assert.equal(parsed.about, 'Where our engineering time goes: the merged PRs of the last 30 days. Hourly backup.');
  assert.equal(parseWorkflow('name: x\non:\n  workflow_dispatch:\n').crons.length, 0);
  assert.deepEqual(parseWorkerCrons(SCHEDULER), {'ops-overview.yml': ['40 */3 * * *']});
  assert.deepEqual([billedWeight('macos-14', true), billedWeight('windows-2022', true), billedWeight('ubuntu-24.04', true), billedWeight('macos-14', false)], [10, 2, 1, 0]);
});

test('a cron is said in words and its next and previous start are found, in Zurich time', () => {
  assert.equal(words('30 2 * * *', now), 'Daily 04:30');   // summer time: UTC+2
  assert.equal(words('17 * * * *', now), 'Hourly at :17');
  assert.equal(words('40 */3 * * *', now), 'Every 3 h at :40');
  assert.equal(words('*/30 * * * *', now), 'Every 30 min');
  assert.equal(words('0 2 * * 1', now), 'Weekly Mon 04:00');
  assert.equal(words('41 5 1 * *', now), 'Monthly on day 1 07:41');
  assert.equal(words('0 5 1 */2 *', now), '0 5 1 */2 *', 'a shape it cannot say keeps the cron text');
  assert.equal(nextOf(['17 * * * *'], now).toISOString(), '2026-10-20T18:17:00.000Z');
  assert.equal(prevOf(['17 * * * *'], now).toISOString(), '2026-10-20T17:17:00.000Z');
  assert.equal(nextOf(['30 2 * * *'], now).toISOString(), '2026-10-21T02:30:00.000Z');
  assert.equal(nextOf(['0 2 * * 1'], now).toISOString(), '2026-10-26T02:00:00.000Z');
  assert.equal(whenWords(new Date('2026-10-21T02:30:00Z'), now), 'tomorrow 04:30');
});

test('areas, state and missed runs', () => {
  assert.deepEqual(['ui-findings.yml', 'sentry-fix.yml', 'record-sites.yml'].map(areaOf), ['testing', 'testing', 'testing']);
  assert.deepEqual(['central-scout.yml', 'random-draw.yml', 'daily-digest.yml'].map(areaOf), ['search', 'search', 'search']);
  assert.deepEqual(['search-lab.yml', 'scout-canary.yml'].map(areaOf), ['testing', 'testing'], 'the search lab and its canary are tests (owner, 1 Nov 2026)');
  assert.equal(areaOf('desktop.yml'), 'testing');
  assert.equal(areaOf('ops-overview.yml'), 'other');
  const ok = {crons: ['17 * * * *'], recent: [{at: '2026-10-20T17:18:00Z', conclusion: 'success'}]};
  assert.deepEqual([stateOf(ok), missed(ok, now)], ['green', false]);
  assert.equal(stateOf({recent: [{conclusion: null}, {conclusion: 'failure'}]}), 'red', 'a run still going is skipped');
  assert.equal(stateOf({disabled: true, recent: []}), 'off');
  assert.equal(stateOf({recent: []}), 'none');
  assert.equal(missed({crons: ['17 * * * *'], recent: [{at: '2026-10-20T15:18:00Z', conclusion: 'success'}]}, new Date('2026-10-20T17:50:00Z')), true, 'the 17:17 start never came');
  assert.equal(missed({crons: ['17 * * * *'], recent: [{at: '2026-10-20T15:18:00Z', conclusion: 'success'}]}, new Date('2026-10-20T17:20:00Z')), false, 'only 3 minutes late is on time');
  assert.equal(missed({crons: [], recent: []}, now), false, 'a hand-only job cannot miss');
  assert.equal(missed({crons: ['17 * * * *'], recent: []}, now), false, 'a job that never ran is "no run yet", not a miss');
});

test('the collector reads each repo, merges the Worker cron, weighs minutes, and survives a repo it cannot read', async () => {
  const snapshot = await collect({gh: realGh, repos: ['jobadabra/jobadabra', 'jobadabra/jobadabra-web', 'jobadabra/gone'], now});
  assert.deepEqual(snapshot.repos.map(repo => [repo.name, repo.ok, repo.private]), [['jobadabra/jobadabra', true, false], ['jobadabra/jobadabra-web', true, true], ['jobadabra/gone', false, true]]);
  const pub = snapshot.jobs.find(job => job.repo === 'jobadabra/jobadabra'), site = snapshot.jobs.find(job => job.repo === 'jobadabra/jobadabra-web' && job.file === 'ops-overview.yml');
  assert.deepEqual([pub.source, pub.crons, pub.billedMin, pub.weeklyMin], ['both', ['17 * * * *', '40 */3 * * *'], 0, 60], 'a public repo is free');
  assert.deepEqual([site.source, site.billedMin, site.recent.length, site.recent[0].conclusion, site.ai], ['github', 600, 14, 'failure', true], 'macOS in a private repo counts x10');
  assert.equal(snapshot.jobs.find(job => job.file === 'old.yml').disabled, true);
});

test('the ingest needs the key, cuts unknown fields and keeps one row; the page needs the owner login', async () => {
  const e = env(), snapshot = await collect({gh: realGh, repos: ['jobadabra/jobadabra-web'], now});
  const put = (body, key = 'pub') => call(e, '/ops/data?kind=schedules', {method: 'PUT', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
  assert.equal((await put(snapshot, 'wrong')).status, 404);
  assert.equal((await put({jobs: 'x'})).status, 400);
  assert.equal((await put({...snapshot, jobs: [{...snapshot.jobs[0], evil: '<script>', recent: []}]})).status, 200);
  assert.equal((await put(snapshot)).status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM schedules_snapshot').get().n, 1);
  assert.equal(clean({...snapshot, jobs: [{...snapshot.jobs[0], evil: 1}]}).jobs[0].evil, undefined);
  assert.equal((await call(e, '/admin/operations/scheduled')).status, 404, 'no login, no page');
  const res = await call(e, '/admin/operations/scheduled', owner), html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Ops overview/);
  assert.match(html, /Scheduled jobs/);
  const filtered = await (await call(e, '/admin/operations/scheduled?state=off', owner)).text();
  assert.ok(!/CI · Ops overview/.test(filtered.split('Run by hand only')[0].split('<table>')[1] || ''), 'the state filter hides green jobs');
});

test('the page in each state: no data, grouped by area with counts, escaped text', async () => {
  assert.match(page(null, {now}), /No data yet/);
  const snapshot = await collect({gh: realGh, repos: ['jobadabra/jobadabra-web'], now});
  snapshot.jobs[0].about = '<img src=x onerror=1>';
  const html = page(snapshot, {now});
  assert.ok(!html.includes('<img src=x'), 'job text is escaped');
  for (const area of AREAS) assert.ok(html.includes(area.label.replace('&', '&amp;')), `${area.label} has a tile`);
  const c = counts(decorate(snapshot, now).filter(job => job.crons.length));
  assert.deepEqual([c.all, c.red], [2, 1], 'one scheduled job is red (the disabled one is not), the hand-only job is listed apart');
  assert.match(html, /Run by hand only \(1\)/);
  assert.match(html, /missed a run|green|red/);
});

test('Scheduled is a page of the Operations section, and the old addresses (Schedules, Testing → Scheduled) still answer', async () => {
  const entry = PAGES.find(item => item.path === '/admin/operations/scheduled');
  assert.equal(entry.group, 'Operations');
  assert.deepEqual(PAGES.filter(item => item.group === 'Testing' && item.name === 'Scheduled'), [], 'the Testing tab of the same page went (5 Nov 2026)');
  assert.equal(typeof HEADLINES['/admin/operations/scheduled'], 'function');
  assert.ok(entry.old.length >= 4, 'the Schedules and the Testing → Scheduled addresses are kept as old ones');   // they are named only in the page's own entry (test/unit/website/form-pages.test.js)
  for (const old of entry.old) {
    const moved = await call(env(), `${old}?state=red`, owner);
    assert.deepEqual([moved.status, moved.headers.get('Location')], [301, '/admin/operations/scheduled?state=red'], old);
  }
});

test('the Area filter narrows the page; Testing shows its start-time graph; the Notify column carries the job\'s alert switch', async () => {
  const snapshot = {at: '2026-10-20T17:00:00Z', repos: [], jobs: [
    {repo: 'jobadabra/jobadabra', file: 'e2e.yml', name: 'CI · E2E', about: '', crons: ['0 2 * * *'], recent: []},
    {repo: 'jobadabra/jobadabra', file: 'product-brain.yml', name: 'Product brain', about: '', crons: ['0 6 * * *'], recent: []},
    {repo: 'jobadabra/jobadabra-web', file: 'ops-overview.yml', name: 'CI · Ops overview', about: '', crons: ['17 * * * *'], recent: []}]};
  const all = page(snapshot, {now}), search = page(snapshot, {area: 'search', now}), testing = page(snapshot, {area: 'testing', now});
  assert.ok(all.includes('CI · E2E') && all.includes('Product brain') && all.includes('CI · Ops overview') && all.includes('aria-label="Area"') && all.includes('<h1>⏰ Scheduled</h1>'));
  assert.ok(search.includes('Product brain') && !search.includes('CI · E2E'), 'the Area filter narrows the page');
  assert.ok(testing.includes('CI · E2E') && !testing.includes('Product brain'));
  assert.ok(testing.length > search.length && /<th>Notify<\/th>/.test(all));
  assert.match(all, /aria-label="Main went red[^"]*: on"/, 'e2e.yml carries the main-red switch, on by default');
  assert.match(all, /sends nothing/, 'a job with no alert says so');
  const owned = page(snapshot, {now, notify: {settings: new Map([['main-red', {enabled: 0}]]), canEdit: true, back: '/admin/operations/scheduled'}});
  assert.match(owned, /name="action" value="toggle"[^>]*><input type="hidden" name="event" value="main-red"><input type="hidden" name="on" value="1"/, 'off is shown, and its button turns it on');
  assert.ok(!/<form[^>]*>[^]*value="main-red"/.test(all.split('Run by hand only')[0]), 'a read-only viewer gets no form');
  const e = env();
  e.STATS.db.prepare('INSERT INTO schedules_snapshot (id, at, body) VALUES (1, ?, ?)').run(snapshot.at, JSON.stringify(snapshot));
  const res = await call(e, '/admin/operations/scheduled?area=testing', owner), html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('CI · E2E') && !html.includes('Product brain') && html.includes('action="/admin/operations/notifications"'), 'the owner gets switches');
});

test('Billed min / week is a lower bound, with the repo named, when a private repo was not read (1 Nov 2026: a confident 0 while jobadabra-lab was unreadable)', () => {
  const job = {repo: 'jobadabra/jobadabra-web', file: 'search-lab.yml', name: 'Search lab', about: '', crons: ['15 */6 * * *'], billedMin: 90, recent: []};
  const tileOf = html => html.match(/<section class="card tile ([^"]*)"><span class="muted">Billed min \/ week<\/span><b>([^<]*)<\/b><span class="muted">([^<]*)<\/span>/).slice(1);
  const read = [{name: 'jobadabra/jobadabra', private: false, ok: true}, {name: 'jobadabra/jobadabra-lab', private: true, ok: true}];
  assert.deepEqual(tileOf(page({at: '2026-10-20T17:00:00Z', repos: read, jobs: [job]}, {now})), ['', '90', 'Mac ×10, Windows ×2; public repos are free'], 'every repo read: the plain number');
  // Through clean(), as the ingest stores it: the collector sends an unread repo as {private: true, ok: false}.
  const unread = clean({at: '2026-10-20T17:00:00Z', repos: [read[0], {name: 'jobadabra/jobadabra-lab', private: true, ok: false}], jobs: [job]});
  assert.deepEqual(tileOf(page(unread, {now})), ['warn', '≥ 90', 'jobadabra-lab not read: its minutes are missing']);
  const two = clean({at: '2026-10-20T17:00:00Z', repos: [{name: 'jobadabra/a', private: true, ok: false}, {name: 'jobadabra/b', private: true, ok: false}], jobs: [job]});
  assert.equal(tileOf(page(two, {now}))[2], 'a, b not read: their minutes are missing');
  const publicUnread = {at: '2026-10-20T17:00:00Z', repos: [{name: 'jobadabra/jobadabra', private: false, ok: false}], jobs: [job]};
  assert.equal(tileOf(page(publicUnread, {now}))[1], '90', 'an unread public repo bills 0 anyway: the number stays');
});
