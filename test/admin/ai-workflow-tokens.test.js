// admin/ai-workflow-tokens.js: "tokens per CI workflow" on the AI cost page, from the broker's /health tally (owner, 3 Nov 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {engineMix, workflowCard, workflowRows} from '../../admin/ai-workflow-tokens.js';
import {tallyOf} from '../../shared/ai-broker.js';
import {read, view} from '../../admin/jobcost.js';

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
    fallback: {day: today, claude: 0, freeAi: 0, claudeCap: 5, freeAiCap: 2, held: {claude: 0, freeAi: 0}},
    chain: [{name: 'codex', configured: true, answeredToday: 1, ranOutToday: 0, failedToday: 0}],
    tally: {days: {[today]: {'jobadabra/ai-user-agents.yml': {calls: 5, ok: 5, tokens: 1234, ms: 9, engines: {codex: 5}}}}}})}};
  assert.equal((await read(env)).tally.days[today]['jobadabra/ai-user-agents.yml'].tokens, 1234);
  const response = await view(new Request('https://x.dev/admin/growth/ai-cost', {headers: {Authorization: 'Bearer fixture-owner'}}), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.indexOf('Who answered today') < html.indexOf('Tokens per CI workflow'));
  assert.match(html, /<td style="white-space:nowrap">jobadabra\/ai-user-agents\.yml<\/td><td class="n">5<\/td><td class="n">1\.2k<\/td><td class="n">1\.2k<\/td>/);
});
