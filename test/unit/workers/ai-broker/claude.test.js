// The Claude Code CLI helpers of the broker's container (container/claude.mjs): arguments, input and the reading of its stream. Offline: no CLI, no token, no network.
// The result and rate-limit lines are taken from a real call of CLI 2.1.316 on the owner's subscription (1 Nov 2026), trimmed to the fields the code reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CLAUDE_TIMEOUT_MS, claudeArgs, claudeInput, readClaude, SYSTEM_PROMPT} from '../../../../workers/ai-broker/container/claude.mjs';

const line = o => `${JSON.stringify(o)}\n`;
const allowed = {type: 'rate_limit_event', rate_limit_info: {status: 'allowed', resetsAt: 1793588400, rateLimitType: 'five_hour', unifiedWindows: {five_hour: {utilization: 0.2, resetsAt: 1793588400, status: 'allowed'}, seven_day: {utilization: 0.05, resetsAt: 1794088800, status: 'allowed'}}}};
const ok = {type: 'result', subtype: 'success', is_error: false, result: 'pong', stop_reason: 'end_turn', usage: {input_tokens: 384, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0}};

test('the arguments are the measured lean ones: no tools, settings, slash commands or MCP, and never --bare (it refuses an OAuth token)', () => {
  const args = claudeArgs({model: 'claude-haiku-5-5'});
  assert.deepEqual(args, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config', '--system-prompt', SYSTEM_PROMPT, '--model', 'claude-haiku-5-5']);
  assert.ok(!args.includes('--bare'));
  assert.deepEqual(claudeArgs({model: 'm', schema: {type: 'object'}}).slice(-2), ['--json-schema', '{"type":"object"}']);
});

test('an effort goes to the CLI as --effort, after the lean arguments; none asked, none sent (CLI 2.1.316 takes low, medium, high, xhigh and max)', () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh']) {
    const args = claudeArgs({model: 'm', effort});
    assert.deepEqual(args.slice(0, -2), claudeArgs({model: 'm'}), 'every other argument is the lean one');
    assert.deepEqual(args.slice(-2), ['--effort', effort]);
  }
  assert.deepEqual(claudeArgs({model: 'm', schema: {type: 'object'}, effort: 'low'}).slice(-4), ['--json-schema', '{"type":"object"}', '--effort', 'low']);
  assert.ok(!claudeArgs({model: 'm', effort: undefined}).includes('--effort'));
});

test('a search call gets exactly one tool, WebSearch, allowed up front; every other argument is the lean one (measured live 2 Nov 2026: 22.5 s, answer with its sources)', () => {
  const lean = claudeArgs({model: 'claude-haiku-5-5'}), search = claudeArgs({model: 'claude-haiku-5-5', search: true});
  const expected = [...lean]; expected.splice(expected.indexOf('--tools'), 2, '--tools', 'WebSearch', '--allowedTools', 'WebSearch');
  assert.deepEqual(search, expected, 'only the tool arguments differ from the lean call');
  assert.ok(!search.includes('--bare') && !search.includes('Bash') && !search.includes('WebFetch'), 'no shell, no page fetching');
  assert.deepEqual(claudeArgs({model: 'm', search: false}), claudeArgs({model: 'm'}));
});

test('the prompt and images are one stream-json line; an image the CLI cannot take is refused before the call', () => {
  const sent = JSON.parse(claudeInput({prompt: 'What colour?', images: [{name: 'a.PNG', base64: 'QUJD'}, {name: 'b.jpeg', base64: 'REVG'}]}));
  assert.equal(sent.type, 'user');
  assert.deepEqual(sent.message.content, [{type: 'text', text: 'What colour?'}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'QUJD'}}, {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: 'REVG'}}]);
  assert.ok(claudeInput({prompt: 'x'}).endsWith('\n') && !claudeInput({prompt: 'x'}).slice(0, -1).includes('\n'));
  assert.throws(() => claudeInput({prompt: 'x', images: [{name: 'a.bmp', base64: 'QQ=='}]}), /unsupported image/);
  assert.throws(() => claudeInput({prompt: 'x', images: [{name: 'a.png'}]}), /unsupported image/);
});

