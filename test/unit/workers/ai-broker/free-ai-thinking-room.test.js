// Free AI's output ceiling must leave room for a long answer (Qwen3's hidden thinking counted against max_tokens, 7 Nov: 6096 cut it), inside the model's context window. Window sizes scale with the model's window, so a model change keeps these honest.
// Why (8 Nov 2026, fr; owner: "why not falling back to Claude or Free AI?"): with Codex past its (then) 70% line every scheduled call landed on Free AI (since 8 Nov 2026 only a call past Claude's 90% does), and calls that thought past the fixed 6096-token ceiling
// came back `finish_reason: length` and were thrown away as `fallback:reply-refused` (replayed on the 7 Nov digest prompt: 2 of 5; Search check: 33 of ~500 calls). Offline: Workers AI is a fake model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, harness} from './harness.mjs';
import {FREE_WINDOW} from '../../../../workers/ai-broker/lib/free-model.mjs';

const brokerConfig = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const dayKey = 'fallback:2026-10-30';
const WINDOW = FREE_WINDOW;   // the model's context window: prompt + max_tokens above it is refused by the provider
const noNetwork = t => t.mock.method(globalThis, 'fetch', async url => { throw new Error(`unexpected network call: ${url}`); });

/** A thinking model: `think` hidden tokens first, then `answer` tokens; stops with `length` when max_tokens ends first; refuses a request whose prompt plus max_tokens passes its window. */
function thinkingModel({think, answer, seen = [], bytesPerToken = 4.2}) {
  return async (model, request) => {
    const prompt = Math.ceil(JSON.stringify(request).length / bytesPerToken);   // measured 8 Nov 2026: 4.2 bytes per token on the digest prompt, ~1 on digits
    seen.push({max: request.max_tokens, prompt});
    if (prompt + request.max_tokens > WINDOW) throw new Error(`AiError: {"error":{"message":"This model's maximum context length is ${WINDOW} tokens. However, you requested ${request.max_tokens} output tokens and your prompt contains at least ${prompt} input tokens, for a total of at least ${prompt + request.max_tokens} tokens.","code":400}}`);   // the provider's words, probed 8 Nov 2026
    const made = Math.min(request.max_tokens, think + answer), done = think + answer <= request.max_tokens;
    return {choices: [{message: {content: done ? '{"ok":true}' : '', reasoning_content: 'hmm '.repeat(40)}, finish_reason: done ? 'stop' : 'length'}], usage: {prompt_tokens: prompt, completion_tokens: made}};
  };
}
const env = run => ({...brokerConfig.vars, AI: {run}});
const past = async storage => storage.put('limits', {usedPercent: 100});   // Codex out for the week: the call goes to Free AI

test('a call that spends 7,000 tokens before a 2,500-token answer is answered, not refused for being cut off', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const seen = [], {broker, storage} = harness(undefined, env(thinkingModel({think: 7000, answer: 2500, seen})));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: 'x'.repeat(2000)});
  assert.equal(reply.status, 200, 'the 7 Nov digest was cut at 6096 tokens with a 6096-token ceiling');
  assert.equal((await reply.json()).engine, 'free-ai');
  assert.ok(seen[0].max >= 9500, `ceiling ${seen[0].max}`);
});

test('the ceiling never lets prompt plus output pass the model window: a prompt near the window gets a smaller ceiling than 16000', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const seen = [], {broker, storage} = harness(undefined, env(thinkingModel({think: 1500, answer: 3000, seen})));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: 'p'.repeat(740_000)});
  assert.equal(reply.status, 200);
  assert.ok(seen[0].max < 16000 && seen[0].max >= 256 && seen[0].prompt + seen[0].max <= WINDOW, `prompt ${seen[0].prompt} + ceiling ${seen[0].max}`);
});

test('a prompt with no room left in the window says so, and is neither sent nor reported as the day cap', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const seen = [], notes = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { notes.push(init?.body); return Response.json({ok: true}); });
  const {broker, storage} = harness(undefined, {...env(thinkingModel({think: 1, answer: 1, seen})), BRAIN_BOT_TOKEN: 'fixture-bot', BRAIN_CHAT_ID: 'fixture-chat'});
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: 'p'.repeat(800_000)});
  assert.equal(reply.status, 503); assert.equal((await reply.json()).why, 'fallback:prompt-too-large');
  assert.equal(seen.length, 0); assert.equal(notes.length, 0, 'no "daily cap reached" note for a prompt that is simply too long');
  const state = await storage.get(dayKey);
  assert.ok(!state || state.held['free-ai'] === 0);
});

test('a call that thinks past even the widened ceiling is still refused, and its known usage is charged', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const {broker, storage} = harness(undefined, env(thinkingModel({think: 30_000, answer: 100})));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: 'x'});
  assert.equal(reply.status, 503); assert.equal((await reply.json()).why, 'fallback:reply-refused');
  const state = await storage.get(dayKey);
  assert.ok(state.spent['free-ai'] > 0 && state.held['free-ai'] === 0);
});

test('a dense prompt (1 byte per token, like digits) that the 3-bytes estimate misjudges is retried once with the room the provider reports', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const seen = [], {broker, storage} = harness(undefined, env(thinkingModel({think: 500, answer: 800, seen, bytesPerToken: 1})));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: '7'.repeat(245_000)});
  assert.equal(reply.status, 200, 'the first try asked for 16000 on a 245,000-token prompt: over the window');
  assert.equal(seen.length, 2); assert.ok(seen[1].prompt + seen[1].max <= WINDOW);
  const state = await storage.get(dayKey);
  assert.equal(state.held['free-ai'], 0);
});

test('a prompt the provider says cannot fit even after the retry is prompt-too-large and its hold is released', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const {broker, storage} = harness(undefined, env(thinkingModel({think: 1, answer: 1, bytesPerToken: 0.6})));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: '7'.repeat(300_000)});   // estimate: ~100,000 tokens, real: ~500,000
  assert.equal(reply.status, 503); assert.equal((await reply.json()).why, 'fallback:prompt-too-large');
  const state = await storage.get(dayKey);
  assert.equal(state.held['free-ai'], 0); assert.equal(state.spent['free-ai'], 0);
});

test('an unavailable Free AI logs the provider\'s message, not a blanked line (Gitar on #490)', async t => {
  t.mock.method(Date, 'now', () => day); noNetwork(t);
  const lines = []; t.mock.method(console, 'error', line => lines.push(String(line)));
  const {broker, storage} = harness(undefined, env(async () => { throw new Error('AiError: {"error":{"message":"Capacity temporarily exceeded, please retry","code":3040}}'); }));
  await past(storage);
  const reply = await broker.call('pr', {tier: 'small', prompt: 'x'});
  assert.equal((await reply.json()).why, 'fallback:unavailable');
  assert.ok(lines.some(line => /free-ai-step unavailable: Capacity temporarily exceeded, please retry model=/.test(line)), lines.join('\n'));
});
