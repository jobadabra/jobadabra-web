// Guards the CLI boundary without starting Codex or using a login.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArgs} from '../../../../workers/ai-broker/lib/args.mjs';

const original = ['exec', '--skip-git-repo-check', '--ignore-user-config', '--ephemeral', '-s', 'read-only', '--disable', 'shell_tool', '--json', '-o', 'out.txt'];

test('omitted search preserves the complete original CLI arguments', () => {
  assert.deepEqual(buildArgs({prompt: 'hello'}), [...original, '--', 'hello']);
  assert.deepEqual(buildArgs({prompt: '--help', model: 'gpt-6.1-sol', schema: {type: 'object'}, imageNames: ['img0.png', 'img1.jpg']}),
    [...original, '-m', 'gpt-6.1-sol', '--output-schema', 'schema.json', '-i', 'img0.png', '-i', 'img1.jpg', '--', '--help']);
});

test('search true adds the public adapter live-search config before the prompt', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', search: true}), [...original, '-c', 'web_search="live"', '--', 'hello']);
});

test('search false preserves the original CLI arguments', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', search: false}), [...original, '--', 'hello']);
});

test('effort adds the reasoning-effort config before the prompt; omitted effort leaves the CLI arguments untouched', () => {
  assert.deepEqual(buildArgs({prompt: 'hello', effort: 'high'}), [...original, '-c', 'model_reasoning_effort="high"', '--', 'hello']);
  assert.deepEqual(buildArgs({prompt: 'hello', search: true, effort: 'low'}), [...original, '-c', 'web_search="live"', '-c', 'model_reasoning_effort="low"', '--', 'hello']);
  assert.deepEqual(buildArgs({prompt: 'hello', effort: undefined}), [...original, '--', 'hello']);
  assert.deepEqual(buildArgs({prompt: 'x', effort: 'high"; sandbox_mode="danger-full-access'}), [...original, '-c', 'model_reasoning_effort="highsandboxmodedangerfullaccess"', '--', 'x'], 'a stray value cannot become another config key');
});
