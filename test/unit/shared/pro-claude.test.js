// The Pro lane's Claude routing (shared/pro-claude.js, shared/free-ai.js): a Pro account with credit gets a Claude model on the steps with a measured gain, Free never does,
// the kill switch and a missing key keep Workers AI, a failed Claude call falls back to Workers AI, and the credit pays the Claude cost.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {freeAi} from '../../../shared/free-ai.js';
import {digestOf, tokenFor} from '../../../shared/guard.js';
import {addCredit, createAccount, link} from '../../../shared/pro.js';
import {PRO_ROUTES, SONNET, claudeUsd, proRoute} from '../../../shared/pro-claude.js';
import {rawToCredit} from '../../../shared/pro-packages.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql']) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const workersAi = {calls: 0};
const env = (extra = {}) => ({WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', PRO_PLAN: 'test', PRO_ANTHROPIC_KEY: 'sk-test',
  AI: {run: async () => { workersAi.calls++; return {choices: [{message: {content: 'qwen answer'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1000, completion_tokens: 1000}}; }, toMarkdown: async () => []}, ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-27T10:00:30Z');
const claudeMessage = {type: 'message', role: 'assistant', content: [{type: 'text', text: 'claude answer'}], usage: {input_tokens: 1000, output_tokens: 500}, stop_reason: 'end_turn'};
const fetcherOf = (reply = claudeMessage, status = 200) => { const seen = []; const fetcher = async (url, init) => { seen.push({url, init}); return new Response(JSON.stringify(reply), {status}); }; fetcher.seen = seen; return fetcher; };
const ask = (e, key, action, fetcher, extra = {}) => freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key, 'x-jp-action': action},
  body: JSON.stringify({max_tokens: 100, messages: [{role: 'user', content: 'x'}], ...extra})}), e, now, null, fetcher);
async function proInstall(e, install) {
  const account = await createAccount(e, `${install}@example.com`, now);
  assert.equal((await link(e, account, install, now)).ok, true);
  await addCredit(e, account, 5_000_000, 'purchase', 'test', now);
  return {account, who: await digestOf(install), key: await keyOf(install)};
}
const row = (e, sql, ...args) => e.STATS.db.prepare(sql).get(...args);

test('a Pro account with credit gets Claude on a routed step: the answer, the model, the cost from the credit, and no Free counts', async () => {
  const e = env(), pro = await proInstall(e, 'install-claude-01'), fetcher = fetcherOf();
  workersAi.calls = 0;
  const response = await ask(e, pro.key, 'kit', fetcher);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content[0].text, 'claude answer');
  assert.equal(workersAi.calls, 0, 'Workers AI was not called');
  assert.equal(fetcher.seen[0].url, 'https://api.anthropic.com/v1/messages');
  const sent = JSON.parse(fetcher.seen[0].init.body);
  assert.equal(sent.model, SONNET); assert.equal(sent.stream, false);
  assert.equal(fetcher.seen[0].init.headers['x-api-key'], 'sk-test');
  const calls = row(e, 'SELECT model, micro_usd FROM ai_calls');
  assert.equal(calls.model, SONNET); assert.equal(calls.micro_usd, Math.round(claudeUsd(SONNET, claudeMessage.usage) * 1e6));
  assert.equal(5_000_000 - row(e, 'SELECT credit_micro FROM pro_accounts WHERE id = ?', pro.account).credit_micro, rawToCredit(calls.micro_usd), 'the credit pays the Claude cost');
  const freeCounts = [...e.WAITLIST.m].filter(([key]) => /^freeai:(usd|musd|dusd|neu)/.test(key)).map(([, value]) => Number(value));
  assert.ok(freeCounts.length > 0 && freeCounts.every(value => value === 0), "Free's spend and neuron counts do not include a Claude call");
});

test('a streamed request is answered with the finished Claude message as a stream', async () => {
  const e = env(), pro = await proInstall(e, 'install-claude-02'), fetcher = fetcherOf();
  const response = await ask(e, pro.key, 'insight', fetcher, {stream: true});
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(JSON.parse(fetcher.seen[0].init.body).stream, false, 'Claude is asked for the whole message');
  assert.match(await response.text(), /claude answer/);
});

test('Free never reaches Claude, nor does a Pro step with no measured gain', async () => {
  const e = env(), free = await keyOf('install-free-claude'), pro = await proInstall(e, 'install-claude-03'), fetcher = fetcherOf();
  assert.equal((await ask(e, free, 'kit', fetcher)).status, 200);
  assert.equal((await ask(e, pro.key, 'score', fetcher)).status, 200);
  assert.equal((await ask(e, pro.key, 'opportunity', fetcher)).status, 200, 'unrouted steps stay on Workers AI');
  assert.equal(fetcher.seen.length, 0);
});

test('the kill switch, a missing key and a failed Claude call all leave the answer to Workers AI', async () => {
  for (const [label, extra, fetcher] of [['kill switch', {PRO_AI_ROUTING: 'off'}, fetcherOf()], ['no key', {PRO_ANTHROPIC_KEY: undefined}, fetcherOf()],
    ['Claude 500', {}, fetcherOf({type: 'error'}, 500)], ['Claude odd body', {}, fetcherOf({type: 'message', content: []})]]) {
    const e = env(extra), pro = await proInstall(e, `install-fallback-${label.replace(/\W/g, '')}`);
    const response = await ask(e, pro.key, 'kit', fetcher);
    assert.equal(response.status, 200, label);
    assert.equal((await response.json()).content[0].text, 'qwen answer', label);
    assert.equal(row(e, 'SELECT model FROM ai_calls').model.includes('claude'), false, `${label}: recorded as the Workers AI model`);
  }
});

test('guard: every route above Qwen names its measured gain and case count, and a price', () => {
  for (const [step, route] of Object.entries(PRO_ROUTES)) {
    assert.match(route.gain, /\d/, `${step} needs the head-to-head numbers that justify it`);
    assert.ok(route.cases >= 1, `${step} needs its case count`);
    assert.ok(claudeUsd(route.model, {input_tokens: 1000, output_tokens: 1000}) > 0, `${step}: ${route.model} has no price`);
  }
  assert.equal(proRoute('kit', {PRO_ANTHROPIC_KEY: 'k'}), SONNET);
  for (const step of ['answer_review', 'insight', 'prep', 'review', 'interview_patterns', 'interview', 'answer', 'tailor']) assert.equal(proRoute(step, {PRO_ANTHROPIC_KEY: 'k'}), SONNET, `${step}: Sonnet writes (owner, 27 Oct 2026)`);
  assert.equal(proRoute('score', {PRO_ANTHROPIC_KEY: 'k'}), null);
  for (const unmeasured of ['opportunity', 'score', 'decide']) assert.equal(PRO_ROUTES[unmeasured], undefined, `${unmeasured} stays on Workers AI`);
});
