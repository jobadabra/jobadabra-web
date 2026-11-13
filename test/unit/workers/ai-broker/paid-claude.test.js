// Guard: money — the broker's own Anthropic API key (Worker secret CLAUDE_API_KEY) answers only a call that asks for Claude specifically (engine claude, only: true) and only when the Claude plan
// is out (its limit, or the broker's week line); a call that may pass on never spends it; a day cap in dollars closes it again; the key never leaves in a reply. Fakes only: no key, no network.
// Why (13 Nov 2026, owner via the coordinator: "let's create a new API Key, specifically for AI broker. It would be a fallback, when somebody requests specifically Claude and we're out of the
// plan/subscription limits"; "let's do the code change").
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {body, success, harness, switchboard} from './harness.mjs';
import {claudeEnv} from '../../../../workers/ai-broker/container/claude.mjs';
import {paidCap, paidDay, paidMonthCap} from '../../../../workers/ai-broker/lib/paid-claude.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const KEY = 'sk-ant-api03-FIXTURExNOTxAxKEYxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const base = {...config.vars, ENGINE: 'codex', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token', FALLBACK_FREE_AI_DAY_USD: '0'};
const T = Date.parse('2026-11-13T10:00:00Z');
const claudeOnly = {...body, engine: 'claude', only: true, tier: 'mid'};

function world(t, {env = {}, reply = () => Response.json({reply: 'paid ok', tokens: {input: 1_000_000, cached: 0, output: 100_000}, ms: 9})} = {}) {
  t.mock.method(Date, 'now', () => T);
  const sent = [], made = harness(undefined, {...base, ...switchboard(sent), ...env}), claude = [];
  made.broker.containerFetch = async (url, init) => {
    if (url.endsWith('/claude')) { claude.push(JSON.parse(init.body)); return reply(); }
    return url.endsWith('/call') ? success() : new Response('{"ok":true}');
  };
  return {...made, sent, claude};
}
const planOut = storage => storage.put('claude:state', {limitUntil: T + 3600_000});

test('no CLAUDE_API_KEY: a Claude-only call with the plan out is refused as today, and nothing reaches the container', async t => {
  const w = world(t);
  await planOut(w.storage);
  const reply = await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml');
  assert.notEqual(reply.status, 200); assert.equal(w.claude.length, 0);
});

test('CLAUDE_API_KEY set, plan out, a Claude-only call: answered by the key, marked paid, the plan untouched', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY}});
  await planOut(w.storage);
  const reply = await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml');
  assert.equal(reply.status, 200);
  const answer = await reply.json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.paid, true); assert.equal(answer.reply, 'paid ok');
  assert.equal(w.claude.length, 1); assert.equal(w.claude[0].paid, true, 'the container is told to use the key');
  assert.ok(!JSON.stringify(w.claude[0]).includes(KEY), 'the key never travels in a call body');
  assert.equal((await paidDay(w.storage, new Date(T))).usd, 3, '1M input + 100k output on Sonnet at list prices: $2 + $1');
  assert.ok(!JSON.stringify(answer).includes(KEY));
});

test('the week line (not only the plan\'s own limit) opens the paid lane too', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY}});
  await w.storage.put('claude:state', {limits: {sevenDay: {utilization: 0.95, resetsAt: T / 1000 + 86400}}});
  const answer = await (await w.broker.call('bench', claudeOnly, 'jobadabra/search-profiles.yml')).json();
  assert.equal(answer.paid, true);
});

test('a call that may pass on to another engine never spends the key: it moves on as today', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY}});
  await planOut(w.storage);
  const answer = await (await w.broker.call('scheduled', {...body, engine: 'claude'}, 'jobadabra/other.yml')).json();
  assert.notEqual(answer.paid, true); assert.equal(w.claude.filter(sent => sent.paid).length, 0);
});

test('the day cap: past it the lane answers ran-out again; 🟠 near it and 🔴 at it; one note the first time a day the key answers', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY, CLAUDE_API_DAY_USD: '10'}});
  await planOut(w.storage);
  for (let i = 0; i < 4; i++) assert.equal((await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml')).status, 200);   // $3 each: $12 > $10 after the 4th
  const refused = await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml');
  assert.notEqual(refused.status, 200); assert.equal(w.claude.length, 4, 'nothing sent past the cap');
  const caps = w.sent.filter(note => note.event === 'ai-broker-cap').map(note => note.text.slice(0, 2));
  assert.deepEqual(caps, ['🟠', '🔴']);
  assert.equal(w.sent.filter(note => note.event === 'ai-broker-claude-api').length, 1, 'one note a day');
});

test('a reply that holds the key is refused, never sent on', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY}, reply: () => Response.json({reply: `here: ${KEY}`, tokens: {input: 1, output: 1}, ms: 1})});
  await planOut(w.storage);
  const reply = await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml');
  assert.notEqual(reply.status, 200); assert.ok(!(await reply.text()).includes(KEY));
});

test('the container gives the CLI the key and no plan token for a paid call, and the plan token only otherwise', () => {
  const process = {PATH: '/bin', HOME: '/h', CLAUDE_CODE_OAUTH_TOKEN: 'oat', CLAUDE_API_KEY: KEY};
  const paid = claudeEnv(process, true), plan = claudeEnv(process, false);
  assert.equal(paid.ANTHROPIC_API_KEY, KEY); assert.equal(paid.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(plan.CLAUDE_CODE_OAUTH_TOKEN, 'oat'); assert.equal(plan.ANTHROPIC_API_KEY, undefined);
});

test('the owner\'s caps by default: $10 a day and $100 a month', () => {
  assert.deepEqual([paidCap({}), paidMonthCap({})], [10, 100]);
  assert.deepEqual([paidCap(config.vars), paidMonthCap(config.vars)], [10, 100], 'wrangler.jsonc says the same');
});

test('the month cap: past $100 this month the lane answers as if the key were absent, with 🔴 for the month', async t => {
  const w = world(t, {env: {CLAUDE_API_KEY: KEY}});
  await planOut(w.storage);
  await w.storage.put('paid-month:2026-11', {usd: 98});
  assert.equal((await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml')).status, 200);   // $98 + $3 = $101
  assert.notEqual((await w.broker.call('bench', claudeOnly, 'jobadabra-benchmarks/search-ours.yml')).status, 200);
  assert.equal(w.claude.length, 1);
  const month = w.sent.filter(note => note.event === 'ai-broker-cap' && /this month/.test(note.text)).map(note => note.text.slice(0, 2));
  assert.deepEqual(month, ['🔴']);
});
