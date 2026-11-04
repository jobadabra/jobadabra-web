// The broker's last resort after Codex and the Claude subscription is Free AI with its own UTC-day cap; there is no paid-API step and no API key (owner, 3 Nov 2026: "We should not use API Keys at all anymore").
// Offline: Workers AI is a fake binding; any request to a paid provider fails the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, body, harness} from './harness.mjs';

const brokerConfig = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const FREE = {response: 'free answer', usage: {prompt_tokens: 100, completion_tokens: 20}};
// ANTHROPIC_API_KEY is set on purpose: a leftover Worker secret (until the owner deletes it) must change nothing.
const fallbackEnv = (run = async () => FREE) => ({...brokerConfig.vars, ANTHROPIC_API_KEY: 'fixture-not-a-key', AI: {run}, BRAIN_BOT_TOKEN: 'fixture-bot', BRAIN_CHAT_ID: 'fixture-chat'});
const ledger = (free = 0) => ({spent: {'free-ai': free}, held: {'free-ai': 0}, notified: {}});
const dayKey = 'fallback:2026-10-30';
const noPaidProvider = (t, notes = []) => t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (String(url).includes('telegram.org')) { notes.push(JSON.parse(init.body).text); return Response.json({ok: true}); }
  assert.fail(`a paid provider was called: ${url}`);
});

test('Codex out for the week: Free AI answers, keeps the schema, charges its own ledger and the health has no Claude API meter', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const env = fallbackEnv(async (model, request) => {
    assert.equal(model, '@cf/qwen/qwen3-30b-a3b-fp8');
    assert.deepEqual(request.response_format.json_schema.schema, {type: 'object'});
    assert.equal(request.messages[0].content, 'offline test');
    return {response: '{"ok":true}', usage: {prompt_tokens: 100, completion_tokens: 20}};
  });
  const {broker, storage} = harness(undefined, env);
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 3600});
  broker.containerFetch = async () => assert.fail('exhausted Codex must not dispatch');
  const response = await broker.call('scheduled', {...body, schema: {type: 'object'}});
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.equal(answer.engine, 'free-ai'); assert.equal(answer.reply, '{"ok":true}'); assert.deepEqual(answer.tokens, {input: 100, output: 20});
  assert.deepEqual(answer.fellBack.map(entry => entry.engine), ['codex']);
  const state = await storage.get(dayKey);
  assert.equal(state.spent['free-ai'], 12); assert.equal(state.held['free-ai'], 0);   // ceil(100 × .0509 + 20 × .335) microdollars
  const health = (await (await broker.health()).json());
  assert.deepEqual(Object.keys(health.fallback).sort(), ['day', 'freeAi', 'freeAiCap', 'held']);
  assert.deepEqual(health.chain.map(item => item.name), ['codex', 'claude', 'free-ai']);
});

test('Codex usage-limit error falls to Free AI; unrelated or credential-shaped failures do not', async t => {
  noPaidProvider(t);
  for (const [error, expected] of [["codex-failed:1 You've hit your usage limit", 200], ['codex failed', 502], ['codex-failed:1 rate_limit_exceeded', 502], ['usage limit sk-' + 'a'.repeat(30), 502]]) {
    const {broker} = harness(undefined, fallbackEnv());
    broker.containerFetch = async () => Response.json({error}, {status: 500});
    const reply = await broker.call('pr', body);
    assert.equal(reply.status, expected);
    if (expected === 200) assert.equal((await reply.json()).engine, 'free-ai');
  }
});

