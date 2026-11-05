// App reports (src/telemetry.js): stored scrubbed, grouped into problems across users, shown with the /stats key,
// and the daily run drops old reports (problems are no longer filed as issues since 20 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {daily, describe, useOf} from '../../../shared/telemetry.js';
import {newestBuild} from '../../../admin/telemetry.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0002_telemetry.sql', '0003_feedback.sql', '0124_feedback_files.sql', '0125_feedback_page_profile.sql', '0126_feedback_actions.sql', '0127_feedback_impact_ai.sql', '0128_feedback_replies.sql', '0129_feedback_ai.sql', '0134_feedback_receipt.sql', '0062_telemetry_country.sql']) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')}});
const send = (e, events) => worker.fetch(new Request('https://www.jobpilotto.top/report/telemetry',
  {method: 'POST', body: JSON.stringify({events})}), e, {});
const crash = (install, version = '0.4.1', line = 12) => ({kind: 'crash', install, version, platform: 'darwin', at: '2026-09-29T10:00:00Z',
  where: 'window', type: 'TypeError', message: `Cannot read properties of undefined (reading 'id') at row ${line}`,
  stack: `TypeError: x\n    at render (file:///Applications/Job Pilotto.app/Contents/Resources/app.asar/renderer/pages/jobs.js:${line}:5)`});

test('reports are stored, and the same problem from two users (other line numbers) is one problem', async () => {
  const e = env();
  assert.equal((await send(e, [crash('install-aaaa'), crash('install-bbbb', '0.4.2', 40)])).status, 200);
  assert.equal((await send(e, [{kind: 'run_failed', install: 'install-aaaa', version: '0.4.1', platform: 'darwin', job: 'src.ai.prep build',
    error: 'JSONDecodeError: Unterminated string at char 2594 for igor@gmail.com', cutOff: true}])).status, 200);
  const rows = e.STATS.db.prepare('SELECT fingerprint, summary, data FROM telemetry').all();
  assert.equal(new Set(rows.filter(r => r.summary.startsWith('TypeError')).map(r => r.fingerprint)).size, 1);
  assert.ok(!rows.some(r => r.data.includes('igor@gmail.com')));  // scrubbed again on the server
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /TypeError: Cannot read properties/);
  assert.match(html, /<td><b>2<\/b><\/td>/);  // two users
  assert.match(html, /src\.ai\.prep build: JSONDecodeError/);
});

test('without the key the page does not exist; junk is refused', async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app'), e, {})).status, 404);
  assert.equal((await send(e, [{kind: 'nonsense', install: 'x'}])).status, 400);
});

test('the daily run drops reports older than 90 days and files nothing (owner, 20 Oct 2026: telemetry issues retired)', async () => {
  const e = env();
  await send(e, [crash('install-aaaa'), crash('install-bbbb')]);
  e.STATS.db.prepare("UPDATE telemetry SET day = '2026-01-01' WHERE install = 'install-aaaa'").run();
  assert.equal(await daily(e, new Date('2026-10-20T06:00:00Z')), 0);
  assert.deepEqual(e.STATS.db.prepare('SELECT install FROM telemetry').all().map(row => row.install), ['install-bbbb']);
});

