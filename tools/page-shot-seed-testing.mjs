// Demo data for /admin/testing/e2e, /integrations and /pr-checks on tools/page-shot.mjs (5 Nov 2026, admin charts): every section filled, all made up.
// Why (owner, 5 Nov 2026: "transform [the tables] into a more visual representation"): the old Testing seed leaves fails, quality, speed, work and the slowest tests empty, so a before/after
// shot of the charts showed empty messages. Suite names are our own; numbers and run ids are invented; no real user data.
import {weekOf} from '../admin/e2e-work.js';

const DAY = 86400000;
const wave = (n, k) => 0.5 + 0.5 * Math.abs(Math.sin(n * 1.3 + k * 2.1));   // a repeatable "random" between 0.5 and 1: the same shots every run

/** @param {{env: object}} context the seed context of tools/worker-server.mjs */
export async function testingFull({env}) {
  const now = new Date(), day = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);
  const put = (table, body) => env.STATS.prepare(`INSERT INTO ${table} (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body`).bind(now.toISOString(), JSON.stringify(body)).run();
  const days = Array.from({length: 30}, (_, back) => {
    const red = back % 6 === 2, merges = 3 + (back % 3), mergeReds = back % 7 === 4 ? 1 : 0;
    return [{day: day(back), kind: 'nightly', runs: 1, greens: red ? 0 : 1, reds: red ? 1 : 0, redMin: red ? 38 : 0}, {day: day(back), kind: 'after-merge', runs: merges, greens: merges - mergeReds, reds: mergeReds, redMin: mergeReds * 12},
      {day: day(back), kind: 'beta', runs: 1, greens: back % 4 === 1 ? 0 : 1, reds: back % 4 === 1 ? 1 : 0, redMin: back % 4 === 1 ? 29 : 0},
      {day: day(back), kind: 'pr', runs: 5 + (back % 4), greens: 4 + (back % 3), reds: 1, redMin: 10, queueMin: Math.round(40 * wave(back, 1)), runMin: Math.round(95 * wave(back, 2))}];
  }).flat();
  const SUITES = ['apply', 'jobs', 'strategy', 'quality', 'interactions', 'wander', 'updates', 'onboarding'], CAUSES = ['test', 'flake', 'timing', 'product', 'ci', 'ai', 'drift', 'runner'];
  const fails = Array.from({length: 30}, (_, back) => [0, 1, 2].map(k => ({day: day(back), kind: k === 2 ? 'pr' : 'nightly', suite: SUITES[(back + k * 3) % SUITES.length], platform: (back + k) % 4 === 0 ? 'windows' : 'mac', cause: CAUSES[(back * 2 + k) % CAUSES.length],
    n: 1 + ((back + k) % 3), min: Math.round(24 * wave(back, k))}))).flat().filter((_, index) => index % 2 === 0);
  const quality = Array.from({length: 10}, (_, back) => { const pairs = 24, big = back % 4 === 1 ? 2 : back % 7 === 3 ? 1 : 0, within8 = pairs - big - (back % 3);
    return {day: day(back), runId: 9300 - back, pairs, within8, over20: big, factsExact: 38 + (back % 3), factsTotal: 40, invented: back % 5 === 0 ? 1 : 0, judged: 48, promptCases: {status: 'carried', right: 28, total: 30}}; });
  const speedRuns = Array.from({length: 24}, (_, back) => ({runId: 9400 - back, createdAt: new Date(now.getTime() - back * 0.9 * DAY).toISOString(), kind: back % 3 === 0 ? 'scheduled' : back % 3 === 1 ? 'nightly' : 'after-merge',
    suiteJobs: SUITES.map((suite, index) => ({suite, seconds: Math.round((120 + index * 95) * (0.7 + 0.8 * wave(back, index)))}))}));
  const work = Array.from({length: 30}, (_, back) => ['product', 'expectations', 'plumbing', 'tests', 'other'].map((kind, index) => ({day: day(back), kind, commits: Math.round(1 + 4 * wave(back, index) * (kind === 'plumbing' ? 0.5 : 1))}))).flat();
  const files = ['.github/workflows/e2e.yml', 'desktop/e2e/lib/harness.mjs', 'tools/ship.sh', 'desktop/e2e/suites/apply.mjs', 'desktop/e2e/lanes.json', 'tools/ci-intel/jobs/e2e-intel.mjs'].map((file, index) => ({week: weekOf(day(0)), file, commits: 9 - index}));
  const escapes = [{week: weekOf(day(1)), sha: 'abc1234', journey: 'Save a job from the extension', suites: ['jobs'], none: false}, {week: weekOf(day(8)), sha: 'def5678', journey: 'Undo a status change', suites: ['apply', 'strategy'], none: false}, {week: weekOf(day(9)), sha: '0a1b2c3', journey: 'Export the tracker', suites: [], none: true}];
  const caught = [{day: day(1), kind: 'pr', runId: 9004, suite: 'apply', line: 'demo catch', pr: 1}, {day: day(3), kind: 'after-merge', runId: 9003, suite: 'jobs', line: 'demo catch'}, {day: day(4), kind: 'pr', runId: 9002, suite: 'jobs', line: 'demo catch', pr: 2}];
  await put('e2e_snapshot', {schema: 2, at: now.toISOString(), days, fails, breaks: [], work, workFiles: files, quality, speedRuns, escapes, caught,
    latest: [{runId: 9010, day: day(0), kind: 'after-merge', conclusion: 'success', minutes: 14}, {runId: 9009, day: day(0), kind: 'beta', conclusion: 'success', minutes: 31}, {runId: 9008, day: day(1), kind: 'nightly', conclusion: 'failure', minutes: 22}]});
  const runs = ['extension', 'app', 'store'].flatMap((layer, index) => Array.from({length: 30}, (_, back) => ({runId: 9500 - back * 3 - index, layer, platform: 'linux', day: day(back), on: 'main', sha: 'abc1234', conclusion: back % (9 + index * 4) === 3 ? 'failure' : 'success',
    tests: [64, 118, 41][index], failed: 0, ms: Math.round([32000, 95000, 18000][index] * (0.8 + 0.4 * wave(back, index)))})));
  await put('integration_snapshot', {schema: 1, at: now.toISOString(), read: [], counts: {extension: {tests: 64, files: 9}, app: {tests: 118, files: 16}, store: {tests: 41, files: 6}}, flaky: [], open: [], runs,
    slowest: [['app', 'opens the tracker with 500 jobs', 9400], ['extension', 'fills a long application form', 7100], ['app', 'imports a CSV with 2,000 rows', 5600], ['store', 'dedupes a month of jobs', 3900], ['app', 'switches language twice', 2800], ['extension', 'reads a recorded page', 2100],
      ['store', 'scores 300 jobs', 1500], ['app', 'renders the empty state', 900], ['store', 'opens a fresh store', 400], ['extension', 'parses a salary line', 180]].map(([layer, test, ms], index) => ({layer, test, file: `integration/${layer}/${layer}-${index}.test.js`, ms})),
    move: {days: Array.from({length: 14}, (_, back) => ({day: day(13 - back), e2eSteps: 420 - back * 9, e2eSuites: 40, integration: {extension: 50 + back * 2, app: 90 + back * 4, store: 30 + back}})), lanes: 38}});
  const checks = [['CI · Integration tests', 80, 9, 6, 2, 4, 8, 1, 'proven'], ['CI · Smoke (the app starts)', 80, 3, 2, 0, 3, 4, 0, 'proven'], ['CI · Unit tests', 80, 5, 3, 1, 5, 9, 2, 'proven'], ['CI · Site audit', 40, 2, 0, 2, 6, 14, 5, 'review'],
    ['CI · Lint and types', 80, 7, 4, 1, 2, 3, 0, 'proven'], ['CI · Layout check', 30, 1, 0, 1, 7, 12, 4, 'review']];
  await env.STATS.prepare('INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET card = excluded.card').bind(day(0).slice(0, 7),
    JSON.stringify({days: 30, checks: checks.map(([name, runs, reds, realCatches, falseReds, medianMin, p90Min, addedMin, verdict]) => ({name, runs, reds, realCatches, falseReds, medianMin, p90Min, addedMin, verdict}))}), now.toISOString()).run();
  await env.STATS.prepare('INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET card = excluded.card').bind(new Date(now.getTime() - 31 * DAY).toISOString().slice(0, 7),
    JSON.stringify({days: 30, checks: checks.map(([name, runs, reds, realCatches, falseReds, medianMin, p90Min, addedMin, verdict]) => ({name, runs, reds, realCatches: Math.max(0, realCatches - 1), falseReds, medianMin, p90Min, addedMin, verdict}))}), now.toISOString()).run();
}

