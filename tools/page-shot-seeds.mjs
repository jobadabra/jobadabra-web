// Demo data for tools/page-shot.mjs: made-up rows only (codes, labels, people), never a real secret or the live site's data. Each seed gets {env, call}: call(path, init) goes through the real Worker as the owner.
import {ACTIONS} from '../shared/aicost.js';
import {LAB_REPO, PUBLIC_REPO, WEB_REPO, githubUrl} from '../shared/repos.js';
const form = fields => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(fields)});

export const seeds = {
  website: async ({env}) => {   // made-up visitors and downloaders for /admin/growth/website (1 Nov 2026): 30 days, busiest 5 days ago, a quiet day after it; person ids are made up
    const week = [[8, 6], [6, 9], [8, 6], [17, 1], [5, 2], [7, 4], [8, 3]], rows = [];
    for (let back = 29; back >= 0; back--) {
      const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10), [visitors, downloads] = week[(6 - back % 7 + 7) % 7].map(value => value + (back % 4 === 0 ? 2 : 0));
      for (let i = 0; i < visitors; i++) rows.push(['visits', day, `demo${day}-${i}`, 'direct', ['DE', 'FR', 'IT', 'ES'][i % 4], ['Mac', 'Windows', 'iPhone'][i % 3], '/']);
      for (let i = 0; i < downloads; i++) rows.push(['downloads', day, `demo${day}-${i}`, 'direct', ['DE', 'FR', 'IT', 'ES'][i % 4], ['Mac', 'Windows', 'iPhone'][i % 3], '/']);
    }
    for (const [table, day, visitor, source, country, device, page] of rows) {
      const extra = table === 'downloads' ? ", 'mac', 'hero'" : '', cols = table === 'downloads' ? ', platform, button' : '';
      await env.STATS.prepare(`INSERT INTO ${table} (day, at, visitor, page, source, country, device${cols}) VALUES (?, ?, ?, ?, ?, ?, ?${extra})`).bind(day, `${day}T12:00:00Z`, visitor, page, source, country, device).run();
    }
  },
  'lab-form-filling': async ({env}) => {   // made-up recorded sites on the usual form platforms, a week of smoke runs: fills, a left field, a bot check, a regression (26 Oct 2026, admin on a phone)
    const {ingest} = await import('../admin/applying.js');
    const hosts = ['job-boards.greenhouse.io', 'jobs.lever.co', 'demo.wd5.myworkdayjobs.com', 'jobs.ashbyhq.com', 'apply.workable.com', 'career5.successfactors.eu', 'jobs.smartrecruiters.com', 'careers.demo-company.example'];
    const sites = hosts.flatMap((host, i) => [0, 1].map(j => ({name: `Demo site ${i * 2 + j + 1}`, start_host: host, signature: `posting>form@${host}#${j ? 'form' : 'ready'}`})));
    const today = new Date();
    await ingest(env.STATS, {kind: 'pool', day: today.toISOString().slice(0, 10), rows: sites}, today);
    for (let back = 6; back >= 0; back--) {
      const at = new Date(today.getTime() - back * 86400000), day = at.toISOString().slice(0, 10);
      await ingest(env.STATS, {kind: 'smoke', day, version: `0.9.${190 + 6 - back}`, rows: sites.map((site, n) => ({name: site.name, host: site.start_host,
        reached: n % 7 === 3 ? 'code/bot' : n % 5 === 4 ? 'form' : 'ready', filled: 6 + (n * 3 + back) % 9, left: (n + back) % 4 === 0 ? 1 : 0, regression: back === 0 && n === 5}))}, at);
    }
  },
  'agent-coding': async ({env}) => {   // made-up push-gate and CI days over 8 weeks: form stops dominating, fixes mostly product, one area circling this week (1 Nov 2026)
    const {ingest} = await import('../admin/agent-coding.js');
    const now = new Date(), put = (kind, days) => ingest(new Request('https://x/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify({kind, days})}), {STATS: env.STATS, SELFHEAL_PUBLISH_KEY: 'k'}, now);
    const gate = [], ci = [], areas = ['desktop/renderer', 'src/ai', 'extension', 'desktop/main', 'src/sources', 'app-core/src', 'worker/src', 'desktop/lib', 'src/stores'];
    const checks = [['desktop (clean checkout)', 'real', 400], ['spec proof', 'form', 55], ['file size', 'form', 9], ['stale expectations', 'form', 14], ['recorded cases', 'form', 21], ['python (clean checkout)', 'real', 310], ['journey gate', 'real', 150], ['why comments', 'form', 6]];
    for (let back = 55; back >= 0; back--) {
      const day = new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10), weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()), n = weekend ? 3 : 9 + (back * 7) % 8, week = Math.floor(back / 7);
      const form = Math.round(n * (0.35 + 0.08 * ((back * 5) % 4))), real = Math.round(n * (0.06 + 0.02 * (week % 3))), other = back % 5 === 0 ? 1 : 0;
      gate.push({day, pushes: n, secs: n * 70, stopped: {form, real, other}, stoppedSecs: {form: form * 55, real: real * 190, other: other * 40},
        steps: Object.fromEntries(checks.map(([name, cls, secs], i) => [name, {runs: n, fails: cls === 'form' ? Math.round(form / (i + 1)) : Math.round(real / 2), secs: n * secs / 10, cls}]))});
      const merged = weekend ? 2 : 6 + (back * 3) % 6, circling = week === 0 && !weekend;
      ci.push({day, prs: {merged, ci: Math.round(merged * (0.7 - week * 0.04))}, reds: {product: 3 + back % 3, test: 2 + back % 2, ci: 1 + back % 3, form: 2 + (back + 1) % 3, nofix: back % 4 === 0 ? 1 : 0},
        fixPrs: Object.fromEntries(areas.filter((_, i) => (back + i) % 3 === 0 || (circling && i === 0)).map((area, i) => [area, circling && i === 0 ? (back < 3 ? 2 : 1) : 1])),
        wall: Array.from({length: merged + 3}, (_, i) => 9 + ((i * 7 + back) % 20) + week * 0.4), queue: Array.from({length: merged + 3}, (_, i) => 0.4 + ((i + back) % 5) * 0.3), cancelledMin: merged * 2.1});
    }
    await put('gate', gate.slice(-30)); await put('gate', gate.slice(0, 26)); await put('ci', ci.slice(-30)); await put('ci', ci.slice(0, 26));
  },
  'agent-coding-sdlc': async ({env}) => {   // the SDLC tab (1 Nov 2026): the real cards in $SDLC_REAL_DIR (gate-days.json, sdlc.json from tools/sdlc-stats.mjs) when set, else made-up days
    const {ingest} = await import('../admin/agent-coding.js');
    const {readFileSync, existsSync} = await import('node:fs');
    const put = body => ingest(new Request('https://x/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify(body)}), {STATS: env.STATS, SELFHEAL_PUBLISH_KEY: 'k'});
    const dir = process.env.SDLC_REAL_DIR;
    if (dir && existsSync(`${dir}/sdlc.json`)) { for (const file of ['gate-days.json', 'sdlc.json']) if (existsSync(`${dir}/${file}`)) await put(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))); return; }
    const now = new Date(), days = Array.from({length: 14}, (_, i) => new Date(now.getTime() - (13 - i) * 86400000).toISOString().slice(0, 10));
    // Made-up gate days with agent-hook blocks (1 Nov 2026), so the Agent hooks row shows its filled form.
    await put({kind: 'gate', days: days.slice(-7).map((day, i) => ({day, pushes: 6, secs: 900, stopped: {form: 1, real: 0, other: 0}, stoppedSecs: {form: 20, real: 0, other: 0}, steps: {}, hooks: {'guard-primary-checkout': i % 3 === 0 ? 2 : 0, 'foreground-long-run': 1 + i % 2, 'session-cap': i === 6 ? 1 : 0}}))});
    const checks = [['CI · Tests · python', 3.7, 9], ['CI · Tests · desktop', 2.8, 12], ['CI · Harness tests', 2.1, 3], ['CI · Pull request', 0.6, 1], ['CI · Tests · worker', 1.4, 5]];
    await put({kind: 'sdlc', days: days.map((day, i) => ({day, bugs: i % 4 === 0 ? 1 : 0, phases: {merged: 20 + i, nospec: 6 + i % 3, unmerged: 1 + i % 2, prCommits: 60 + i, fixAfter: 3 + i % 4, reverts: i % 5 === 0 ? 1 : 0, redMain: i % 3 === 0 ? 1 : 0},
      layers: {pr: Object.fromEntries(checks.map(([name, mins, fails], c) => [name, {runs: 60 + i, fails: fails + i % 3, secs: (60 + i) * mins * 60, catches: {product: c < 2 ? 3 : 0, test: c === 1 ? 2 : 0, ci: 1, form: c === 3 ? 4 : 1, flaky: c === 2 ? 3 : 0, nofix: 1}}])), main: {}, night: {}}}))});
  },
  'schedules': async ({env}) => {   // made-up scheduled jobs in every area (1 Nov 2026, Testing → Scheduled and the Schedules section): real workflow names, invented runs
    const now = Date.now(), run = (hoursAgo, conclusion) => ({at: new Date(now - hoursAgo * 3600000).toISOString(), conclusion, mins: 4, url: githubUrl(PUBLIC_REPO) + '/actions/runs/1'});
    const job = (repo, file, name, about, crons, conclusions, extra = {}) => ({repo, file, name, about, crons, source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 60, billedMin: 0, recent: conclusions.map((conclusion, i) => run(i * 24 + 3, conclusion)), ...extra});
    const ok = Array(10).fill('success'), pub = PUBLIC_REPO, web = WEB_REPO;
    const jobs = [job(pub, 'e2e.yml', 'CI · E2E', 'Journeys on main, nightly burn-in', ['47 21,23,1 * * *'], ['failure', ...ok], {source: 'worker', billedMin: 0}), job(pub, 'desktop.yml', 'CI · Desktop beta', 'One lane per platform', ['0 4 * * *'], ok, {source: 'both'}),
      job(pub, 'mutation.yml', 'CI · Mutation', 'Does the Finder catch serious bugs?', ['30 3 * * 1'], ok), job(pub, 'harness-daily.yml', 'CI · Harness daily', 'Every harness test once a day', ['10 5 * * *'], ['failure', 'failure', ...ok]),
      job(pub, 'page-cases.yml', 'CI · Page cases', 'Replays all recorded cases', ['20 2 * * *'], ok), job(pub, 'windows-smoke.yml', 'CI · Windows smoke', 'The installer starts', ['40 6 * * *'], ok), job(pub, 'code-review.yml', 'CI · Code review', 'Review of open PRs', ['0 */4 * * *'], ok, {ai: true}),
      job(pub, 'finder-review.yml', 'Finder review', 'The Finder learns from its own week', ['0 7 * * 1'], ok), job(web, 'search-lab.yml', 'Search lab', 'Fictional candidates, live search', ['15 */6 * * *'], ok, {billedMin: 90}),
      job(web, 'e2e-intel.yml', 'E2E intel', 'Collects e2e runs', ['25 * * * *'], ok), job(web, 'hosted-e2e.yml', 'Hosted e2e', 'The hosted flow end to end', ['5 4 * * *'], ok),
      job(pub, 'central-scout.yml', 'Central scout', 'Employer feeds, daily', ['0 3 * * *'], ok), job(web, 'random-draw.yml', 'Random draw', 'Random searches across Europe', ['0 */8 * * *'], ok), job(web, 'daily-digest.yml', 'Daily digest', 'The morning Telegram digest', ['30 6 * * *'], ok, {ai: true}),
      job(web, 'ops-overview.yml', 'CI · Ops overview', 'Merged PRs by category', ['17 * * * *'], ok, {billedMin: 40}), job(pub, 'release-guard.yml', 'Release guard', 'Only desktop-v* may be Latest', ['5 * * * *'], ok),
      job(web, 'schedules-snapshot.yml', 'Schedules snapshot', 'This page\'s feed', ['12 * * * *'], ok), job(pub, 'schedule-watchdog.yml', 'Schedule watchdog', 'Did the Worker start runs on time?', ['50 * * * *'], ok)];
    await env.STATS.prepare('INSERT INTO schedules_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(new Date(now).toISOString(), JSON.stringify({schema: 1, at: new Date(now).toISOString(), repos: [{name: pub, private: false, ok: true}, {name: web, private: true, ok: true}, {name: LAB_REPO, private: true, ok: false}], jobs})).run();
  },
  'schedules-not-starting': async context => {   // the Scheduled page when the Worker's last start of schedules-snapshot.yml was refused (1 Nov 2026, #263): the red "collector not starting" line
    await seeds.schedules(context);
    await context.env.STATS.prepare('INSERT INTO intel_start (workflow, at, ok, reason) VALUES (?, ?, 0, ?)').bind('schedules-snapshot.yml', new Date().toISOString(), 'E2E_INTEL_GITHUB_TOKEN is not set (the site GITHUB_TOKEN covers the public repo, not this one)').run();
  },
  'self-healing': async ({env}) => {   // made-up snapshots of the self-healing loop over 10 days, with long issue titles and detector names (26 Oct 2026, admin on a phone)
    const today = Date.now();
    for (let back = 9; back >= 0; back--) {
      const at = new Date(today - back * 86400000).toISOString(), real = 20 + back;
      const body = {schema: 1, at, totals: {filed: 95 - back, fixed: 19, queued: real - 19, falsePositive: 22, duplicate: 10, harness: 6, unclear: 25, open: 6, real, precision: 54},
        byDetector: ['AI screenshot review', 'AI code review of the latest merged pull requests', 'Recorded replay mismatch', 'Console errors'].map((detector, i) => ({detector, filed: 38 - i * 7, fixed: 4 + i, queued: 7, falsePositive: 10 - i, duplicate: 3, harness: i, unclear: 6, open: 1})),
        fixer: {opened: 8, merged: 2, landed: 5, closed: 4, open: 0}, verdicts: {real: 9, falsePositive: 8}, cost: {usd: 1.06, runs: 12, byJob: {review: 0.6, fixer: 0.46}, perRealBug: 0.04},
        recall: {planted: 13, caught: 11, missed: ['page-overflow', 'a11y-contrast']}, quality: {mutation: {rate: 100, note: '12 of 12 planted code bugs caught'}, escape: {rate: 66, note: '68 of 103 bugs found outside the Finder'}}, daily: [{day: at.slice(0, 10), filed: 33, real: 20, falsePositive: 9}],
        notable: [1, 2, 3, 4].map(n => ({number: 100 + n, title: `Demo issue ${n}: a long made-up title that names a component, the symptom and where_it_happens_in_some/long/path/file-name.js`, url: `https://github.com/demo/demo/issues/${100 + n}`,
          detector: 'AI code review', status: n % 2 ? 'fixed' : 'queued', severity: 'medium'}))};
      await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(at.slice(0, 10), at, JSON.stringify(body)).run();
    }
  },
  'testing-overview': async ({env}) => {   // the Testing Overview (1 Nov 2026): made-up e2e / integration / self-healing / scorecard rows; the workflows' last runs are the real ones in $TESTING_OVERVIEW_REAL_DIR/schedules.json (jobs/schedules-snapshot.mjs --dry --out) when set
    const {clean} = await import('../admin/schedules.js');
    const {readFileSync, existsSync} = await import('node:fs');
    const now = new Date(), day = back => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10), put = (table, body, at = now.toISOString()) => env.STATS.prepare(`INSERT INTO ${table} (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body`).bind(at, JSON.stringify(body)).run();
    const dir = process.env.TESTING_OVERVIEW_REAL_DIR, real = dir && existsSync(`${dir}/schedules.json`) ? JSON.parse(readFileSync(`${dir}/schedules.json`, 'utf8')) : null;
    const demoRun = (conclusion, hours, n) => ({at: new Date(now.getTime() - hours * 3600000).toISOString(), conclusion, mins: 4, url: `${githubUrl(PUBLIC_REPO)}/actions/runs/${n}`});
    const demoJob = (file, name, crons, recent) => ({repo: PUBLIC_REPO, file, name, about: '', crons, source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
    await put('schedules_snapshot', clean(real || {at: now.toISOString(), repos: [{name: PUBLIC_REPO, private: false, ok: true}], jobs: [demoJob('e2e.yml', 'CI · End-to-end on Mac + Linux', ['47 21,23,1 * * *'], [demoRun('success', 14, 1)]),
      demoJob('desktop.yml', 'Release · Build, test, beta', ['17 5 * * *'], [demoRun('success', 9, 2)]), demoJob('integration.yml', 'CI · Integration tests', [], [demoRun('success', 3, 3)]), demoJob('smoke.yml', 'CI · Smoke (the app starts)', [], [demoRun('failure', 5, 4)]),
      demoJob('site-replays.yml', 'CI · Replay check', [], [demoRun('failure', 121, 41100)]), demoJob('record-sites.yml', 'CI · Record sites', ['0 7 * * *'], [demoRun('success', 11, 41350)]),   // the pool card (2 Nov 2026): a by-hand replay run, 5 days old and red, beside the daily recording, green
      demoJob('mutation.yml', 'CI · Planted code bugs', ['0 1 * * 0'], [demoRun('success', 80, 5)]), demoJob('fresh-install-smoke.yml', 'CI · Fresh-install smoke (daily, report only)', ['23 3 * * *'], [demoRun('success', 9, 41349028793)]), demoJob('upgrade-data.yml', 'CI · Upgrade + data test (weekly, report only)', ['41 4 * * 1', '41 5 1 * *'], [demoRun('success', 6, 41344619739)]), demoJob('code-review.yml', 'CI · AI code review', ['10 */8 * * *'], [demoRun('success', 4, 6)])]}));
    const suiteNight = (suite, back, green, runId) => ({runId, day: day(back), kind: 'nightly', suite, platform: 'mac', green});
    const e2eDays = Array.from({length: 14}, (_, back) => [{day: day(back), kind: 'nightly', runs: 1, greens: back % 5 === 1 ? 0 : 1, reds: back % 5 === 1 ? 1 : 0}, {day: day(back), kind: 'after-merge', runs: 3, greens: 3 - (back === 4 ? 1 : 0), reds: back === 4 ? 1 : 0}, {day: day(back), kind: 'beta', runs: 1, greens: 1, reds: 0}]).flat();
    const nights = suite => Array.from({length: 14}, (_, back) => suiteNight(suite, back, !(suite === 'quality' && back % 3 === 1) && !(suite === 'interactions' && back === 6), 9000 - back));
    await put('e2e_snapshot', {schema: 2, at: now.toISOString(), days: e2eDays, fails: [], breaks: [], work: [], workFiles: [], quality: [],
      latest: [{runId: 9010, day: day(0), kind: 'after-merge', conclusion: 'success', minutes: 14}, {runId: 9009, day: day(0), kind: 'beta', conclusion: 'success', minutes: 31}, {runId: 9008, day: day(1), kind: 'nightly', conclusion: 'failure', minutes: 22}],
      suiteNights: [...nights('interactions'), ...nights('wander'), ...nights('quality')], caught: [{day: day(1), kind: 'scheduled', runId: 9004, suite: 'apply', line: 'demo'}, {day: day(2), kind: 'after-merge', runId: 9003, suite: 'jobs', line: 'demo'}, {day: day(3), kind: 'pr', runId: 9001, suite: 'jobs', line: 'demo', pr: 1},
        {day: day(5), kind: 'nightly', runId: 9002, suite: 'quality', line: 'demo'}, {day: day(12), kind: 'beta', runId: 8990, suite: 'apply', line: 'demo'}]});   // every run kind: a product red counts wherever it was caught (2 Nov 2026)
    await put('integration_snapshot', {schema: 1, at: now.toISOString(), read: [], counts: {}, flaky: [], open: [], slow: [], move: {days: []}, runs: Array.from({length: 14}, (_, back) => ({runId: 9100 - back, layer: 'app', platform: 'linux', day: day(back), on: 'main', sha: 'abc1234', conclusion: back === 9 ? 'failure' : 'success', tests: 120, failed: back === 9 ? 1 : 0, ms: 90000}))});
    await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(day(0), now.toISOString(), JSON.stringify({schema: 1, at: now.toISOString(), totals: {filed: 40, real: 12}, byDetector: [],
      periods: {last7: {totals: {}, byDetector: [{detector: 'AI screenshot review', fixed: 3, queued: 1}, {detector: 'AI code review', fixed: 2, queued: 0}, {detector: 'Interaction probe', fixed: 0, queued: 1}, {detector: 'Layout and DOM checks', fixed: 1, queued: 0}]}},
      quality: {mutation: {rate: 100, note: '12 of 12 planted code bugs caught'}}, recall: {planted: 13, caught: 11, missed: ['page-overflow', 'a11y-contrast']}})).run();
    await env.STATS.prepare('INSERT INTO pr_check_months (month, card, updated_at) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET card = excluded.card').bind(day(0).slice(0, 7), JSON.stringify({days: 30, checks: [{name: 'CI · Integration tests', runs: 80, reds: 9, realCatches: 6, falseReds: 2, medianMin: 4, p90Min: 8, addedMin: 1, verdict: 'proven'},
      {name: 'CI · Smoke (the app starts)', runs: 80, reds: 3, realCatches: 2, falseReds: 0, medianMin: 3, p90Min: 4, addedMin: 0, verdict: 'proven'}]}), now.toISOString()).run();
  },
  'synthetic-card': async ({env}) => {   // Overview's synthetic-monitoring card (1 Nov 2026; re-runnable: the phone check seeds every seed into one database, and the stale seed runs this one again): the testing-overview seed plus 14 days of made-up probe rounds (every 3 h, the newest 4 min ago); monitoring began 12 days ago, the broker was red twice in a row 5 days ago and is down now
    await seeds['testing-overview']({env});
    const now = Date.now(), probes = ['broker', 'free-ai', 'index', 'license', 'site', 'updates'], statements = [];
    const at = back => new Date(now - back * 3 * 3600000 - 4 * 60000).toISOString().slice(0, 16) + ':00Z';
    for (let back = 0; back < 12 * 8; back++) for (const probe of probes) {
      const red = probe === 'broker' && (back < 2 || back === 40 || back === 41);
      statements.push(env.STATS.prepare('INSERT OR REPLACE INTO synthetic_probes (probe, at, ok, ms, reason) VALUES (?, ?, ?, ?, ?)').bind(probe, at(back), red ? 0 : 1, 180 + back % 7 * 40, red ? 'HTTP 503' : ''));
    }
    for (const probe of probes) statements.push(env.STATS.prepare('INSERT OR REPLACE INTO synthetic_state (probe, state, since, red_since, streak, reason, told) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .bind(probe, probe === 'broker' ? 'down' : 'up', probe === 'broker' ? at(1) : at(95), probe === 'broker' ? at(1) : '', probe === 'broker' ? 2 : 0, probe === 'broker' ? 'HTTP 503' : ''));
    await env.STATS.batch(statements);
  },
  'synthetic-monitoring': async ({env}) => {   // Testing -> Synthetic Monitoring (1 Nov 2026): the synthetic-card probe rounds (broker down) plus the four live-looking workflows in the schedules snapshot, the daily watch list red on its last run
    await seeds['synthetic-card']({env});
    const snapshot = JSON.parse((await env.STATS.prepare('SELECT body FROM schedules_snapshot WHERE id = 1').first()).body), now = Date.now();
    const {prevOf} = await import('../shared/schedules-model.js');   // runs sit on the job's own schedule (newest = its last due time), so no row reads "late"
    const runs = (cron, every, bad = []) => Array.from({length: 14}, (_, i) => ({at: new Date(prevOf([cron], new Date(now)).getTime() + 120000 - i * every * 3600000).toISOString(), conclusion: bad.includes(i) ? 'failure' : 'success', mins: 2, url: `${githubUrl(PUBLIC_REPO)}/actions/runs/${7000 + i}`}));
    const job = (file, name, crons, recent) => ({repo: PUBLIC_REPO, file, name, about: '', crons, source: 'github', manual: false, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
    snapshot.jobs.push(job('release-guard.yml', 'Release · Guard Latest', ['23 * * * *'], runs('23 * * * *', 1)), job('schedule-watchdog.yml', 'CI · Schedule watchdog', ['23 * * * *'], runs('23 * * * *', 1)),
      job('fresh-install-smoke.yml', 'CI · Fresh-install smoke (daily, report only)', ['23 3 * * *'], runs('23 3 * * *', 24, [])), job('stable-canary.yml', 'CI · Stable canary', ['23 6 * * *'], runs('23 6 * * *', 24, [5])), job('watch-live.yml', 'CI · Daily watch list', ['0 5 * * *'], runs('0 5 * * *', 24, [0, 1])));
    await env.STATS.prepare('INSERT INTO schedules_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(new Date(now).toISOString(), JSON.stringify(snapshot)).run();
  },
  'synthetic-card-stale': async ({env}) => {   // the same card when no probe round has run for 3 hours: red "no round", never a stale green (1 Nov 2026)
    await seeds['synthetic-card']({env});
    await env.STATS.prepare('DELETE FROM synthetic_probes WHERE at > ?').bind(new Date(Date.now() - 3 * 3600000).toISOString()).run();
  },
  'nightly-trends': async ({env}) => {   // the nightly report-only numbers on Testing → Overview and Testing → Scheduled (1 Nov 2026): 14 made-up nights of Quality AI, prompt cases, interactions rates, wander, real Notion, agent coding and the wall clocks, over the overview and schedules seeds
    const now = new Date(), day = back => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10), put = (table, body) => env.STATS.prepare(`INSERT INTO ${table} (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body`).bind(now.toISOString(), JSON.stringify(body)).run();
    const read = async table => JSON.parse((await env.STATS.prepare(`SELECT body FROM ${table} WHERE id = 1`).first()).body);
    await seeds.schedules({env});
    const scheduled = (await read('schedules_snapshot')).jobs;
    await seeds['testing-overview']({env});
    const overview = await read('schedules_snapshot'), have = new Set(overview.jobs.map(job => job.file));
    const run = (hours, conclusion) => ({at: new Date(now.getTime() - hours * 3600000).toISOString(), conclusion, mins: 6, url: githubUrl(PUBLIC_REPO) + '/actions/runs/7'});
    const extra = (repo, file, name, about, crons, conclusions) => ({repo, file, name, about, crons, source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 30, billedMin: 0, recent: conclusions.map((c, i) => run(i * 24 + 4, c))});
    const ok = Array(10).fill('success');
    await put('schedules_snapshot', {...overview, jobs: [...overview.jobs, ...scheduled.filter(job => !have.has(job.file)),
      extra(PUBLIC_REPO, 'prompt-cases-night.yml', 'CI · Prompt cases (nightly, report only)', 'Last night\'s right/wrong of the live prompt cases', ['30 21 * * *'], ok),
      extra(PUBLIC_REPO, 'agent-coding-stats.yml', 'CI · Agent coding stats', 'Fix PRs per area, CI minutes per push', ['41 4 * * *'], ok)]});
    const snapshot = await read('e2e_snapshot');
    const agree = [8, 9, 8, 8, 7, 9, 8, 6, 7, 8, 9, 8, 9, 8], replay = back => ({status: back % 5 === 3 ? 'carried' : 'asked', total: 63, right: back === 2 ? 58 : 60 + (back % 3 === 0 ? 1 : 0), flipped: back === 2 ? 2 : 0, noise: back % 4, newWrong: 0, unconfirmed: 0, calls: back % 5 === 3 ? 0 : 66});
    const quality = Array.from({length: 14}, (_, back) => ({runId: 9500 - back, day: day(back), pairs: 9, within8: agree[back], over20: back === 7 ? 1 : 0, factsExact: 63, factsTotal: 63, judged: 18, invented: back % 6 === 0 ? 1 : 0, promptCases: replay(back)}));
    const night = (suite, back, green, rates = {}) => ({runId: 9200 - back, day: day(back), kind: 'nightly', suite, platform: 'mac', green, ...(Object.keys(rates).length ? {rates} : {})});
    const suiteNights = [...Array.from({length: 14}, (_, back) => night('wander', back, back !== 4 && back !== 9)), ...Array.from({length: 14}, (_, back) => night('notion-real', back, back !== 6)),
      ...Array.from({length: 14}, (_, back) => night('quality', back, true)), ...Array.from({length: 14}, (_, back) => night('interactions', back, back !== 6, back > 8 ? {} : {recall: back === 3 ? 0.77 : 0.85 + (back % 3) * 0.05, clean: 0.93 - (back % 4) * 0.01, still: back === 5 ? 0.75 : 1}))];
    const days = Array.from({length: 14}, (_, back) => [{day: day(back), kind: 'beta', runs: 1, greens: 1, reds: 0, wallMin: 28 + (back % 4) * 3}, {day: day(back), kind: 'nightly', runs: 5, greens: 4, reds: 1, wallMin: 5 * (22 + (back % 3) * 4)},
      {day: day(back), kind: 'after-merge', runs: 3, greens: 3, reds: 0, wallMin: 3 * 12}]).flat();
    await put('e2e_snapshot', {...snapshot, quality, suiteNights, days});
    for (let back = 0; back < 14; back++) {   // the self-healing snapshots behind Report only's finders and planted bugs (2 Nov 2026): one row a day, back 13..0; day 5 and 11 have none (grey cells)
      if (back === 5 || back === 11) continue;
      const at = new Date(now.getTime() - back * 86400000).toISOString(), found = (n, m) => ({fixed: n, queued: m});
      await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(day(back), at, JSON.stringify({schema: 1, at, totals: {filed: 40, real: 12}, byDetector: [],
        periods: {last7: {totals: {}, byDetector: [{detector: 'AI screenshot review', ...found(3 - (back % 3), 1)}, {detector: 'Interaction probe', ...found(0, back % 4 === 0 ? 1 : 0)}, {detector: 'Layout and DOM checks', ...found(back < 4 ? 3 : 1, back % 5 === 0 ? 2 : 0)}]}},
        quality: {mutation: {rate: back === 6 ? 92 : 100, note: back === 6 ? '11 of 12 planted code bugs caught' : '12 of 12 planted code bugs caught'}}, recall: {planted: 13, caught: back < 3 ? 11 : 13, missed: back < 3 ? ['page-overflow', 'a11y-contrast'] : []}})).run();
    }
    for (let back = 0; back < 14; back++) await env.STATS.prepare('INSERT INTO agent_coding_days (kind, day, card, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, day) DO UPDATE SET card = excluded.card').bind('ci', day(back), JSON.stringify({prs: {merged: 6, ci: 2}, reds: {}, fixPrs: back < 3 ? {panel: 1, site: 1} : back < 6 ? {panel: 1} : {site: back % 2}, wall: [12], queue: [2], cancelledMin: 0}), now.toISOString()).run();
  },
  email: async ({env}) => {   // made-up mail for /admin/growth/email (26 Oct 2026): 14 days of sends and refusals under made-up address hashes, a bounce, an unconfirmed stop, two held items
    const templates = ['digest', 'digest', 'digest', 'welcome', 'account-code', 'message'], why = ['rate', 'unsubscribed', 'not_opted_in', 'suppressed', 'failed'];
    const today = Date.now();
    for (let day = 0; day < 14; day++) for (let i = 0; i < 18 + (day * 7) % 23; i++) {
      const at = new Date(today - day * 86400000 - i * 600000).toISOString(), template = templates[i % templates.length], refused = i % 9 === 0;
      await env.STATS.prepare('INSERT INTO mail_log (at, addr, list, template, status, message_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(at, (0x1000000 + i * 7919 + day * 104729 + 0xa3f9c1d200).toString(16).padStart(16, '0'), 'service', template, refused ? why[(i + day) % why.length] : 'sent', refused ? null : `demo-${day}-${i}`).run();
    }
    await env.STATS.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES ('demo000000000001', 'all', 'bounce', ?), ('demo000000000002', 'service', 'unsubscribe', ?), ('demo000000000003', 'service', 'unconfirmed', ?)")
      .bind(new Date(today - 86400000).toISOString(), new Date(today - 2 * 86400000).toISOString(), new Date(today - 3 * 86400000).toISOString()).run();
    await env.STATS.prepare("INSERT INTO test_mail (received_at, to_addr, from_addr, subject, body) VALUES (?, 'test-account-admin@jobpilotto.top', 'notifications@jobadabra.top', 'Confirm your email for Jobadabra', 'Demo')").bind(new Date(today - 600000).toISOString()).run();
    for (const account of ['acc_demo1', 'acc_demo2']) await env.STATS.prepare("INSERT INTO mail_held (account, at, subject, html, text) VALUES (?, ?, 'Demo', '<p>Demo</p>', 'Demo')").bind(account, new Date(today - 3600000).toISOString()).run();
  },
  'random-draws': async ({env}) => {   // made-up draws of the search robot (26 Oct 2026): an old-shape draw, a wide first search, a weak field change; the wide columns only where the schema has them
    const rows = [['2026-10-25', 'support', 'Milan', 'Italy', 62, 326, 664, 155, 106, 2, null], ['2026-10-26', 'healthcare', 'Cluj-Napoca', 'Romania', 48, 210, 540, 212, 140, 9,
      {role: 'Dialysis Nurse', place_kind: 'region', place: 'the EU', path: 'first', engine: 'api', ai_usd: 0.71, funnel: {kinds: ['healthcare'], employers_picked: 640, boards_read: 7, web_searches: 1, looked: 52300}}],
    ['2026-10-27', 'other', 'Milan', 'Italy', null, null, null, 0, 0, 0,
      {role: 'First Officer', place_kind: 'region', place: 'Europe', path: 'field-change', engine: 'api', ai_usd: 0.93, funnel: {kinds: ['finance_admin'], employers_picked: 1025, boards_read: 1, web_searches: 0, looked: 81070}}]];
    for (const [day, family, city, country, first, tenth, fit, places, scored, fit70, wide] of rows) {
      await env.STATS.prepare('INSERT INTO search_lab_draws (draw_date, seed, family, city, country, source, build, state, first_s, tenth_s, fit_s, in_places, scored, fit70) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(day, day, family, city, country, 'ci', 'abc1234', 'ok', first, tenth, fit, places, scored, fit70).run();
      if (wide) await env.STATS.prepare('UPDATE search_lab_draws SET role = ?, place_kind = ?, place = ?, path = ?, engine = ?, ai_usd = ?, funnel = ? WHERE draw_date = ?')
        .bind(wide.role, wide.place_kind, wide.place, wide.path, wide.engine, wide.ai_usd, JSON.stringify(wide.funnel), day).run().catch(() => null);
    }
  },
  scouting: async ({env}) => {   // made-up employers over the European countries, one or two per kind and country, plus a few of the kinds split out of Other (26 Oct 2026)
    const kinds = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades',
      'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other'];
    const countries = ['ch', 'de', 'at', 'fr', 'it', 'gb', 'ie', 'nl', 'be', 'es', 'pt', 'se', 'pl', 'ro'];
    let n = 0;
    for (const [k, kind] of kinds.entries()) for (const [c, country] of countries.entries()) for (let i = 0; i < (k + c) % 4; i++) {
      n += 1;
      const feed = {company: `Demo employer ${n}`, ats: 'greenhouse', slug: `demo-${n}`, quality: 70, checked: '2026-10-25', kinds: {[kind]: 0.8}, countries: [country], fresh: {jobs: 10 + n % 40}};
      await env.STATS.prepare('INSERT INTO index_feeds (ats, slug, regions, body, generated) VALUES (?, ?, ?, ?, ?)').bind('greenhouse', `demo-${n}`, ',europe,', JSON.stringify(feed), '2026-10-25T00:00:00Z').run();
    }
    // Searches (a few installs each) so "Gaps people search in" shows two rows, like the real page (ab, 2 Nov 2026: the card beside "Countries at the floor" left an empty area).
    const day = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    for (const [install, roles, country] of [['i1', 'healthcare', 'ro'], ['i2', 'healthcare', 'ro'], ['i3', 'healthcare', 'ro'], ['i4', 'healthcare', 'ro'], ['i5', 'trades', 'pt'], ['i6', 'trades', 'pt'], ['i7', 'trades', 'pt']])
      await env.STATS.prepare('INSERT INTO contributions (install, day, ats, slug, company, matched, own, roles, regions, countries) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)').bind(install, day, 'greenhouse', `demo-search-${install}`, 'Demo', roles, '', country).run();
  },
  coverage: async ({env}) => {   // made-up daily snapshots for /coverage's kind × country table (27 Oct 2026): big markets and IT strong, small ones thin, many not sorted yet; a week apart
    const {EUROPE} = await import('../shared/pool-tags.js'), {KINDS} = await import('../shared/pool-labels.js');
    const size = {de: 9, gb: 10, fr: 7, es: 6, nl: 6, ch: 5, it: 4, pl: 5, se: 4, ie: 3, at: 2, be: 2, pt: 3, dk: 2, no: 1, fi: 1, cz: 1, ro: 2, hu: 1, gr: 1, bg: 1};
    const weight = kind => ({software: 12, sales_b2b: 7, engineering: 3, creative_media: 2, other: 3, unknown: 30}[kind] ?? (kind.length % 3) * 0.4);
    const cellsAt = grow => Object.fromEntries([...KINDS, 'unknown'].flatMap((kind, k) => EUROPE.map((country, c) => {
      const count = Math.round((size[country] ?? 0.5) * weight(kind) * grow * (0.6 + ((k * 7 + c * 3) % 9) / 10));
      return [`${kind}|${country}`, [count, count * 12]];
    })).filter(([, [count]]) => count > 0));
    for (const [day, grow] of [['2026-10-20', 0.9], ['2026-10-27', 1]]) {
      const cells = cellsAt(grow), feeds = Math.round(Object.values(cells).reduce((sum, [count]) => sum + count, 0) / 1.4);
      await env.STATS.prepare('INSERT INTO index_daily (day, feeds, non_it, failing, from_pool, dead_ends, cells) VALUES (?, ?, ?, 0, 0, 0, ?)').bind(day, feeds, Math.round(feeds / 3), JSON.stringify(cells)).run();
    }
  },
  'closed-sites': async ({env}) => {   // made-up closed sites for /admin/job-search/scouting (27 Oct 2026, table tools): 52 dead ends (refused, unreachable, no feed) and 12 browser-only or gone pages, over 6 weeks
    const day = n => new Date(Date.parse('2026-10-26T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    for (let n = 1; n <= 52; n++) {
      const outcome = n % 5 === 0 ? 'refused' : n % 7 === 0 ? 'unreachable' : null, installs = outcome ? 1 + n % 4 : 1;
      for (let i = 0; i < installs; i++) await env.STATS.prepare('INSERT INTO nofeed (install, day, key, company, host, outcome) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`demo-install-${i}`, day((n * 3 + i) % 42), `demo-${n}`, `Demo employer ${n}`, `jobs.demo-${n}.example`, outcome).run();
    }
    for (let n = 1; n <= 12; n++) for (let i = 0; i < 1 + n % 4; i++) await env.STATS.prepare('INSERT INTO sitefacts (install, day, host, kind) VALUES (?, ?, ?, ?)')
      .bind(`demo-install-${i}`, day((n * 5 + i) % 40), `careers.demo-site-${n}.example`, n % 3 ? 'browser' : 'dead').run();
  },
  'benchmark-search': async ({env, call}) => {   // made-up search round for /admin/job-search/benchmark (27 Oct 2026): ours and two other tools on 3 personas; Tool B's run time was not recorded (0)
    env.SELFHEAL_PUBLISH_KEY = 'page-shot-publish-key';
    const at = '2026-10-27T10:00:00Z', personas = [['Nurse · Townville', 'non-tech'], ['Coder · Cityburg', 'tech'], ['Cook · Portside', 'non-tech']];
    const tools = [['Ours', true, [40, 10, 25], [12, 3, 8], 300], ['Ours with every source', false, [55, 18, 38], [22, 6, 15], 320], ['Tool A', false, [60, 30, 45], [30, 12, 20], 45], ['Tool B', false, [20, 8, 12], [9, 2, 5], 0]];
    const runs = tools.flatMap(([tool, ours, found, relevant, seconds]) => personas.map(([persona, kind], i) => ({id: `demo/${i}/${tool}`, at, round: '2026-10-27', persona, kind, country: 'Land', tool, ours, build: ours ? 'abc1234' : '',
      found: found[i], place: relevant[i] + 2, role: relevant[i] + 4, relevant: relevant[i], employers: relevant[i] + 1, seconds, cents: 0, ...(tool === 'Ours with every source' ? {beyond: {...(i < 2 ? {'Tool A': 6 + i} : {}), 'Tool B': 14 + i, 'Tool C': null}} : {})})));   // 27 Oct 2026: the second line and what it adds beyond each rival (Tool A has no number for the third persona; Tool C failed for every persona and is sent as null)
    await call('/benchmark-search/data', {method: 'PUT', headers: {Authorization: `Bearer ${env.SELFHEAL_PUBLISH_KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify({runs})});
  },
  'promo-codes': async ({env, call}) => {   // three codes in the list: active with uses, used up, and one made before full codes were kept
    await call('/admin/growth/promo-codes', form({action: 'import', code: 'DEMO-CODE-ONE1', label: 'Friends and family', cap: '20', ends: '2999-12-31'}));
    await call('/admin/growth/promo-codes', form({action: 'import', code: 'DEMO-CODE-TWO2', label: 'Beta testers', cap: '2', ends: '2999-12-31'}));
    const rows = (await env.STATS.prepare('SELECT id, label FROM pro_promo_codes').all()).results;
    const at = '2026-10-24T10:00:00.000Z';
    for (const [n, row] of rows.entries()) for (let i = 0; i < (row.label === 'Beta testers' ? 2 : 3); i++) {
      await env.STATS.prepare('INSERT INTO pro_promo_uses (code, install, at, last_seen) VALUES (?, ?, ?, ?)').bind(row.id, `demo-install-${n}-${i}`, at, at).run();
    }
    await env.STATS.prepare("INSERT INTO pro_promo_codes (id, label, code_hash, last4, cap, ends_at, created_at) VALUES ('promo_old', 'Early list', 'demo-hash', 'ZZZZ', 10, '2999-12-31T23:59:59.999Z', ?)").bind(at).run();
    // An AI-credit code (shared/promo-credit.js) once its migration is in: €10 per person, 1 of 20 used. Skipped on an older tree (the before shot).
    const credit = await call('/admin/growth/promo-codes', form({action: 'import', code: 'friends-jobadabra-10e-topup', label: 'Friends top-up', cap: '20', ends: '2999-12-31', kind: 'credit', credit: '10'}));
    const topup = await env.STATS.prepare("SELECT id FROM pro_promo_codes WHERE label = 'Friends top-up'").first();
    if (credit && topup?.id) await env.STATS.prepare('INSERT INTO pro_promo_credit_uses (code, install, at) VALUES (?, ?, ?)').bind(topup.id, 'demo-install-credit', at).run().catch(() => {});
  },
  'ai-cost-fallback': async ({env}) => {   // fictional CI spend; no broker, Telegram or AI is contacted
    await seeds['ai-cost-pro']({env});
    env.AI_BROKER = {fetch: async () => Response.json({fallback: {day: new Date().toISOString().slice(0, 10),
      claude: 4.25, freeAi: 0.12, claudeCap: 5, freeAiCap: 2, held: {claude: 0, freeAi: 0}},
      chain: [{name: 'codex', configured: true, answeredToday: 0, ranOutToday: 436, failedToday: 0, avgMs: null}, {name: 'claude', configured: true, state: 'ready', answeredToday: 350, ranOutToday: 0, failedToday: 3, avgMs: 18394},
        {name: 'claude-api', configured: false, answeredToday: 0, ranOutToday: 0, failedToday: 0, avgMs: null}, {name: 'free-ai', configured: true, answeredToday: 3, ranOutToday: 0, failedToday: 0, avgMs: 4951}]})};
  },
  'ai-cost-pro': async ({env}) => {   // fictional charged calls only; no provider request or real account
    const at = new Date().toISOString();
    for (const [account, credit, action] of [['fixture-a', -100000, 'kit'], ['fixture-a', -80000, 'tailor'], ['fixture-b', -60000, 'answer']]) {
      await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(account, credit, 'ai_call', action, at).run();
    }
  },
  'ai-cost-web': async ({env}) => {   // the Free AI board web search this month: $3.50 of its $10 line, 100 searches paid, 40 answered from the shared answers
    const month = new Date().toISOString().slice(0, 7);
    env.WEB_SEARCH_ANTHROPIC_KEY = 'demo-not-a-key';
    await env.WAITLIST.put(`freeai:web:usd:${month}`, String(3.5 * 1e6));
    await env.WAITLIST.put(`freeai:web:calls:${month}`, '100');
    await env.WAITLIST.put(`freeai:web:hits:${month}`, '40');
  },
  e2e: async ({env}) => {   // made-up e2e runs for /admin/testing/e2e (28 Oct 2026, scorecard + where e2e work goes): a week of PR and nightly runs, reds of every group, four weeks of commits by kind
    const {ingest} = await import('../admin/e2e-intel.js');
    env.SELFHEAL_PUBLISH_KEY = 'demo-publish';
    const today = Date.now(), dayAt = back => new Date(today - back * 86400000).toISOString(), reds = [['apply', 'product'], ['applyflows-1of2', 'flake'], ['applyflows-2of2', 'product'], ['quality', 'ai'],
      ['quality', 'drift'], ['settings', 'product'], ['strategy', 'timing'], ['strategy', 'open'], ['failuresnotion', 'ci'], ['upload', 'test']];
    const runs = [], fails = [];
    for (let back = 6; back >= 0; back--) for (let n = 0; n < 4; n++) {
      const runId = 9000 + back * 10 + n, red = (back + n) % 3 === 0, [suite, cause] = reds[(back * 4 + n) % reds.length], createdAt = dayAt(back);
      runs.push({runId, createdAt, kind: n % 2 ? 'pr' : 'nightly', conclusion: red ? 'failure' : 'success', minutes: 12 + n * 4});
      if (red) fails.push({runId, suite, platform: n === 3 ? 'windows' : 'mac', cause, minutes: 8 + n * 3, day: createdAt.slice(0, 10), kind: n % 2 ? 'pr' : 'nightly'});
    }
    const work = [], weekFiles = ['.github/workflows/e2e.yml', 'desktop/e2e/test-sets.json', 'desktop/e2e/lib/pick-steps.mjs', 'tools/ship.sh', 'desktop/e2e/suites/quality.mjs', 'desktop/e2e/lib/extension.mjs'];
    for (let back = 27; back >= 0; back--) {
      const day = dayAt(back).slice(0, 10), mix = {product: 9 + (back % 4), expectations: 2 + (back % 3), plumbing: Math.max(1, 6 - Math.floor((27 - back) / 6)), tests: 3, other: 2};
      for (const [kind, commits] of Object.entries(mix)) work.push({day, kind, commits});
    }
    const {weekOf} = await import('../admin/e2e-work.js'), weeks = [...new Set(work.map(row => weekOf(row.day)))];
    const workFiles = weeks.flatMap((week, w) => weekFiles.map((file, i) => ({week, file, commits: 18 - i * 3 - w})));
    // Four made-up live quality nights (admin/e2e-quality.js); the newest two carry the nightly prompt-case replay (one got worse, one with nothing changed).
    const replay = {status: 'asked', total: 63, right: 60, flipped: 1, noise: 2, newWrong: 0, unconfirmed: 0, calls: 66};
    const quality = [0, 1, 2, 3].map(back => ({runId: 41010 - back, day: dayAt(back + 1).slice(0, 10), pairs: 24, within8: [22, 20, 23, 21][back], over20: back === 2 ? 1 : 0, factsExact: 63, factsTotal: 63, judged: 18, invented: 1,
      promptCases: back === 0 ? replay : back === 1 ? {...replay, status: 'carried', flipped: 0, noise: 0, calls: 0} : undefined}));
    const week = weekOf(dayAt(0).slice(0, 10)), escapes = [
      {week, sha: 'a'.repeat(40), suites: ['apply'], none: false, journey: 'Applying with a silent Chrome extension'},
      {week, sha: 'b'.repeat(40), suites: [], none: true, journey: 'a card stuck on Checking'},
    ];
    await ingest(new Request('https://demo/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer demo-publish'}, body: JSON.stringify({rules: 3, runs, fails, work, workFiles, escapes, quality})}), env);
  },
  'e2e-green': async ({env}) => {   // fixture-only 30 days of runs per kind for the "Green runs per day" card (31 Oct 2026): main after merge climbs from ~5% (days 7-13 ago) to ~80% (today); not live measurements
    const {ingest} = await import('../admin/e2e-intel.js');
    env.SELFHEAL_PUBLISH_KEY = 'demo-publish';
    const at = Date.now(), runs = [];
    // [runs, greens] per day back (0 = today) for each kind; a missing day = no run that day
    const plan = {
      'after-merge': back => (back <= 1 ? [back ? 9 : 6, back ? 7 : 5] : back <= 6 ? [8, 6 + (back % 2)] : back <= 13 ? [3 + (back % 3), back === 10 ? 1 : 0] : back <= 20 ? [5, 2 + (back % 3)] : [6, 4 - (back % 2)]),
      beta: back => (back % 6 === 5 ? null : [7, back <= 6 ? 3 + (back % 2) : back <= 13 ? 1 : 2 + (back % 2)]),
      pr: back => [14 + (back % 4), 9 + (back % 3) + (back <= 6 ? 2 : 0)],
      nightly: back => (back % 9 === 4 ? null : [2, back <= 3 ? 2 : back % 2 + 1]),
    };
    let runId = 7000;
    for (let back = 29; back >= 0; back--) for (const [kind, rule] of Object.entries(plan)) {
      const cell = rule(back); if (!cell) continue;
      for (let i = 0; i < cell[0]; i++) runs.push({runId: runId++, createdAt: new Date(at - back * 86400000).toISOString(), kind, conclusion: i < cell[1] ? 'success' : 'failure', minutes: 14});
      if (kind === 'beta' && back % 3 === 0) runs.push({runId: runId++, createdAt: new Date(at - back * 86400000).toISOString(), kind, conclusion: 'cancelled', minutes: 2});   // cancelled runs stay out of the share
    }
    for (let i = 0; i < runs.length; i += 400) {   // ingest refuses more than 500 runs in one PUT
      const res = await ingest(new Request('https://demo/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer demo-publish'}, body: JSON.stringify({rules: 3, runs: runs.slice(i, i + 400), fails: []})}), env);
      if (!res.ok) throw new Error(`e2e-green seed: ingest answered ${res.status}`);
    }
  },
  'e2e-beta': async ({env}) => {   // fixture-only beta runs for the "Suites per beta run" card (1 Nov 2026): 14 days, 2-4 betas a day, 62 suites each; reds fall from a bad stretch to a few, two betas released; not live measurements
    const {ingest} = await import('../admin/e2e-intel.js');
    env.SELFHEAL_PUBLISH_KEY = 'demo-publish';
    const at = Date.now(), runs = [], betaRuns = [], reds = [4, 0, 43, 37, 4, 1, 2, 1, 0, 1, 1, 2, 8, 1, 0, 1, 2, 0, 1, 0, 0, 3, 1, 0, 0], hours = [1, 6, 14, 22];
    let runId = 9000, step = 0;
    for (let back = 13; back >= 0; back--) for (const hour of hours.slice(0, 2 + (back % 3))) {
      const when = new Date(at - back * 86400000), createdAt = `${when.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:${String((step * 7) % 60).padStart(2, '0')}:00Z`;
      if (Date.parse(createdAt) > at) continue;
      const red = reds[step % reds.length], stopped = step % 11 === 6, grey = stopped ? 40 : 0, cancelled = step % 17 === 9;
      const names = Array.from({length: red}, (_, i) => `${i % 2 ? 'Windows' : 'Mac + Linux'} · ${['apply', 'foryou', 'settings', 'quality', 'calendar', 'interviews', 'cardstates', 'jobs'][(step + i) % 8]}`).sort();
      runs.push({runId, createdAt, kind: 'beta', conclusion: cancelled ? 'cancelled' : red ? 'failure' : 'success', minutes: 26});
      betaRuns.push({runId, createdAt, sha: (0xabc000 + step * 4099).toString(16).padStart(7, '0'), conclusion: cancelled ? 'cancelled' : red ? 'failure' : 'success', green: 62 - red - grey, red, grey, released: !red && !grey && !cancelled && step % 5 === 3, redSuites: names});
      runId += 1; step += 1;
    }
    const res = await ingest(new Request('https://demo/e2e/data', {method: 'PUT', headers: {Authorization: 'Bearer demo-publish'}, body: JSON.stringify({rules: 3, runs, fails: [], betaRuns})}), env);
    if (!res.ok) throw new Error(`e2e-beta seed: ingest answered ${res.status}`);
  },
  integration: async ({env}) => {   // made-up integration results for /admin/testing/integrations (1 Nov 2026): a week of main runs on three layers, two flaky tests, slow tests, 14 days of the move
    const {ingest} = await import('../admin/integration-intel.js');
    env.SELFHEAL_PUBLISH_KEY = 'demo-publish';
    const dayAt = back => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10), runs = [], layers = {extension: [38000, 0], app: [61000, 1], store: [9000, 2]};
    for (let back = 6; back >= 0; back--) for (let n = 0; n < 2 + (back % 3); n++) for (const [layer, [base, offset]] of Object.entries(layers)) for (const platform of layer === 'app' ? ['linux', 'windows'] : ['linux']) {
      const red = layer === 'app' && platform === 'windows' && back === 3 && n === 1 || layer === 'extension' && back === 5 && n === 0;
      runs.push({runId: 41000 + back * 100 + n * 10 + offset, layer, platform, day: dayAt(back), on: 'main', sha: (back * 31 + n * 7 + offset + 1).toString(16).padStart(7, 'a'), conclusion: red ? 'failure' : 'success', tests: layer === 'app' ? 118 : layer === 'extension' ? 64 : 41, failed: red ? 1 : 0, ms: base + back * 700 + n * 300 + (platform === 'windows' ? 24000 : 0)});
    }
    const ref = (runId, sha) => ({runId, sha});
    const flaky = [{layer: 'app', test: 'focus: the card keeps its state after Dismiss', file: 'integration/app/screen-focus.test.js', kind: 'same-commit', day: dayAt(3), red: ref(41310, 'a00005e'), green: ref(41311, 'a00005e')},
      {layer: 'extension', test: 'recorded page: two-step form reads both steps', file: 'integration/extension/forms.test.mjs', kind: 'unchanged-files', day: dayAt(5), red: ref(41500, 'a000084'), green: ref(41400, 'a000075')}];
    const slowest = [['app', 'settings: engine panel and ⌘K open on every tab', 'integration/app/screen-settings.test.js', 9400], ['extension', 'recorded page: long Workday form fills to the end', 'integration/extension/workday.test.mjs', 8100],
      ['app', 'activity: failures wording for every cause', 'integration/app/screen-activity-failures.test.js', 6200], ['extension', 'recorded page: sign-in wall stops the read', 'integration/extension/wall.test.mjs', 4300], ['app', 'calendar: month grid with 40 events', 'integration/app/screen-calendar.test.js', 3900],
      ['store', 'scoring: 500 jobs dedupe by employer and title', 'integration/store/dedupe.test.mjs', 2800], ['app', 'foryou: empty, loading and full states', 'integration/app/screen-foryou.test.js', 2500], ['store', 'strategy: places re-judged on a change', 'integration/store/strategy.test.mjs', 1700],
      ['extension', 'recorded page: cookie banner is left alone', 'integration/extension/banner.test.mjs', 1500], ['store', 'store: round trip of 200 rows', 'integration/store/roundtrip.test.mjs', 900]].map(([layer, test, file, ms]) => ({layer, test, file, ms, runs: 5}));
    const days = Array.from({length: 14}, (_, i) => { const back = 13 - i; return {day: dayAt(back), e2eSuites: 29 - Math.floor(i / 5), e2eSteps: 296 - i * 5, integration: {extension: i > 8 ? 8 + (i - 8) * 8 : 0, app: 40 + i * 6, store: i > 10 ? (i - 10) * 14 : 0}}; });
    const body = {runs, flaky, slowest, counts: {extension: {tests: 64, files: 9}, app: {tests: 118, files: 16}, store: {tests: 41, files: 6}}, move: {days, e2eSteps: days[13].e2eSteps, lanes: 28}};
    // The coverage card (a8, 1 Nov 2026): the REAL nightly report.json from $COVERAGE_REAL_DIR (the artifact `coverage-report`) when set, else no card data, so the page shows its empty state.
    const real = process.env.COVERAGE_REAL_DIR && `${process.env.COVERAGE_REAL_DIR}/report.json`;
    if (real && (await import('node:fs')).existsSync(real)) body.coverage = (await import('../jobs/coverage-intel.mjs')).mergeCoverage(null, JSON.parse((await import('node:fs')).readFileSync(real, 'utf8')), {runId: 41337418754, sha: ''});
    // The time-bomb card (a8, 2 Nov 2026): made-up clock-moved reports of the shape tools/clock-moved.mjs writes (no real file names of the owner's); python has no report that night.
    const {mergeClockMoved} = await import('../jobs/clock-moved-intel.mjs');
    const bomb = (area, file, days, why) => ({area, file, days, why});
    body.clockMoved = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].reduce((kept, back) => mergeClockMoved(kept, {
      desktop: {judged: 412, redToday: 1, bombs: back > 3 ? [] : [bomb('desktop', 'test/example-expiry.test.js', 3, 'AssertionError: the offer still shows after the date')], unstable: [], seconds: 310},
      e2e: {judged: 96, redToday: 0, bombs: back > 6 ? [] : [bomb('e2e', 'e2e/test/example-window.test.mjs', 1, 'AssertionError: 0 days left, expected 1'), bomb('e2e', 'e2e/test/example-week.test.mjs', 7, 'Error: week label is stale')], unstable: [], seconds: 220}, python: null,
    }, {runId: 42000 + back, sha: 'b9a8f21c4d5e', day: dayAt(back)}), null);
    await ingest(new Request('https://demo/integration/data', {method: 'PUT', headers: {Authorization: 'Bearer demo-publish'}, body: JSON.stringify(body)}), env);
  },
  'integration-not-starting': async ({env}) => {   // /admin/testing/integrations when the Worker's last start of its collector was refused (1 Nov 2026): the integration data plus the red line
    await seeds.integration({env});
    const {recordStarts} = await import('../shared/intel-start.js');
    await recordStarts(env.STATS, [{workflow: 'integration-intel.yml', error: 'E2E_INTEL_GITHUB_TOKEN is not set (the site GITHUB_TOKEN covers the public repo, not this one)'}]);
  },
  'e2e-grey': async ({env}) => {   // fixture-only Grey lifecycle: four lanes, seven quality nights (two red), and the stored grey ledger (suite × reason); direct snapshot works for before shots too
    const at = new Date(), dayAt = back => new Date(at.getTime() - back * 86400000).toISOString().slice(0, 10);
    const suiteNights = Array.from({length: 7}, (_, back) => ({runId: 9100 + 6 - back, day: dayAt(back), kind: 'nightly', suite: 'quality', platform: 'mac',
      green: ![1, 4].includes(back), rates: {agree: [0.92, 0.70, 0.94, 0.90, 0.74, 0.91, 0.93][back]}}));
    const snapshot = {schema: 2, at: at.toISOString(),
      lanes: {suites: {
        quality: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: 'One fixture question still needs a recorded answer.', returns: 'Record the fixture answer and prove a green run.'},
        qualityai: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: 'Fixture answer quality is measured as a rate.', returns: 'Seven fixture nights within the measured band.'},
        'notion-real': {lane: 'tolerant', input: 'outside', since: '2026-10-28', why: 'The fixture service can refuse or delay a request.', returns: 'Seven steady fixture service nights.'},
        'fixture-suite': {lane: 'suspended', input: 'clock', since: '2026-10-10', why: 'The fixture flipped red then green on the same commit.'}
      }}, suiteNights, mainBands: {quality: {agree: {lower: 0.80, upper: 0.95}}},
      days: suiteNights.map(night => ({day: night.day, kind: 'nightly', runs: 1, reds: night.green ? 0 : 1, greens: night.green ? 1 : 0, redMin: night.green ? 0 : 12})),
      fails: suiteNights.filter(night => !night.green).map(night => ({day: night.day, kind: 'nightly', suite: 'quality', platform: 'mac', cause: 'ai', n: 1, min: 12})),
      latest: suiteNights.map(night => ({runId: night.runId, day: night.day, kind: 'nightly', conclusion: night.green ? 'success' : 'failure', minutes: 12})),
      quality: [], breaks: [], caught: [], work: [], workFiles: []};
    await env.STATS.prepare('INSERT INTO e2e_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body')
      .bind(snapshot.at, JSON.stringify(snapshot)).run();
  },
  'e2e-speed': async ({env, call}) => {   // fixture-only job medians: main's three slowest suites, a sparse row, and a PR warning (not live measurements)
    await seeds.e2e({env, call});
    const at = new Date(), createdAt = at.toISOString(), samples = [
      ['jobs', [290, 307, 320, 307, 305]], ['activityfailures', [180, 194, 201, 194, 190]], ['focus', [20, 22, 25, 22, 21]], ['updates', [6, 7, 8, 7, 7]], ['new-suite', [12]]
    ];
    const speedRuns = Array.from({length: 5}, (_, i) => ({runId: 9800 + i, createdAt, kind: 'scheduled',
      suiteJobs: samples.filter(([, values]) => i < values.length).map(([suite, values]) => ({suite, seconds: values[i]}))}));
    speedRuns.push(...[1, 2, 3].map(i => ({runId: 9900 + i, createdAt, kind: 'pr', suiteJobs: [{suite: 'fixture-slow-pr', seconds: 480 + i}]})));
    const row = await env.STATS.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').first(), snapshot = JSON.parse(row.body);
    await env.STATS.prepare('UPDATE e2e_snapshot SET body = ? WHERE id = 1').bind(JSON.stringify({...snapshot, speedRuns})).run();
  },
  'gtm-readiness': async ({env}) => {   // fixture-only journeys (not live measurements): one stable, one red yesterday, one with few runs, one lately flaky; Tier 2 all green
    const at = new Date(), dayAt = back => new Date(at.getTime() - back * 86400000).toISOString().slice(0, 10);
    const journeys = [{id: 'J0', name: 'The app starts and draws every screen (smoke)', tier: 1}, {id: 'J1', name: 'Set up the app: key, CV, strategy, first search', tier: 1}, {id: 'J5', name: 'Apply: the extension fills the form, you submit', tier: 1},
      {id: 'J12', name: 'Updates: only approved builds are offered', tier: 1}, {id: 'J6', name: 'Find jobs: a merge-run journey, red 2 days ago, 20 greens since', tier: 1}, {id: 'K', name: 'Kept safety and data steps', tier: 1}, {id: 'J8', name: 'Tailor a CV for a job', tier: 2}, {id: 'J9', name: 'Track an application through its stages', tier: 2}];
    const tier1 = [];
    for (let i = 0; i < 40; i++) for (const os of ['mac', 'windows']) {
      const day = dayAt(Math.floor(i / 3)), kind = ['after-merge', 'beta', 'nightly'][i % 3], runId = 9000 + i;
      tier1.push([runId, day, kind, os, 'J0', 1, 0, 0], [runId, day, kind, os, 'J1', 8, i === 7 ? 1 : 0, 0], [runId, day, kind, os, 'J5', 3, 0, i === 2 && os === 'windows' ? 1 : 0], [runId, day, kind, os, 'K', 9, 0, i === 14 ? 1 : 0]);
      if (i < 6) tier1.push([runId, day, kind, os, 'J12', 3, 0, 0]);
    }
    for (let i = 0; i < 21; i++) for (const os of ['mac', 'windows']) tier1.push([9500 + i, dayAt(i === 0 ? 2 : i <= 10 ? 1 : 0), 'after-merge', os, 'J6', 4, i === 0 && os === 'mac' ? 1 : 0, 0]);   // J6 (2 Nov 2026): the row that read as a contradiction: one red run 2 days ago, then 20 green runs in a day and a half
    const tier2 = [0, 1, 2, 3].flatMap(back => [{day: dayAt(back), journey: 'J8', tests: 4, runs: 30, red: back === 2 ? 1 : 0}, {day: dayAt(back), journey: 'J9', tests: 2, runs: 12, red: 0}]);
    const snapshot = {schema: 1, at: at.toISOString(), journeys, tier1, tier2, read: {e2e: [], integration: []}};
    await env.STATS.prepare('INSERT INTO gtm_snapshot (id, at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, body = excluded.body').bind(snapshot.at, JSON.stringify(snapshot)).run();
  },
  'ai-cost-free': async ({env}) => {   // one made-up install's Free AI day (26 Oct 2026 shape): $0.42 and 2.5M tokens, under the lines wrangler.toml sets; each step as this tree's log records it
    Object.assign(env, {FREE_AI_INSTALL_DAY_USD: '0.50', FREE_AI_INSTALL_MONTH_USD: '5', FREE_AI_MONTH_STOP_USD: '200', FREE_AI_MONTH_ALERT_USD: '100'});
    const day = new Date().toISOString().slice(0, 10), model = '@cf/qwen/qwen3-30b-a3b-fp8';
    const steps = [['scout', 210, 900000, 110000, 105000], ['enrich', 100, 330000, 60000, 80000], ['score', 140, 500000, 90000, 65000], ['decide', 110, 220000, 60000, 46000],
      ['title_triage', 160, 180000, 50000, 40000], ['place_triage', 120, 120000, 30000, 30000], ['visit_relevant', 60, 70000, 20000, 18000], ['role_ideas', 58, 40000, 10000, 36000]];
    for (const [step, calls, tin, tout, micro] of steps) {
      const action = ACTIONS.includes(step) ? step : 'other';
      await env.STATS.prepare('INSERT INTO ai_calls (day, who, action, model, calls, tokens_in, tokens_out, cache_read, micro_usd) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (day, who, action, model) DO UPDATE SET '
        + 'calls = calls + excluded.calls, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out, micro_usd = micro_usd + excluded.micro_usd')
        .bind(day, 'demo0001', action, model, calls, tin, tout, micro).run();
    }
  },
};