test('an advice event is counted but is no problem row (private issue #24 was "Advice visit on strategy: taken")', async () => {
  const e = env();
  await send(e, [{kind: 'advice', install: 'install-aaaa', version: '0.7.10', platform: 'win32', at: new Date().toISOString(), advice: 'visit', where: 'strategy', act: 'taken'}]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.ok(!/Advice visit on strategy/.test(html));
});

test('each problem says its newest build; one seen only on older builds than any install runs now is muted and last', async () => {
  assert.deepEqual(newestBuild('0.7.12,0.7.16', [{version: '0.7.37'}, {version: '0.7.12'}]), {seen: '0.7.16', current: '0.7.37', old: true});
  assert.deepEqual(newestBuild('0.7.37', [{version: '0.7.37'}]), {seen: '0.7.37', current: '0.7.37', old: false});
  const e = env();
  const failed = (install, version, error) => ({kind: 'run_failed', install, version, platform: 'darwin', at: new Date().toISOString(), job: 'src.focus remind', code: 1, error});
  await send(e, [failed('install-aaaa', '0.7.16', 'old trouble'), crash('install-bbbb', '0.7.37')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /<th>Newest build<\/th>/);
  assert.match(html, /<span class="newest">on 0\.7\.37<\/span>/);
  assert.match(html, /<tr class="old">[\s\S]*old builds only · 0\.7\.16/);
  assert.ok(html.indexOf('on 0.7.37') < html.indexOf('old builds only'), 'current problems first');
});

test('fingerprints ignore numbers and ids but keep what differs', () => {
  const a = describe({kind: 'form_issue', site: 'boards.greenhouse.io', label: 'Salary expectation (CHF 120000)', reason: 'dropdown'});
  const b = describe({kind: 'form_issue', site: 'boards.greenhouse.io', label: 'Salary expectation (CHF 95000)', reason: 'dropdown'});
  const c = describe({kind: 'form_issue', site: 'jobs.lever.co', label: 'Salary expectation (CHF 95000)', reason: 'dropdown'});
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

test('How it helped: each install\'s latest daily totals, summed', async () => {
  const e = env();
  const health = (install, at, applied, interviews) => ({kind: 'health', install, version: '0.4.1', platform: 'darwin', at, applied, interviews, offers: 0, formsFilled: 3});
  await send(e, [health('install-aaaa', '2026-09-28T08:00:00Z', 5, 0), health('install-aaaa', '2026-09-29T08:00:00Z', 7, 1), health('install-bbbb', '2026-09-29T09:00:00Z', 2, 1)]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>9<\/b>/);   // 7 (latest of the first install) + 2
  assert.match(html, /🧑‍💻 Interviews<\/span><b>2<\/b>/);
  assert.match(html, /all 2 installs reporting/);
});

test('the key, given once on either page, opens both (the cookie is for the whole site)', async () => {
  const e = env();
  const first = await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/website?key=k3y'), e, {});
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/;/);
  const later = await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Cookie: cookie.split(';')[0]}}), e, {});
  assert.equal(later.status, 200);
});

test('an install whose report has no counts yet shows "–", not 0', async () => {
  const e = env();
  await send(e, [{kind: 'health', install: 'install-cccc', version: '0.4.0', platform: 'darwin', at: '2026-09-29T08:00:00Z', ai: true}]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>–<\/b>/);
  assert.match(html, /No counts yet/);
});

