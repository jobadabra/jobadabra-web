// The AI section of /admin (admin/ai-*.js): the upload of kind "agents" is clamped, the three pages draw agents, steps and engines, and the routes answer the owner only. Moved page: /admin/ai/costs answers the old cost address with a 301.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../../../workers/www/index.js';
import {cleanAgents} from '../../../admin/agent-coding.js';
import {agentsPage} from '../../../admin/ai-agents.js';
import {STYLE} from '../../../admin/ai-section.js';
import {stepsPage} from '../../../admin/ai-steps.js';
import {enginesPage} from '../../../admin/ai-engines.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 's', SELFHEAL_PUBLISH_KEY: 'pub', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: async () => new Response('x')}});
const call = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const now = new Date('2026-11-03T14:00:00Z'), day = '2026-11-03';
const card = {agents: [
  {id: 'sentry-fix', name: 'Sentry fixer', starts: 'Daily 06:30 UTC', acts: 'Opens one PR', engine: 'broker', today: 'one-shot', state: 'on', runs: 'gggg', lastRun: '2026-11-02', prs: {opened: 2, merged: 1, closed: 0, open: 1}},
  {id: 'code-review', name: 'AI code review', issuesOnly: true, starts: 'Every 8 h', acts: 'Files issues', engine: 'broker', today: 'one-shot', state: 'on', runs: 'ggr', lastRun: day, issues: {opened: 36, closed: 35}},
  {id: 'feedback-ai', name: 'Feedback fixer', starts: 'Button', acts: 'Opens a draft PR', engine: 'broker', today: 'one-shot', state: 'idle', runs: 'sss', lastRun: day},
  {id: 'ui-fix', name: 'UI fixer', starts: 'Four a day', acts: 'Opens a PR', engine: 'broker', today: 'one-shot', state: 'off', runs: 'grrg', lastRun: '2026-10-04'}],
  steps: [{name: 'Recipe proposer', file: 'proposer.yml', repo: 'jobadabra-lab', engine: 'api-key'}, {name: 'UI findings', file: 'ui-findings.yml', repo: 'jobadabra', engine: 'broker', state: 'on', runs: 'gcg', lastRun: day}, {name: 'Pipeline: find new jobs', file: 'daily.yml', repo: 'jobadabra', engine: 'api-key', product: true, state: 'idle', runs: ''}]};

test('the agents upload keeps fixed words and clamps the rest', () => {
  const clean = cleanAgents({agents: [{id: 'a<b>', name: 'X'.repeat(90), engine: 'evil', state: 'weird', today: 'x', runs: 'gg<script>', lastRun: 'yesterday', prs: {opened: -3, merged: '4', closed: 1e12}}], steps: [{name: 'S', file: 'a.yml', repo: 'someone-else', engine: 'free'}]});
  const [agent] = clean.agents;
  assert.equal(agent.id, 'ab'); assert.equal(agent.name.length, 60); assert.equal(agent.engine, 'broker'); assert.equal(agent.state, 'idle'); assert.equal(agent.today, 'one-shot');
  assert.equal(agent.runs, ''); assert.equal(agent.lastRun, ''); assert.deepEqual(agent.prs, {opened: 0, merged: 4, closed: 1e7, open: 0});
  assert.equal(clean.steps[0].repo, 'jobadabra');
  assert.equal(cleanAgents({agents: []}), null); assert.equal(cleanAgents(null), null);
});
test('an upload with an array where a string belongs cannot break the Agents page', () => {
  const clean = cleanAgents({agents: [{id: 'a', name: 'A', state: 'on', runs: ['g'], lastRun: ['2026-11-03']}], steps: [{name: 'S', file: 'a.yml', repo: 'jobadabra', state: 'on', runs: ['g'], lastRun: []}]});
  assert.equal(clean.agents[0].runs, ''); assert.equal(clean.agents[0].lastRun, ''); assert.equal(clean.steps[0].runs, '');
  assert.ok(agentsPage(clean, null).includes('1 agents'));
});

test('the Agents page tags issues-only reviewers, shows a red last run and an off agent, with the broker tokens', () => {
  const tally = {days: {[day]: {'jobadabra/sentry-fix.yml': {calls: 3, ok: 3, tokens: 42000, ms: 1, engines: {codex: 3}}}}};
  const html = agentsPage({...card, at: '2026-11-03T13:41:00Z'}, tally, now);
  assert.match(html, /4 agents/); assert.match(html, /skipped runs only, never ran/); assert.match(html, /issues only/); assert.match(html, /last run red/); assert.match(html, /⏸ Off/); assert.match(html, /42\.0k<\/b> tokens/);
  assert.match(html, /PRs, 30 days: <b>2<\/b> opened/); assert.match(html, /Issues, 30 days: <b>36<\/b> filed/); assert.match(html, /data as of 2026-11-03 13:41 UTC/);
  assert.match(agentsPage(null, null, now), /No agent numbers yet/);
  assert.match(STYLE, /\.ai-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/, 'one agent card per row on every width (owner, 4 Nov 2026)');
});
test('the AI steps page flags an API-key job and says which rows have no runs here', () => {
  const html = stepsPage(card, null, now);
  assert.match(html, /3 AI steps/); assert.match(html, /1 CI job still on an API key/, 'the product pipeline is not counted'); assert.match(html, /not read here/); assert.match(html, /no runs of its own/); assert.match(html, /product pipeline/); assert.match(html, /UI findings/);
});
test('the Engines page tells a rejected Claude token and an unreadable broker', () => {
  assert.match(enginesPage(null, now), /broker not readable/);
  assert.match(enginesPage({chain: [{name: 'claude', configured: true, state: 'token-invalid'}]}, now), /Claude token rejected/);
});
test('the routes answer the owner only, show the stored card, and the old cost address redirects', async () => {
  const e = env();
  for (const path of ['/admin/ai/agents', '/admin/ai/steps', '/admin/ai/engines']) assert.equal((await call(e, path)).status, 404, `${path}: no login, no page`);
  const put = await call(e, '/agent-coding/data', {method: 'PUT', headers: {Authorization: 'Bearer pub'}, body: JSON.stringify({kind: 'agents', days: [{day, ...card}]})});
  assert.equal(put.status, 200);
  const agents = await call(e, '/admin/ai/agents', owner), html = await agents.text();
  assert.equal(agents.status, 200); assert.match(html, /Sentry fixer/); assert.match(html, /href="\/admin\/ai\/agents"/, 'the AI group is in the menu');
  assert.match(await (await call(e, '/admin/ai/steps', owner)).text(), /Recipe proposer/);
  assert.equal((await call(e, '/admin/ai/engines', owner)).status, 200);
  const old = await call(e, '/admin/growth/' + 'ai-cost', {...owner, redirect: 'manual'});
  assert.equal(old.status, 301); assert.match(old.headers.get('Location'), /\/admin\/ai\/costs$/);
});
