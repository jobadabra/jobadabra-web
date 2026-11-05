// admin/ai-workflow-tokens.js: "tokens per CI workflow" on the AI cost page, from the broker's /health tally (owner, 3 Nov 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {engineMix, jobRows, workflowCard, workflowRows} from '../../../../admin/ai-workflow-tokens.js';
import {jobsOf, tallyOf} from '../../../../shared/ai-broker.js';
import {read, view} from '../../../../admin/jobcost.js';

const TALLY = {days: {
  '2026-11-02': {'jobadabra/ui-findings.yml': {calls: 10, ok: 10, tokens: 1000, ms: 1, engines: {codex: 10}}, 'jobadabra/ai-user-agents.yml': {calls: 200, ok: 190, tokens: 3000, ms: 1, engines: {codex: 100, claude: 90}}},
  '2026-11-03': {'jobadabra/ai-user-agents.yml': {calls: 60, ok: 60, tokens: 6000, ms: 1, engines: {claude: 30, 'free-ai': 30}}},
}};

test('rows sum the days, biggest token user first, with its share of all workflows and what it used today', () => {
  const rows = workflowRows(TALLY, '2026-11-03');
  assert.deepEqual(rows.map(row => row.name), ['jobadabra/ai-user-agents.yml', 'jobadabra/ui-findings.yml']);
  assert.deepEqual([rows[0].calls, rows[0].tokens, rows[0].today], [260, 9000, 6000]);
  assert.equal(rows[1].today, 0);
  assert.equal(Math.round(rows[0].share * 100), 90);
  assert.equal(rows.reduce((sum, row) => sum + row.share, 0).toFixed(6), '1.000000');
  assert.deepEqual(workflowRows({days: {}}, '2026-11-03'), []);
  assert.deepEqual(workflowRows(null, '2026-11-03'), []);
});

test('the engine mix is a percentage per engine, most used first', () => {
  assert.equal(engineMix({codex: 100, claude: 120, 'free-ai': 30}), 'Claude 48% · Codex 40% · Free AI 12%');
  assert.equal(engineMix({}), '');
});