test('/telemetry/version: per exact version, installs, health days, run counts and problem events (key as a header)', async () => {
  const e = env();
  const health = (install, version, at, runsOk, runsFailed) => ({kind: 'health', install, version, platform: 'darwin', at, runsOk, runsFailed});
  await send(e, [health('install-aaaa', '0.5.50', '2026-09-26T08:00:00Z', 4, 0), health('install-aaaa', '0.5.50', '2026-09-28T09:00:00Z', 3, 1),
    health('install-bbbb', '0.5.5', '2026-09-28T09:00:00Z', 10, 2), crash('install-bbbb', '0.5.5')]);
  e.STATS.db.prepare("UPDATE telemetry SET day = substr(at, 1, 10)").run();
  const url = 'https://www.jobpilotto.top/telemetry/version?v=0.5.50&compare=0.5.5';
  assert.equal((await worker.fetch(new Request(url), e, {})).status, 404);
  assert.equal((await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer wrong'}}), e, {})).status, 404);
  const body = await (await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer k3y'}}), e, {})).json();
  const canary = body.versions['0.5.50'], stable = body.versions['0.5.5'];
  assert.deepEqual([canary.installs, canary.healthInstalls, canary.healthDays], [1, 1, 2]);
  assert.deepEqual([canary.healthFirst, canary.healthLast], ['2026-09-26T08:00:00Z', '2026-09-28T09:00:00Z']);
  assert.deepEqual(canary.runs, {ok: 7, failed: 1, reports: 2});
  assert.equal(canary.events.crash, 0);  // 0.5.5's crash isn't 0.5.50's: exact match
  assert.deepEqual([stable.runs.ok, stable.runs.failed, stable.events.crash], [10, 2, 1]);
  const bad = await worker.fetch(new Request('https://www.jobpilotto.top/telemetry/version?v=x%27%3B', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  assert.equal(bad.status, 400);
});

test('the private page counts feedback and links to the Feedback page (no copy of the messages); without the key it is not found', async () => {
  const e = env();
  e.STATS.db.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), new Date().toISOString().slice(0, 10), 'install-aaaa', '0.5.75', 'darwin', 'Setup took 20 <min>', 'ana@example.com');
  const open = await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  const html = await open.text();
  assert.match(html, /1 message in the last 30 days · <a href="\/admin\/feedback\/inbox">Open Feedback →<\/a>/);
  assert.doesNotMatch(html, /Setup took 20/, 'the messages live on /admin/feedback/inbox only');
  assert.doesNotMatch(html, /ana@example\.com/);
  const closed = await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app'), e, {});
  assert.equal(closed.status, 404);
});

test('setup funnel: furthest step per install, never counted as a problem', async () => {
  const e = env();
  const at = new Date().toISOString();
  // 'goals' and 'notion' below: an older app's steps (now part of cv, or gone), ignored by the funnel.
  const step = (install, s, extra = {}) => ({kind: 'setup', install, version: '0.5.76', platform: 'darwin', at, step: s, ...extra});
  await send(e, [step('install-aaaa', 'welcome'), step('install-aaaa', 'ai'), step('install-aaaa', 'notion'),
    step('install-bbbb', 'welcome'), step('install-bbbb', 'ai', {ai: 'trial'}), step('install-bbbb', 'notion'), step('install-bbbb', 'cv'),
    step('install-bbbb', 'goals'), step('install-bbbb', 'draft'), step('install-bbbb', 'hosted'), step('install-bbbb', 'extras'), step('install-bbbb', 'done', {minutes: 12})]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(html, /🚦 Setup funnel/);
  assert.match(html, /median time to finish: 12 min/);
  assert.match(html, /1 used Free AI/);
  assert.match(html, /No problems reported/);  // setup steps are not problems
  const {funnel} = await import('../../../shared/telemetry.js');
  const f = await funnel(e.STATS, 30);
  assert.deepEqual(f.reached.map(r => r.n), [2, 2, 1, 1, 1, 1, 1]);
});

test('why they stopped: reasons per step on the funnel', async () => {
  const e = env();
  const at = new Date().toISOString();
  const stop = (install, step, reason) => ({kind: 'setup', install, version: '0.5.82', platform: 'darwin', at, step: 'stopped', where: step, reason});
  await send(e, [stop('install-aaaa', 'ai', 'ai'), stop('install-bbbb', 'ai', 'ai'), stop('install-cccc', 'ai', 'privacy')]);
  const {funnel} = await import('../../../shared/telemetry.js');
  assert.deepEqual((await funnel(e.STATS, 30)).stopped, {ai: {ai: 2, privacy: 1}});
});

test('a control report reads as one problem per fingerprint, outcome and reason, across users and sites', () => {
  const a = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'failed', why: 'the option did not stay selected', site: 'h:aaaaaaaaaa'});
  const b = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'failed', why: 'the option did not stay selected', site: 'jobs.ashbyhq.com'});
  const c = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'missed', why: '', site: 'h:aaaaaaaaaa'});
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.match(a.summary, /toggle-group 1d2pcapx18: failed/);
});