test('a good answer gives the text, the tokens (cache counted as input, and told apart) and the subscription windows', () => {
  const read = readClaude(line({type: 'system', subtype: 'init'}) + line(allowed) + line({...ok, usage: {...ok.usage, cache_creation_input_tokens: 100, cache_read_input_tokens: 20}}));
  assert.equal(read.reply, 'pong');
  assert.deepEqual(read.tokens, {input: 504, cached: 20, cacheWritten: 100, output: 4});   // `input` still folds the cache in (the meter reads it); `cached` is the part read from the cache, as Codex's `cached`
  assert.deepEqual(read.limits, {status: 'allowed', fiveHour: allowed.rate_limit_info.unifiedWindows.five_hour, sevenDay: allowed.rate_limit_info.unifiedWindows.seven_day});
});

test('"ran out" is read from the stream\'s own window status first, then from the message; an expired token is its own word; anything else is a plain failure, never guessed as "ran out"', () => {
  const rejected = {...allowed, rate_limit_info: {...allowed.rate_limit_info, status: 'rejected', resetsAt: 1793600000}};
  assert.deepEqual(readClaude(line(rejected) + line({type: 'result', is_error: true, result: 'Something went wrong'}), '', 1).error, 'claude-limit');
  assert.equal(readClaude(line(rejected) + line({type: 'result', is_error: true, result: 'x'})).resetsAt, 1793600000);
  assert.equal(readClaude(line({type: 'result', is_error: true, result: "You've hit your usage limit"})).error, 'claude-limit');
  assert.equal(readClaude(line({type: 'result', is_error: true, result: "You've hit your usage limit"})).resetsAt, null);   // text only: no reset time is borrowed
  // Gitar on #291: the stream says the window is allowed, then a passing 429: a plain failure, never "ran out until the five-hour reset"
  const throttled = readClaude(line(allowed) + line({type: 'result', is_error: true, result: 'API Error: 429 Too Many Requests'}), '', 1);
  assert.match(throttled.error, /^claude-failed:1 API Error: 429/); assert.equal(throttled.resetsAt, undefined);
  assert.equal(readClaude(line({type: 'result', is_error: true, result: 'Not logged in · Please run /login'})).error, 'claude-auth');
  assert.equal(readClaude('', 'Error: 401 Unauthorized').error, 'claude-auth');
  assert.match(readClaude(line(allowed) + line({type: 'result', is_error: true, result: 'Overloaded, try again'}), '', 1).error, /^claude-failed:1 Overloaded/);
  assert.match(readClaude('garbage', 'segfault', 139).error, /^claude-failed:139 segfault/);
  assert.match(readClaude(line(allowed) + line({...ok, result: '  '})).error, /^claude-failed/);   // an empty answer is a failure
});

// 2 Nov 2026: the real daily-digest prompt (145 PRs) made Claude think for 95 s and the 100 s kill ended it with the tail of its stream as the "reason".
test('a call killed by our own timer says "timeout", not the tail of its stream; the same stream without the kill stays a plain failure', () => {
  const stream = [{type: 'assistant', message: {content: [{type: 'thinking', thinking_duration_ms: 95200}]}}, {type: 'rate_limit_event', rate_limit_info: {status: 'allowed', unifiedWindows: {}}}].map(line => JSON.stringify(line)).join('\n');
  assert.equal(readClaude(stream, '', null, true).error, 'claude-failed:timeout after 150 s');
  assert.match(readClaude(stream, '', null, false).error, /^claude-failed:null .*thinking_duration_ms/);
});

test('a Claude call may take longer than the slowest measured digest call (117 s) and than Codex\'s 100 s, but must end before the callers stop waiting', () => {
  const callersWait = Number(/AbortSignal\.timeout\((\d+)\)/.exec(readFileSync(new URL('../../../../desktop/e2e/lib/broker-client.mjs', import.meta.url), 'utf8'))?.[1]);
  assert.ok(callersWait >= 150000, 'the public client waits at least 150 s');
  assert.ok(CLAUDE_TIMEOUT_MS > 117000 && CLAUDE_TIMEOUT_MS < callersWait, `${CLAUDE_TIMEOUT_MS} must sit between 117 s and the callers' ${callersWait} ms`);
});
