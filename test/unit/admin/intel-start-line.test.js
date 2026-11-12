// The red line on /admin/testing/e2e and /admin/testing/integrations (owner, 1 Nov 2026: "Red line on the page"): when the Worker's last on-time start of the page's collector failed,
// the page says "collector not starting: <reason>"; a good start clears it. The Worker had no E2E_INTEL_GITHUB_TOKEN and only a console line said so, for both pages, unseen.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {INTEL_COLLECTORS, readStartProblem, recordStarts} from '../../../shared/intel-start.js';
import {page as e2ePage} from '../../../admin/e2e-page.js';
import {page as integrationPage} from '../../../admin/integration-page.js';
import {page as schedulesPage} from '../../../admin/schedules.js';
import {page as buildLogPage} from '../../../admin/build-log.js';
import {startLine} from '../../../admin/intel-start-line.js';

// D1 on real SQLite with every migration, in order, as the deploy applies them.
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {prepare: sql => statement(sql), batch: async statements => { for (const item of statements) await item.run(); }};
}
const seen = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');   // what the owner reads
const hourOf = row => row.hours?.[0] ?? 12;
const tick = (minute, hour = 12) => new Date(Date.UTC(2026, 10, 1, hour, minute));
const PAGES = {'e2e-intel.yml': {path: '/admin/testing/e2e', html: e2ePage}, 'integration-intel.yml': {path: '/admin/testing/integrations', html: integrationPage},
  'schedules-snapshot.yml': {path: '/admin/operations/scheduled', html: schedulesPage}, 'daily-digest.yml': {path: '/admin/agents/build-log', html: (rows, options) => buildLogPage(rows || [], options)},
  'central-scout.yml': {path: '/admin/operations/scheduled', html: schedulesPage}, 'board-discovery.yml': {path: '/admin/operations/scheduled', html: schedulesPage}};   // 12 Nov 2026: every lab timer's refusal shows on the Scheduled page   // 11 Nov 2026: the scout's refusal shows on the Scheduled page, which lists its schedule   // every collector in INTEL_COLLECTORS has a page that draws the line (Why, 1 Nov 2026: the Worker started the snapshot too, #263)

test('a refused start draws "collector not starting: <reason>" on that collector\'s page only, and the next good start clears it', async () => {
  const db = d1();
  for (const {workflow, minute} of INTEL_COLLECTORS) {
    assert.equal(await readStartProblem(db, workflow), null, 'never tried: no line');
    await recordStarts(db, [{workflow, error: 'E2E_INTEL_GITHUB_TOKEN is not set'}], tick(minute));
    const problem = await readStartProblem(db, workflow);
    assert.deepEqual([problem.reason, problem.at], ['E2E_INTEL_GITHUB_TOKEN is not set', tick(minute).toISOString()]);
    for (const [other, {html}] of Object.entries(PAGES)) {
      const drawn = html(null, {problem: await readStartProblem(db, other)});
      assert.equal(/collector not starting: E2E_INTEL_GITHUB_TOKEN is not set/.test(seen(drawn)), other === workflow, `${workflow} failed, page of ${other}`);
    }
    await recordStarts(db, [{workflow}], tick(minute, 13));
    assert.equal(await readStartProblem(db, workflow), null, 'a good start clears the line');
    assert.equal(startLine(null), '');
  }
});

test('a reason is cut and escaped: a long or HTML reason never breaks the page', async () => {
  const db = d1();
  await recordStarts(db, [{workflow: 'e2e-intel.yml', error: `<script>alert(1)</script>${'x'.repeat(500)}`}], tick(40));
  const problem = await readStartProblem(db, 'e2e-intel.yml');
  assert.ok(problem.reason.length <= 200);
  assert.doesNotMatch(startLine(problem), /<script>/);
});

test('the owner\'s case end to end: the Worker tick with no token -> the page of each collector shows the line; with the token the next tick clears it', async () => {
  const STATS = d1(), realFetch = globalThis.fetch, realError = console.error;
  globalThis.fetch = async () => new Response(null, {status: 204});
  console.error = () => {};
  try {
    const env = {STATS, STATS_KEY: 'k3y', STATS_SALT: 'salt', GITHUB_REPO: 'GarryOne/jobadabra', GITHUB_TOKEN: 'site-token', ASSETS: {fetch: () => new Response('asset')}};
    const run = async (minute, withEnv, hour = 12) => { const tasks = []; await worker.scheduled({cron: '*/5 * * * *', scheduledTime: tick(minute, hour).getTime()}, withEnv, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
    const show = async path => (await (await worker.fetch(new Request(`https://www.example.test${path}`, {headers: {Cookie: 'jp_stats=k3y'}}), env, {waitUntil() {}})).text());
    for (const row of INTEL_COLLECTORS) {
      const {workflow, minute, home} = row, hour = hourOf(row);
      // Why (2 Nov 2026, owner: the collectors moved to the public repo, jobadabra#2989): a public collector is started with TIMERS_REPO + TIMERS_GITHUB_TOKEN, one here with E2E_INTEL_*; the line names the token that is missing.
      // The lab's central scout: BRAIN_GITHUB_TOKEN, and the Scheduled page names the workflow because that page is not the scout's own.
      const [tokenName, withToken] = {public: ['TIMERS_GITHUB_TOKEN', {TIMERS_GITHUB_TOKEN: 'timers-token', TIMERS_REPO: 'jobadabra/jobadabra'}], web: ['E2E_INTEL_GITHUB_TOKEN', {E2E_INTEL_GITHUB_TOKEN: 'own-token'}], lab: ['BRAIN_GITHUB_TOKEN', {BRAIN_GITHUB_TOKEN: 'brain-token'}]}[home];
      const named = home === 'lab' ? `${workflow.replace('.', '\\.')}: ` : '';
      await run(minute, {...env, TIMERS_REPO: 'jobadabra/jobadabra'}, hour);
      assert.match(seen(await show(PAGES[workflow].path)), new RegExp(`collector not starting: ${named}${tokenName} is not set`), `${workflow}: no token`);
      await run(minute, {...env, ...withToken}, hour);
      assert.doesNotMatch(seen(await show(PAGES[workflow].path)), /collector not starting/, `${workflow}: the token is set, the next tick clears the line`);
    }
    await run(35, env);
    assert.equal(await readStartProblem(STATS, 'e2e-intel.yml'), null, 'an off-tick writes nothing');
  } finally { globalThis.fetch = realFetch; console.error = realError; }
});

test('when the snapshot and the central scout are both refused, the Scheduled page names both reasons (Gitar on #560: the second must not hide behind the first)', async () => {
  const STATS = d1(), env = {STATS, STATS_KEY: 'k3y', STATS_SALT: 'salt', ASSETS: {fetch: () => new Response('asset')}};
  const show = async () => seen(await (await worker.fetch(new Request('https://www.example.test/admin/operations/scheduled', {headers: {Cookie: 'jp_stats=k3y'}}), env, {waitUntil() {}})).text());
  await recordStarts(STATS, [{workflow: 'central-scout.yml', error: 'BRAIN_GITHUB_TOKEN is not set'}], tick(25, 4));
  assert.match(await show(), /collector not starting: central-scout\.yml: BRAIN_GITHUB_TOKEN is not set/, 'the scout alone');
  await recordStarts(STATS, [{workflow: 'schedules-snapshot.yml', error: 'E2E_INTEL_GITHUB_TOKEN is not set'}], tick(0));
  assert.match(await show(), /collector not starting: E2E_INTEL_GITHUB_TOKEN is not set; central-scout\.yml: BRAIN_GITHUB_TOKEN is not set/, 'both, in one line');
});
