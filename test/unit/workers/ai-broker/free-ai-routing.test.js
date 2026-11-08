// The broker's Free AI step runs every ask on one model, Gemma 4, and asks for JSON in the prompt (lib/free-model.mjs). One test per routing rule.
// Why (8 Nov 2026, fr; owner: "Gemma 4 for every ask"): Qwen3-30B is gone on 20 Nov, glm-5.3 is limited to 20 calls a minute, and Gemma 4 with a forced response_format looped on blank lines (extraction 0% valid, 4,000 tokens, ~85 s a call).
// Offline: Workers AI is a fake binding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {day, harness} from './harness.mjs';
import {FREE_MODEL, promptWithSchema, stripFence, costOf} from '../../../../workers/ai-broker/lib/free-model.mjs';

const brokerConfig = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const dayKey = 'fallback:2026-10-30';
const noNetwork = t => t.mock.method(globalThis, 'fetch', async url => { throw new Error(`unexpected network call: ${url}`); });
const USAGE = {prompt_tokens: 100, completion_tokens: 20};
const answering = (text, seen = []) => ({...brokerConfig.vars, AI: {run: async (model, request) => { seen.push({model, request}); return {choices: [{message: {content: text}, finish_reason: 'stop'}], usage: USAGE}; }}});
const start = async (t, env) => { t.mock.method(Date, 'now', () => day); noNetwork(t); const made = harness(undefined, env); await made.storage.put('limits', {usedPercent: 100}); return made; };   // Codex out: Free AI answers
const SCHEMA = {type: 'object', required: ['score'], properties: {score: {type: 'number'}}};

test('rule 1, an ask with a schema: Gemma 4, thinking off, the schema in the prompt (no response_format), the fence stripped from the reply', async t => {
  const seen = [], {broker} = await start(t, answering('```json\n{"score": 71}\n```', seen));
  const reply = await broker.call('scheduled', {tier: 'small', prompt: 'Score this job.', schema: SCHEMA});
  assert.equal(reply.status, 200);
  const answer = await reply.json();
  assert.equal(answer.reply, '{"score": 71}', 'callers parse the reply: it must be bare JSON');
  assert.equal(answer.model, FREE_MODEL); assert.equal(seen[0].model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(seen[0].request.response_format, undefined);
  assert.deepEqual(seen[0].request.chat_template_kwargs, {enable_thinking: false});
  assert.equal(seen[0].request.messages[0].content, promptWithSchema('Score this job.', SCHEMA));
});

test('rule 2, an ask without a schema: the prompt goes as written and the reply comes back as the model wrote it', async t => {
  const seen = [], {broker} = await start(t, answering('Here is the digest:\n```\ncode block kept\n```', seen));
  const reply = await broker.call('scheduled', {tier: 'small', prompt: 'Write the digest.'});
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).reply, 'Here is the digest:\n```\ncode block kept\n```');
  assert.equal(seen[0].model, FREE_MODEL); assert.equal(seen[0].request.messages[0].content, 'Write the digest.');
  assert.deepEqual(seen[0].request.chat_template_kwargs, {enable_thinking: false});
});

test('rule 3, a schema ask whose reply is not JSON is fallback:invalid-json, and its known usage is still charged', async t => {
  const {broker, storage} = await start(t, answering('I cannot do that, sorry.'));
  const reply = await broker.call('scheduled', {tier: 'small', prompt: 'x', schema: SCHEMA});
  assert.equal(reply.status, 503); assert.equal((await reply.json()).why, 'fallback:invalid-json');
  const state = await storage.get(dayKey);
  assert.equal(state.spent['free-ai'], Math.ceil(1e6 * costOf({input_tokens: 100, output_tokens: 20}))); assert.equal(state.held['free-ai'], 0);
});

test('rule 4, the cost is Gemma 4\'s list price, not an unknown model\'s dear default', () => {
  assert.equal(costOf({input_tokens: 1e6, output_tokens: 1e6}), 0.4);   // $0.10 + $0.30 per million tokens
});

test('the fence is stripped only around the whole reply, and a bare reply is untouched', () => {
  assert.equal(stripFence('```json\n{"a": "```"}\n```'), '{"a": "```"}');
  assert.equal(stripFence('{"a": 1}'), '{"a": 1}');
  assert.equal(stripFence('  ```\n[1]\n```  '), '[1]');
});