test('the owner\'s page shows the access guard: what hit a limit or a decoy, only as digests', async () => {
  const e = env();
  e.STATS.db.exec(readFileSync(new URL('../../../db/migrations/0008_guard.sql', import.meta.url), 'utf8'));
  const page = async () => (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(await page(), /Access guard[\s\S]*Nothing odd/);
  const day = new Date().toISOString().slice(0, 10);
  e.STATS.db.prepare("INSERT INTO anomalies (day, kind, who, n, detail) VALUES (?, 'honeypot', 'abcdef0123456789', 2, 'x')").run(day);
  e.STATS.db.prepare("INSERT INTO revoked (who, reason, created_at) VALUES ('abcdef0123456789', 'asked for a honeypot', ?)").run(new Date().toISOString());
  const html = await page();
  assert.match(html, /honeypot<\/span><\/td><td><code>abcdef0123456789<\/code><\/td><td>2/);
  assert.match(html, /Revoked: <code>abcdef0123456789<\/code> \(asked for a honeypot\)/);
});

test('Machines reporting counts each install once, however many versions it ran', async () => {
  const e = env();
  const ev = (install, version, platform) => ({kind: 'health', install, version, platform, at: '2026-09-29T08:00:00Z'});
  await send(e, [ev('install-aaaa', '0.4.0', 'darwin'), ev('install-aaaa', '0.4.1', 'darwin'), ev('install-aaaa', '0.4.2', 'darwin'), ev('install-bbbb', '0.4.2', 'win32')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /Machines reporting<\/span><b>2<\/b><small class="muted">2 ever seen · 1 (macOS|Windows), 1 (macOS|Windows)/);
});

test('Machines table: the version each install runs now, and the versions it has run', async () => {
  const e = env();
  const ev = (version, at) => ({kind: 'health', install: 'install-aaaa', version, platform: 'darwin', at});
  await send(e, [ev('0.4.0', '2026-09-28T08:00:00Z'), ev('0.4.2', '2026-09-30T08:00:00Z'), ev('0.4.1', '2026-09-29T08:00:00Z')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /<span class="v now">0\.4\.2<\/span>/);
  assert.match(html, /<span class="v">0\.4\.0<\/span><span class="v">0\.4\.1<\/span><\/td>/);   // earlier versions only; the current one is the amber chip
});

test('Channels: machines, finished setup and active, by the channel each install reported', async () => {
  const e = env();
  const ev = (install, at, extra) => ({install, version: '0.4.2', platform: 'darwin', at, ...extra});
  await send(e, [
    ev('install-aaaa', '2026-09-29T08:00:00Z', {kind: 'health', source: 'reddit-devops'}), ev('install-aaaa', '2026-09-30T08:00:00Z', {kind: 'health', source: 'reddit-devops'}),
    ev('install-aaaa', '2026-09-29T08:05:00Z', {kind: 'setup', step: 'done', minutes: 6, source: 'reddit-devops'}),
    ev('install-bbbb', '2026-09-29T09:00:00Z', {kind: 'health', source: 'reddit-devops'}),
    ev('install-cccc', '2026-09-29T09:00:00Z', {kind: 'health'})]);
  e.STATS.db.exec('UPDATE telemetry SET day = substr(at, 1, 10)');   // the server stamps the day it received them; here, the day they happened
  const {channels} = await import('../../../shared/telemetry.js');
  const rows = await channels(e.STATS, 30, new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(rows.map(r => [r.source, r.machines, r.done, r.active]), [['reddit-devops', 2, 1, 1], ['unknown', 1, 0, 0]]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📣 Channels/);   // (the page reads the last 30 days from today, so only the heading is checked here)
});

test('advice events are accepted and grouped by kind, place and act (7 Oct 2026)', async () => {
  const {describe} = await import('../../../shared/telemetry.js');
  assert.deepEqual(describe({kind: 'advice', advice: 'role', where: 'strategy', act: 'taken'}),
    {key: 'advice|strategy|role|taken', summary: 'Advice role on strategy: taken'});
});

// The app opened a form tab and the extension had to take it (desktop/lib/tab-expect.js): taken or the step that failed.
const tab = (install, outcome, platform = 'win32', version = '0.7.2') => ({kind: 'tab', install, version, platform, at: '2026-10-12T20:00:00Z', outcome, ms: 21000});

test('form-tab reports: taken ones count in the rate, misses are problems, /admin/growth/app shows rate by OS and version', async () => {
  const e = env();
  const events = [tab('install-aaaa', 'taken'), tab('install-aaaa', 'taken'), tab('install-bbbb', 'extension_silent'), tab('install-cccc', 'tab_not_taken'), tab('install-dddd', 'taken', 'darwin', '0.7.4')];
  assert.equal((await send(e, events)).status, 200);
  assert.match(describe(tab('x', 'tab_not_taken')).summary, /tab_not_taken/);
  assert.notEqual(describe(tab('x', 'extension_silent')).key, describe(tab('x', 'tab_not_taken')).key);   // two different problems
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /Form tabs/);
  assert.match(html, /Windows[^]*?0\.7\.2[^]*?<td>4<\/td><td>2<\/td>\s*<td>50%<\/td>/);   // 4 opened on Windows 0.7.2, 2 taken
  assert.match(html, /extension_silent/);
  assert.ok(!/form tab: taken/.test(html) && !/Form tab: taken/.test(html), 'a taken tab is not a problem row');
});

test('a report stores the country Cloudflare saw (two letters only) and the machines table shows it', async () => {
  const e = env();
  const post = (cf, events) => worker.fetch(Object.assign(new Request('https://www.jobpilotto.top/report/telemetry', {method: 'POST', body: JSON.stringify({events})}), {cf}), e, {});
  await post({country: 'CH'}, [crash('install-aaaa1111')]);
  await post({country: 'not a code'}, [crash('install-bbbb2222')]);
  await post(undefined, [crash('install-cccc3333')]);
  const rows = Object.fromEntries(e.STATS.db.prepare('SELECT install, country FROM telemetry').all().map(r => [r.install, r.country]));
  assert.deepEqual(rows, {'install-aaaa1111': 'CH', 'install-bbbb2222': null, 'install-cccc3333': null});
  const page = await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  assert.match(await page.text(), /<th>Country<\/th>[^]*<td>CH<\/td>/);
});

test('a machine is "in use" after 2+ days or anything past setup/health; one setup report is "tried once"; the table says so', async () => {
  assert.equal(useOf({days: 1, beyond: 0}), 'tried once');
  assert.equal(useOf({days: 2, beyond: 0}), 'in use');
  assert.equal(useOf({days: 1, beyond: 1}), 'in use');
  const e = env();
  await send(e, [{kind: 'setup', install: 'install-once1111', version: '0.7.0', platform: 'win32', at: '2026-10-12T10:00:00Z', step: 'start'},
    {kind: 'setup', install: 'install-used2222', version: '0.7.0', platform: 'win32', at: '2026-10-12T10:00:00Z', step: 'start'}, crash('install-used2222')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.top/admin/growth/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(html, /tried once/);
  assert.match(html, /in use/);
});

test('a search report keeps only its listed fields, is never a problem, and its family list equals the app\'s', async () => {
  const e = env();
  const base = {kind: 'search', install: 'install-aaaa', version: '0.5.0', platform: 'darwin', at: '2026-10-18T10:00:00Z'};
  const good = {family: 'hospitality', country: 'CH', city: 'zurich', in_places: 40, scored: 12, fit70: 3, first_s: 9, tenth_s: 41, first_fit70_s: 77, nth: 2, runs_to_fit70: 2, engine: 'api', trigger: 'you'};
  assert.equal((await send(e, [{...base, ...good, title: 'Barista at Acme', link: 'https://x.y/1', cv: 'my CV', name: 'Ann', family_other: 'x'}])).status, 200);
  const row = e.STATS.db.prepare("SELECT data, summary FROM telemetry WHERE kind = 'search'").get();
  const stored = JSON.parse(row.data);
  assert.deepEqual(Object.keys(stored).filter(k => !['kind', 'at', 'install', 'version', 'platform'].includes(k)).sort(), Object.keys(good).sort());   // a new field needs listing in src/search-report.js
  assert.ok(!/Acme|x\.y|my CV|Ann/.test(row.data));
  await send(e, [{...base, family: 'barista!', country: 'switzerland', in_places: -1}]);
  const bad = JSON.parse(e.STATS.db.prepare("SELECT data FROM telemetry WHERE kind = 'search' ORDER BY rowid DESC LIMIT 1").get().data);
  assert.deepEqual(Object.keys(bad).filter(k => ['family', 'country', 'in_places'].includes(k)), []);
  const {problems} = await import('../../../shared/telemetry.js');
  await send(e, [{...base, result: 'failed', engine: 'cli', trigger: 'you'}, {...base, result: 'weird'}]);
  const results = e.STATS.db.prepare("SELECT data FROM telemetry WHERE kind = 'search' ORDER BY rowid DESC LIMIT 2").all().map(r => JSON.parse(r.data).result);
  assert.deepEqual(results, [undefined, 'failed']);   // the app's done / failed / stopped outcome is kept, anything else dropped
  e.STATS.db.prepare("DELETE FROM telemetry WHERE kind = 'search' AND rowid > 2").run();
  assert.equal(e.STATS.db.prepare("SELECT kind FROM telemetry WHERE kind = 'search'").all().length, 2);
  assert.equal(JSON.stringify(await problems(e.STATS, 7, new Date('2026-10-19T00:00:00Z'))).includes('Search ('), false);
  const {FAMILIES} = await import('../../../shared/search-report.js');
  const py = readFileSync(new URL('../../../src/role_kinds.py', import.meta.url), 'utf8').match(/^KINDS = \(([^)]*)\)/m)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(py.filter(kind => !FAMILIES.includes(kind)), []);   // the site lands first: it keeps every engine kind, maybe more
});
