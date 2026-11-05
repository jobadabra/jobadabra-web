// The hosted runner's deploy: the staging copy never shares the production Worker name or queue, and the workflow is by hand (hr 2/6, 5 Nov 2026).
// Why: a staging runner reading the queue "hosted-runs" would take production's runs and call the wrong site; a push-triggered production deploy would skip the owner's yes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {STAGING, readConfig, stagingConfig} from '../../tools/runner-config.mjs';

const ROOT = new URL('../../', import.meta.url);
const production = readConfig(readFileSync(new URL('workers/hosted-runner/wrangler.jsonc', ROOT), 'utf8'));

test('the committed config is the production one: the Worker www-hosted-runner reads the queue hosted-runs', () => {
  assert.equal(production.name, 'www-hosted-runner');
  assert.deepEqual(production.queues.consumers.map(consumer => consumer.queue), ['hosted-runs']);
  assert.ok(production.containers[0].image.endsWith('hosted/Dockerfile'));
});

test('the staging copy has its own name and queue, the same image, and few instances', () => {
  const staging = stagingConfig(production);
  assert.equal(staging.name, STAGING.name);
  assert.deepEqual(staging.queues.consumers.map(consumer => consumer.queue), [STAGING.queue]);
  assert.equal(staging.containers[0].image, production.containers[0].image);
  assert.equal(staging.containers[0].max_instances, STAGING.maxInstances);
  assert.equal(production.containers[0].max_instances, 20, 'the production config is not changed by making the copy');
});

test('a staging config that still names production fails loudly', () => {
  const same = {...production, queues: {consumers: [{queue: 'hosted-runs'}]}, containers: production.containers};
  assert.throws(() => stagingConfig({...same, name: STAGING.name, queues: {consumers: []}}), /production name or queue/, 'an input already named like staging with no consumer cannot hide the check');
});

test('the deploy workflow is by hand only and picks staging or production', () => {
  const flow = readFileSync(new URL('.github/workflows/release-hosted-runner.yml', ROOT), 'utf8').replace(/^#.*$/gm, '');
  assert.ok(/workflow_dispatch:/.test(flow) && !/^\s{2}(push|schedule|pull_request):/m.test(flow), 'no push, schedule or PR trigger: production waits for the owner');
  assert.ok(/options: \[staging, production\]/.test(flow));
  assert.ok(/runner-config\.mjs staging/.test(flow));
  assert.ok(/environment: \$\{\{ inputs\.target == 'production' && 'production'/.test(flow), 'production runs in its own environment, where the owner is the required reviewer');
  assert.ok(/queues create hosted-runs-staging/.test(flow), 'the staging queue is made when missing');
});