test('Free AI at its day cap refuses with the cap as the reason, alerts once per UTC day, survives eviction and rolls over', async t => {
  let now = day;
  t.mock.method(Date, 'now', () => now);
  const notes = [];
  noPaidProvider(t, notes);
  const {broker, storage, restart} = harness(undefined, fallbackEnv());
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 10 * 86400});   // the week stays used up across the UTC rollover
  await storage.put(dayKey, ledger(2_000_000));
  for (const owner of [broker, restart(), restart()]) {
    const reply = await owner.call('pr', body);
    assert.equal(reply.status, 429); assert.equal((await reply.json()).why, 'budget:fallback-day $2 Free AI (UTC)');
  }
  assert.equal(notes.length, 1); assert.match(notes[0], /Free AI daily cap \$2 reached/); assert.ok(!/Claude/.test(notes[0]));
  now += 86400000;
  assert.equal((await (await restart().health()).json()).fallback.freeAi, 0);
  assert.equal((await (await restart().call('pr', body)).json()).engine, 'free-ai');
  await storage.put('fallback:2026-10-31', ledger(2_000_000));
  await restart().call('pr', body);
  assert.equal(notes.length, 2, 'the cap can alert again on a new UTC day');
});

test('both subscriptions out and Free AI off: the call fails with Codex\'s own reason, nothing paid is tried', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const env = fallbackEnv(); env.FALLBACK_FREE_AI_DAY_USD = '0';
  const {broker, storage} = harness(undefined, env);
  await storage.put('limits', {usedPercent: 100});
  const reply = await broker.call('pr', body);
  assert.equal(reply.status, 429); assert.match((await reply.json()).why, /^budget:week /);
  assert.equal((await (await broker.health()).json()).fallback.freeAiCap, 0);
});

test('a ledger stored before the paid API was removed still works and its Claude meter is never read', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const {broker, storage} = harness(undefined, fallbackEnv());
  await storage.put('limits', {usedPercent: 100});
  await storage.put(dayKey, {spent: {claude: 5_000_000, 'free-ai': 0}, held: {claude: 0, 'free-ai': 0}, notified: {claude: true}});
  const reply = await broker.call('pr', body);
  assert.equal(reply.status, 200); assert.equal((await reply.json()).engine, 'free-ai');
  assert.equal((await (await broker.health()).json()).fallback.freeAi > 0, true);
});

test('fallback keeps drift daily admission; a search or an image Free AI cannot take goes grey, not to another engine', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const {broker, storage} = harness(undefined, fallbackEnv());
  await storage.put('limits', {usedPercent: 100});
  const search = await broker.call('scheduled', {...body, search: true});
  assert.equal(search.status, 503); assert.match((await search.json()).why, /fallback:search-unsupported/);
  for (let i = 0; i < 24; i++) assert.equal((await broker.call('drift', body)).status, 200);
  const denied = await broker.call('drift', body);
  assert.equal(denied.status, 429); assert.match((await denied.json()).why, /budget:daily/);
  const image = await broker.call('pr', {...body, images: [{name: 'a.png', base64: 'ZmFrZQ=='}]});
  assert.equal(image.status, 503); assert.match((await image.json()).why, /fallback:unsupported/);
});

test('concurrent Free AI calls reserve the balance before the provider runs: one is admitted, the other is refused by the cap', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  let called = 0, held;
  const env = fallbackEnv(async () => {
    called++; held = (await storage.get(dayKey)).held['free-ai'];
    assert.ok(held > 0 && held <= 1_000);
    await new Promise(resolve => setTimeout(resolve, 5));
    return FREE;
  });
  delete env.BRAIN_BOT_TOKEN;
  const {broker, storage} = harness(undefined, env);
  await storage.put('limits', {usedPercent: 100});
  await storage.put(dayKey, ledger(1_999_000));   // $0.001 left: the first call's hold takes all of it
  const replies = await Promise.all([broker.call('pr', body), broker.call('pr', body)]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 429]);
  assert.equal(called, 1);
  const state = await storage.get(dayKey);
  assert.equal(state.held['free-ai'], 0); assert.equal(state.spent['free-ai'], 1_999_012);
});

test('a provider failure keeps the reservation (usage unknown) and says unavailable, not "cap reached"', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const env = fallbackEnv(async () => { throw new Error('offline provider failure'); }); delete env.BRAIN_BOT_TOKEN;
  const {broker, storage} = harness(undefined, env);
  await storage.put('limits', {usedPercent: 100});
  const reply = await broker.call('pr', body);
  assert.equal(reply.status, 503); assert.equal((await reply.json()).why, 'fallback:unavailable');
  const state = await storage.get(dayKey);
  assert.equal(state.spent['free-ai'], 0); assert.ok(state.held['free-ai'] > 0);
});

