// admin/jobcost-charts.js and the Costs page (owner, 5 Nov 2026: By job, By workspace, By API key, By group, By day, Free AI, Pro AI become charts). The page keeps every table behind "Show table".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dayFigure, freeStepsFigure, groupFigure, installsFigure, jobFigure, keyFigure, proFigure, providerFigure} from '../../../admin/jobcost-charts.js';
import {JOBS, PROVIDERS, page, summarize} from '../../../admin/jobcost.js';
import {brokerCard} from '../../../admin/ai-broker-card.js';
import {freeSection, freeSummary} from '../../../admin/free-ai-cost.js';
import {proSection} from '../../../admin/pro-ai-cost.js';

const now = new Date('2026-10-04T12:00:00Z');
const rows = [
  {job: 'central-scout', run_id: '1', day: '2026-10-04', at: '2026-10-04T04:50:00Z', usd: 3, calls: 20},
  {job: 'central-scout', run_id: '2', day: '2026-10-03', at: '2026-10-03T04:50:00Z', usd: 1, calls: 8},
  {job: 'ui-fix', run_id: '3', day: '2026-10-03', at: '2026-10-03T10:00:00Z', usd: 2, calls: 1},
];
const TABLE = '<div class="wrap"><table><tr><td>the old table</td></tr></table></div>';

test('By job: bars longest first with the group as a hint and runs, calls, per run in the tooltip; the table is behind the toggle', () => {
  const html = jobFigure(summarize(rows, [], now), JOBS, TABLE);
  assert.ok(html.indexOf('Central scout') < html.indexOf('UI fixer'));
  assert.match(html, /<small>Discovery<\/small>/); assert.match(html, /2 runs · 28 calls · \$2\.000 per run/); assert.match(html, /\$6\.00 · 2 jobs · top: Central scout 67%/);
  assert.match(html, /<details class="vz-more"><summary>Show table<\/summary><div class="wrap"><table><tr><td>the old table/);
  assert.equal(jobFigure(summarize([], [], now), JOBS, TABLE), TABLE, 'no jobs: the table (with its empty message) stands alone');
});

test('By day: oldest first, a day with no bill is hollow, the lead says how much of the bill the jobs explain', () => {
  const s = summarize(rows, [{day: '2026-10-03', usd: 6}], now);
  const html = dayFigure(s, TABLE);
  assert.ok(html.indexOf('data-tip="2026-10-03') < html.indexOf('data-tip="2026-10-04'), 'oldest day first');
  assert.match(html, /Billed not reported yet/); assert.match(html, /stroke-dasharray/); assert.match(html, /over 30 days the jobs explain 50% of the bill/); assert.match(html, /1 day with no bill yet/);
  assert.match(dayFigure(summarize(rows, [], now), TABLE), /not reported yet/);
  assert.doesNotMatch(dayFigure(summarize(rows, [], now), TABLE), /explain/, 'no bill, no claim about it');
});

test('By day: the coverage chip follows the 30 days drawn, not the selected range (Gitar on #384)', () => {
  const billed = [{day: '2026-10-03', usd: 6}, {day: '2026-10-04', usd: 3}];
  // 3 + 3 tracked on the two days, 6 + 3 billed: 67%, whatever range the page shows
  assert.match(dayFigure(summarize(rows, billed, now, '24h'), TABLE), /over 30 days the jobs explain 67% of the bill/);
});

test('By group: a whole split into at most 6 coloured parts; a tail folds into "Other"', () => {
  const groups = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => [name, 10 - i]));
  const html = groupFigure(groups, TABLE);
  assert.match(html, /Other/); assert.doesNotMatch(html, /--s7/); assert.match(html, /--s6/); assert.match(html, /A is 20% of the spend/);
  assert.equal(groupFigure({}, TABLE), TABLE);
});

test('By API key and By workspace: ranked bars of the range cost; the noun and the leader in the lead, today and last use in the tooltip', () => {
  const keys = [{key: 'ci-main', today: 3, range: 80, last: '2026-10-04'}, {key: 'ci-tests', today: 1, range: 20, last: '2026-10-03'}];
  const html = keyFigure(keys, 'keys', TABLE);
  assert.match(html, /2 keys/); assert.match(html, /ci-main is 80%/); assert.match(html, /today \$1\.00 · last used 2026-10-03/);
  assert.match(keyFigure(keys, 'workspaces', TABLE), /2 workspaces/);
  assert.equal(keyFigure([], 'keys', TABLE), TABLE);
});

