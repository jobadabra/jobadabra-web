// Guards the CLI boundary without starting Codex or using a login.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArgs} from '../../../../workers/ai-broker/lib/args.mjs';

const original = ['exec', '--skip-git-repo-check', '--ignore-user-config', '--ephemeral', '-s', 'read-only', '--disable', 'shell_tool', '-c', 'analytics.enabled=false', '--json', '-o', 'out.txt'];

test('omitted search preserves the CLI options and reads the prompt from stdin', () => {
  assert.deepEqual(buildArgs({prompt: 'hello'}), [...original, '--', '-']);
  assert.deepEqual(buildArgs({prompt: '--help', model: 'gpt-6.1-sol', schema: {type: 'object'}, imageNames: ['img0.png', 'img1.jpg']}),
    [...original, '-m', 'gpt-6.1-sol', '--output-schema', 'schema.json', '-i', 'img0.png', '-i', 'img1.jpg', '--', '-']);
});

test('search true adds the public adapter live-search config before the prompt', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', search: true}), [...original, '-c', 'web_search="live"', '--', '-']);
});

test('search false preserves the CLI options and stdin marker', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', search: false}), [...original, '--', '-']);
});

test('effort adds the reasoning-effort config before the prompt; omitted effort leaves the CLI arguments untouched', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', effort: 'high'}), [...original, '-c', 'model_reasoning_effort="high"', '--', '-']);
  assert.deepEqual(buildArgs({prompt: 'hello', search: true, effort: 'low'}), [...original, '-c', 'web_search="live"', '-c', 'model_reasoning_effort="low"', '--', '-']);
  assert.deepEqual(buildArgs({prompt: 'hello', effort: undefined}), [...original, '--', '-']);
  assert.deepEqual(buildArgs({prompt: 'x', effort: 'high"; sandbox_mode="danger-full-access'}), [...original, '-c', 'model_reasoning_effort="highsandboxmodedangerfullaccess"', '--', '-'], 'a stray value cannot become another config key');
});

// Why (13 Nov 2026, cx; 977 deployed calls of run 43358450676: codex exited 7.6 s p50, 5.16 s at least, after turn.completed): at shutdown codex flushes metrics to ab.chatgpt.com, a host the container cannot reach (worker.js HOSTS), and waits for the flush's timeout.
// Measured locally behind a proxy passing only HOSTS, codex 0.162.1 (the image's pin): 10.4 s -> 0.05 s from the answer to the exit with analytics off.
test('every Codex call, new or resumed, turns analytics off so codex exits as soon as it has answered', () => {
  const marker = ['-c', 'analytics.enabled=false'];
  for (const args of [buildArgs({}), buildArgs({keep: true}), buildArgs({resume: 'thread-1', keep: true, search: true, effort: 'low'})]) {
    const at = args.findIndex((arg, i) => arg === marker[0] && args[i + 1] === marker[1]);
    assert.ok(at > 0 && at < args.indexOf('-'), `analytics off before the stdin marker: ${args.join(' ')}`);
  }
});
