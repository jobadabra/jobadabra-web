// The hosted runner's deploy: the staging copy never shares the production Worker name or queue, and the workflow is by hand (hr 2/6, 5 Nov 2026).
// Why: a staging runner reading the queue "hosted-runs" would take production's runs and call the wrong site; a push-triggered production deploy would skip the owner's yes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {STAGING, readConfig, stagingConfig} from '../../tools/runner-config.mjs';
import {RUNNER_CEILING} from '../../shared/cap-alerts.js';

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
  assert.equal(production.containers[0].max_instances, RUNNER_CEILING, 'the production config is not changed by making the copy');
});

test('the runner keeps its logs (production and the staging copy), so a run that never starts leaves a line', () => {
  assert.deepEqual(production.observability, {enabled: true});
  assert.deepEqual(stagingConfig(production).observability, {enabled: true});
  const worker = readFileSync(new URL('workers/hosted-runner/worker.js', ROOT), 'utf8');
  assert.ok(/onStop\(/.test(worker) && /onError\(/.test(worker), 'the container hooks say when it stops or fails');
});

test('a staging config that still names production fails loudly', () => {
  const same = {...production, queues: {consumers: [{queue: 'hosted-runs'}]}, containers: production.containers};
  assert.throws(() => stagingConfig({...same, name: STAGING.name, queues: {consumers: []}}), /production name or queue/, 'an input already named like staging with no consumer cannot hide the check');
});

test('the deploy workflow is started by public-watch for production or by hand, and picks staging or production', () => {
  // Why (13 Nov 2026, owner: "Deploy unattended (Recommended)"): production follows the engine through public-watch, with no approval click; never on push, schedule or PR of this repo.
  const flow = readFileSync(new URL('.github/workflows/release-hosted-runner.yml', ROOT), 'utf8').replace(/^#.*$/gm, '');
  assert.ok(/workflow_dispatch:/.test(flow) && !/^\s{2}(push|schedule|pull_request):/m.test(flow), 'only dispatched: by public-watch or by hand');
  assert.ok(/options: \[staging, production\]/.test(flow));
  assert.ok(/runner-config\.mjs staging/.test(flow));
  assert.ok(/queues create hosted-runs-staging/.test(flow), 'the staging queue is made when missing');
  const watch = readFileSync(new URL('.github/workflows/public-watch.yml', ROOT), 'utf8');
  assert.match(watch, /public-watch\.sh "\$GITHUB_WORKSPACE" hosted src config templates requirements\.txt requirements-render\.txt/, 'the watch follows every engine path the image COPYs');
  assert.match(watch, /start "\$\{\{ steps\.change\.outputs\.hosted \}\}" "\.public-hosted \.public-hosted-own" release-hosted-runner\.yml -f target=production/, 'a changed engine starts the production deploy');
  assert.match(watch, /gh workflow run "\$@"/, 'start() dispatches what it is given');
  assert.match(watch, /\.public-hosted \.public-hosted-own/, 'both records are kept, or the next watch deploys again');
});

test('the runner Worker parses (its tests cannot import it: @cloudflare/containers does not load under node)', () => {
  // Why (5 Nov 2026, Gitar on #387): an edit moved the comma between queue() and fetch() into a comment; only regexes read the file, so CI stayed green on a Worker that would not load.
  const checked = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('../../workers/hosted-runner/worker.js', import.meta.url))], {encoding: 'utf8'});
  assert.equal(checked.status, 0, checked.stderr);
});