test('By provider: a thin split with each share; nothing spent means the table alone', () => {
  const s = summarize(rows, [], now);
  assert.match(providerFigure(s, PROVIDERS, TABLE), /Claude \(Anthropic\)[\s\S]*100%/);
  assert.equal(providerFigure(summarize([], [], now), PROVIDERS, TABLE), TABLE);
});

test('Free AI: each install against its day money, day tokens and month lines; amber at 70%; steps as bars', () => {
  const lines = {installDayUsd: 0.5, tokensPerDay: 1500000, installMonthUsd: 5};
  const installs = [{who: 'amber0ak', day: 0.4, month: 1, tokens: 300000}, {who: 'birch7ly', day: 0.05, month: 0.1, tokens: 10000}];
  const html = installsFigure(installs, lines, TABLE);
  assert.match(html, /2 installs/); assert.match(html, /1 near a line/); assert.match(html, /Day tokens/);
  assert.match(html, /amber0ak · today \$0\.40 \(80% of \$0\.5\)/); assert.match(html, /background:var\(--warn\)/, '80% of the day line is amber');
  const steps = freeStepsFigure([{action: 'scout', calls: 2504, usd: 2.59, tokensIn: 100, tokensOut: 50}], TABLE);
  assert.match(steps, /scout · \$2\.59 · 2,504 calls · 150 tokens/);
});

test('Pro AI: bars of the credit used, the raw-cost estimate in the tooltip', () => {
  assert.match(proFigure([{action: 'kit', calls: 2, creditEur: 0.19, estimatedUsd: 0.11}], TABLE), /kit · credit €0\.19 · 2 calls · estimated raw cost \$0\.11/);
});

test('the Costs page: every converted section is a figure that still holds its table, and the page carries the style and the one tooltip', () => {
  const keyRows = [{day: '2026-10-04', key: 'ci-main', usd: 2}, {day: '2026-10-04', key: 'ws.jobadabra-ci', usd: 2}];
  const html = page(rows, [{day: '2026-10-03', usd: 6}], keyRows, '', now);
  for (const title of ['By provider', 'By group', 'By day', 'By API key', 'By workspace', 'By job']) {
    const at = html.indexOf(`${title}</h2>`), end = html.indexOf('</section>', at);
    assert.ok(at > 0, title); assert.match(html.slice(at, end), /class="vz"/, `${title} is a chart`); assert.match(html.slice(at, end), /<details class="vz-more">[\s\S]*<table>/, `${title} keeps its table`);
  }
  assert.equal(html.split('id="tip"').length - 1, 1, 'one tooltip'); assert.match(html, /\.vz\{/);
  assert.match(html, /Central scout/, 'the table text is still on the page');
});

test('Who answered today: a stacked bar per engine, the table behind the toggle; Free AI and Pro AI sections keep theirs too', () => {
  const chain = [{name: 'codex', configured: true, answeredToday: 0, ranOutToday: 436, failedToday: 0, avgMs: null}, {name: 'claude', configured: true, state: 'ready', answeredToday: 350, ranOutToday: 0, failedToday: 3, avgMs: 18394}];
  const html = brokerCard(chain, Date.parse('2026-11-02T01:00:00Z'));
  assert.match(html, /vz-track stack/); assert.match(html, /✓ answered/); assert.match(html, /<details class="vz-more">[\s\S]*<td>Codex<\/td>/);
  const free = freeSection(freeSummary([{day: '2026-10-04', who: 'abc', action: 'scout', model: '@cf/x', calls: 3, tokens_in: 10, tokens_out: 5, micro_usd: 1000}], now), '30 days');
  assert.match(free, /class="vz"/); assert.match(free, /<td>scout<\/td>/);
  const pro = proSection({calls: 1, accounts: 1, creditEur: 0.1, estimatedUsd: 0.05, steps: [{action: 'kit', calls: 1, creditEur: 0.1, estimatedUsd: 0.05}]}, '30 days');
  assert.match(pro, /class="vz"/); assert.match(pro, /<td>kit<\/td>/);
});