/** Self-healing with its three periods and the resolution labels: the older 'self-healing' seed, then its newest snapshot gets `periods` and `causes`. Made-up numbers. */
export async function healFull({env}, seeds) {
  await seeds['self-healing']({env});
  const row = await env.STATS.prepare('SELECT day, body FROM selfheal_snapshots ORDER BY day DESC LIMIT 1').first(), body = JSON.parse(row.body);
  const detectors = ['AI screenshot review', 'AI code review', 'Recorded replay mismatch', 'Console errors', 'Layout and DOM checks', 'Interaction probe'];
  const period = scale => { const byDetector = detectors.map((detector, i) => ({detector, filed: Math.round((40 - i * 6) * scale), fixed: Math.round((6 - i / 2) * scale), queued: Math.round(2 * scale), falsePositive: Math.round((9 - i) * scale), harness: i % 2 ? 1 : 0,
    duplicate: Math.round(3 * scale), stale: i % 3 ? 1 : 0, unclear: Math.round((4 + i) * scale), open: i < 2 ? 3 : 0}));
    const sum = key => byDetector.reduce((n, d) => n + (d[key] || 0), 0), real = sum('fixed') + sum('queued');
    return {totals: {filed: sum('filed'), fixed: sum('fixed'), queued: sum('queued'), falsePositive: sum('falsePositive'), harness: sum('harness'), duplicate: sum('duplicate'), stale: sum('stale'), unclear: sum('unclear'), open: sum('open'), real, judged: real + sum('falsePositive') + sum('harness'), precision: 62}, byDetector, cost: {usd: 3.2 * scale, runs: 12, perRealBug: 0.05}}; };
  body.periods = {all: period(1), last7: period(0.35), cutoff: period(0.7)};
  body.causes = {fixed: 41, 'not-seen': 14, duplicate: 12, 'fp:detector': 9, 'fp:harness': 7, 'by-design': 5, 'stale-sighting': 4, 'fp:probe-race': 2};
  await env.STATS.prepare('UPDATE selfheal_snapshots SET body = ? WHERE day = ?').bind(JSON.stringify(body), row.day).run();
}
