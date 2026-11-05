// The runner deploy waits for the container rollout (hr, 5 Nov 2026): `wrangler deploy` reports success while the application still runs the old image.
// Why: the staging proof's third press hit the old image 38 s after "deploy success"; the application only moved to the new version 54 s later.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {appNameOf, rolledOut} from '../../tools/wait-container-rollout.mjs';

const ROOT = new URL('../../', import.meta.url);
const image = digest => `registry.cloudflare.com/acct/www-hosted-runner-staging-hostedrunner@sha256:${digest}`;
const version = (number, digest) => ({version: number, configuration: {image: image(digest)}});
const app = (number, digest) => ({version: number, configuration: {image: image(digest)}, health: {instances: {scheduling: 0, starting: 0}}});
const instance = (digest, state = 'running') => ({image: image(digest), status: {state}});

test('the application name is the Worker name and the lower-cased container class', () => {
  assert.equal(appNameOf({name: 'www-hosted-runner-staging', containers: [{class_name: 'HostedRunner'}]}), 'www-hosted-runner-staging-hostedrunner');
  assert.equal(appNameOf({name: 'www-hosted-runner', containers: [{class_name: 'HostedRunner'}]}), 'www-hosted-runner-hostedrunner');
});

test('not rolled out while the application is still on an older version than the newest', () => {
  const answer = rolledOut(app(2, 'aaa'), [version(3, 'bbb'), version(2, 'aaa')], []);   // the try-3 state at 00:54:19
  assert.equal(answer.done, false);
  assert.match(answer.why, /version 2 of 3/);
});

test('not rolled out while an instance still runs another image than the application\'s', () => {
  const answer = rolledOut(app(3, 'bbb'), [version(3, 'bbb'), version(2, 'aaa')], [instance('aaa', 'inactive')]);
  assert.equal(answer.done, false);
  assert.match(answer.why, /1 instance.*old image/);
});

test('not rolled out while the application\'s image is not the newest version\'s, or an instance is starting', () => {
  assert.equal(rolledOut(app(3, 'aaa'), [version(3, 'bbb')], []).done, false);
  const starting = {...app(3, 'bbb'), health: {instances: {scheduling: 1, starting: 0}}};
  assert.equal(rolledOut(starting, [version(3, 'bbb')], [instance('bbb')]).done, false);
});

test('rolled out: the newest version applied and every instance on its image (or none exist yet)', () => {
  assert.equal(rolledOut(app(3, 'bbb'), [version(3, 'bbb'), version(2, 'aaa')], [instance('bbb'), instance('bbb', 'inactive')]).done, true);
  assert.equal(rolledOut(app(3, 'bbb'), [version(3, 'bbb')], []).done, true);
});

test('the deploy workflow waits for the rollout after wrangler deploy, with the same config and token', () => {
  const flow = readFileSync(new URL('.github/workflows/release-hosted-runner.yml', ROOT), 'utf8').replace(/^\s*#.*$/gm, '');
  const deploy = flow.indexOf('wrangler@4 deploy'), wait = flow.indexOf('wait-container-rollout.mjs');
  assert.ok(deploy > 0 && wait > deploy, 'the wait comes after the deploy');
  assert.match(flow.slice(wait - 200, wait + 200), /\$CONFIG|wrangler\.(staging\.)?jsonc/, 'it reads the config that was deployed');
});