test('a new Codex week retries Codex before Free AI spends anything', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const {broker, storage} = harness({resetsAt: day / 1000 - 1, tokens: {pr: 72_000_000}, daily: {day: null, calls: {drift: 0}}}, fallbackEnv(async () => assert.fail('the expired week must retry Codex')));
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 - 1});
  assert.equal((await (await broker.call('pr', body)).json()).reply, 'ok');
});

test('known usage is charged even for rejected answers and overclaims; unknown usage keeps its reservation', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  const answers = [
    [{response: '', usage: {prompt_tokens: 100, completion_tokens: 20}}, 'fallback:reply-refused', 12],
    [{response: 'sk-' + 'a'.repeat(30), usage: {prompt_tokens: 100, completion_tokens: 20}}, 'fallback:reply-refused', 12],
    [{response: 'no meter'}, 'fallback:unavailable', 0],
    [{response: 'bad usage', usage: {prompt_tokens: 100, completion_tokens: 1_000_000}}, 'fallback:usage-exceeded-reservation', 335_006],
  ];
  for (const [result, why, spent] of answers) {
    const env = fallbackEnv(async () => result); delete env.BRAIN_BOT_TOKEN;
    const {broker, storage} = harness(undefined, env);
    await storage.put('limits', {usedPercent: 100});
    const reply = await broker.call('pr', body);
    assert.equal(reply.status, 503); assert.equal((await reply.json()).why, why);
    const state = await storage.get(dayKey);
    assert.equal(state.spent['free-ai'], spent); assert.equal(state.held['free-ai'] > 0, spent === 0);
  }
});

test('Free AI filtered or errored completions go grey while known usage is still charged', async t => {
  t.mock.method(Date, 'now', () => day);
  noPaidProvider(t);
  for (const finish_reason of ['content_filter', 'error', 'length', 'tool_calls']) {
    const env = fallbackEnv(async () => ({choices: [{message: {content: 'not a completed answer'}, finish_reason}], usage: {prompt_tokens: 100, completion_tokens: 20}}));
    const {broker, storage} = harness(undefined, env);
    await storage.put('limits', {usedPercent: 100});
    const response = await broker.call('pr', body);
    assert.equal(response.status, 503); assert.equal((await response.json()).why, 'fallback:reply-refused');
    const state = await storage.get(dayKey);
    assert.equal(state.spent['free-ai'], 12); assert.equal(state.held['free-ai'], 0);
  }
});

// Guard: money — the broker's paid-API step was removed on the owner's word (3 Nov 2026); a source that reaches the provider or reads its key would spend money no test sees.
test('no broker source reads an API key or calls the Anthropic API itself (the container host allowlist for the subscription CLI is not that)', async () => {
  const {readdirSync} = await import('node:fs');
  const dir = new URL('../../../../workers/ai-broker/', import.meta.url);
  const files = ['worker.js', ...readdirSync(new URL('lib/', dir)).map(name => `lib/${name}`)];
  assert.ok(files.length > 5);
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /https:\/\/api\.anthropic\.com\/v1|env\.ANTHROPIC_API_KEY|x-api-key/, file);
  }
});

test('a Free AI answer that ends after UTC midnight is charged to the day it was admitted', async t => {
  let now = day;
  t.mock.method(Date, 'now', () => now);
  noPaidProvider(t);
  const {broker, storage} = harness(undefined, fallbackEnv(async () => { now = day + 2000; return FREE; }));
  await storage.put('limits', {usedPercent: 100, resetsAt: day / 1000 + 10 * 86400});
  assert.equal((await broker.call('pr', body)).status, 200);
  assert.equal((await storage.get(dayKey)).spent['free-ai'], 12);
  assert.equal(await storage.get('fallback:2026-10-31'), undefined);
});