test('the card names each workflow with calls, tokens, today and share; a workflow name cannot inject markup', () => {
  const html = workflowCard({days: {...TALLY.days, '2026-11-03': {...TALLY.days['2026-11-03'], '<b>x</b>.yml': {calls: 1, ok: 1, tokens: 1, ms: 1, engines: {}}}}}, '2026-11-03');
  assert.match(html, /id="ai-workflow-tokens"/);
  assert.match(html, /Tokens per CI workflow/);
  assert.match(html, /<td style="white-space:nowrap">jobadabra\/ai-user-agents\.yml<\/td><td class="n">260<\/td><td class="n">9\.0k<\/td><td class="n">6\.0k<\/td>/);
  assert.match(html, /The last 2 days/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('no tally says so (an older broker build); an empty one says the count has not started, never an empty table', () => {
  assert.match(workflowCard(null, '2026-11-03'), /data unavailable/);
  assert.doesNotMatch(workflowCard(null, '2026-11-03'), /<table/);
  assert.match(workflowCard({days: {}}, '2026-11-03'), /No call counted yet/);
});

test('tallyOf takes only a tally with days', () => {
  assert.equal(tallyOf({tally: TALLY}), TALLY);
  for (const health of [null, {}, {tally: null}, {tally: {}}, {tally: {days: null}}, {tally: 'x'}]) assert.equal(tallyOf(health), null);
});

test('the AI cost page shows the broker tally next to who answered today', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const env = {STATS_KEY: 'fixture-key', STATS_API_KEY: 'fixture-owner', AI_BROKER: {fetch: async () => Response.json({
    fallback: {day: today, freeAi: 0, freeAiCap: 2, held: {freeAi: 0}},
    chain: [{name: 'codex', configured: true, answeredToday: 1, ranOutToday: 0, failedToday: 0}],
    tally: {days: {[today]: {'jobadabra/ai-user-agents.yml': {calls: 5, ok: 5, tokens: 1234, ms: 9, engines: {codex: 5}}}}}})}};
  assert.equal((await read(env)).tally.days[today]['jobadabra/ai-user-agents.yml'].tokens, 1234);
  const response = await view(new Request('https://x.dev/admin/ai/costs', {headers: {Authorization: 'Bearer fixture-owner'}}), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.indexOf('Who answered today') < html.indexOf('Tokens per CI workflow'));
  assert.match(html, /<td style="white-space:nowrap">jobadabra\/ai-user-agents\.yml<\/td><td class="n">5<\/td><td class="n">1\.2k<\/td><td class="n">1\.2k<\/td>/);
});

// Per-job AI cost (owner via mac-32, 5 Nov 2026).
const JOBS = {days: {
  '2026-11-02': {'jobadabra/ai-user-agents.yml|explore': {calls: 100, tokens: 2000}, 'jobadabra/ui-findings.yml|review': {calls: 10, tokens: 900}},
  '2026-11-03': {'jobadabra/ai-user-agents.yml|explore': {calls: 20, tokens: 4000}, 'jobadabra/ai-user-agents.yml|judge': {calls: 5, tokens: 2000}, '|other': {calls: 1, tokens: 5}},
}};

test('job rows sum the days per workflow, biggest first, each with its share of the workflow\'s labelled tokens', () => {
  const by = jobRows(JOBS), agents = by.get('jobadabra/ai-user-agents.yml');
  assert.deepEqual(agents.map(row => [row.job, row.calls, row.tokens]), [['explore', 120, 6000], ['judge', 5, 2000]]);
  assert.deepEqual(agents.map(row => Math.round(row.share * 100)), [75, 25]);
  assert.equal(by.get('jobadabra/ui-findings.yml')[0].share, 1);
  assert.equal(by.get('')[0].job, 'other', 'the shared overflow has no workflow: it is its own line'); assert.equal(by.has('other'), false);
  assert.match(workflowCard(TALLY, '2026-11-03', JOBS), /↳ other jobs \(past the day's label limit\)<\/td><td class="n muted">1<\/td>/, 'the shared overflow is on the page, never invisible');
  assert.equal(jobRows(null).size, 0); assert.equal(jobRows({days: {}}).size, 0);
});

test('the card shows a workflow\'s jobs as sub-rows under it, nothing when no call carried a label, and a job name cannot inject markup', () => {
  const html = workflowCard(TALLY, '2026-11-03', JOBS);
  assert.match(html, /jobadabra\/ai-user-agents\.yml<\/td>[\s\S]*?↳ explore<\/td><td class="n muted">120<\/td><td class="n muted">6\.0k<\/td>[\s\S]*?75% of labelled/);
  assert.ok(html.indexOf('↳ explore') > html.indexOf('ai-user-agents.yml') && html.indexOf('↳ review') > html.indexOf('ui-findings.yml'));
  assert.doesNotMatch(workflowCard(TALLY, '2026-11-03'), /<tr class="job">/); assert.doesNotMatch(workflowCard(TALLY, '2026-11-03', {days: {}}), /<tr class="job">/);
  assert.doesNotMatch(workflowCard(TALLY, '2026-11-03', {days: {'2026-11-03': {'jobadabra/ui-findings.yml|<img src=x>': {calls: 1, tokens: 1}}}}), /<img src=x>/);
});

test('jobsOf reads the broker\'s job tally, null for an older build; the page shows job lines from the broker health', async () => {
  assert.deepEqual(jobsOf({jobs: JOBS}), JOBS); assert.equal(jobsOf({}), null); assert.equal(jobsOf({jobs: {days: null}}), null);
  const today = new Date().toISOString().slice(0, 10);
  const env = {STATS_KEY: 'fixture-key', STATS_API_KEY: 'fixture-owner', AI_BROKER: {fetch: async () => Response.json({fallback: {day: today, freeAi: 0, freeAiCap: 2, held: {freeAi: 0}},
    tally: {days: {[today]: {'jobadabra/ui-findings.yml': {calls: 3, ok: 3, tokens: 900, ms: 1, engines: {codex: 3}}}}}, jobs: {days: {[today]: {'jobadabra/ui-findings.yml|review': {calls: 3, tokens: 900}}}}})}};
  const html = await (await view(new Request('https://x.dev/admin/ai/costs', {headers: {Authorization: 'Bearer fixture-owner'}}), env)).text();
  assert.match(html, /↳ review/); assert.match(html, /100% of labelled/);
});

test('a tally row named "other" shows its own jobs, and the shared overflow is drawn once, under the table (Gitar, 5 Nov 2026)', () => {
  const day = '2026-11-03', tally = {days: {[day]: {other: {calls: 2, ok: 2, tokens: 50, ms: 1, engines: {codex: 2}}}}};
  const html = workflowCard(tally, day, {days: {[day]: {'other|review': {calls: 2, tokens: 50}, '|other': {calls: 4, tokens: 9}}}});
  assert.equal(html.split('↳ review').length - 1, 1, 'the folded workflow\'s job is under its row');
  assert.equal(html.split('↳ other jobs (past the day\'s label limit)').length - 1, 1, 'the shared overflow once');
  assert.equal(html.split('↳ other</td>').length - 1, 0, 'the overflow is not a job of the "other" workflow');
});
