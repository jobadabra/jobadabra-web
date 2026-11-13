// The runner deploy waits for the container rollout (hr, 5 Nov 2026): `wrangler deploy` reports success while the application still runs the old image.
// Why: the staging proof's third press hit the old image 38 s after "deploy success"; the application only moved to the new version 54 s later.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {appNameOf, checkOnce, pushedDigest, rolledOut} from '../../tools/wait-container-rollout.mjs';

const ROOT = new URL('../../', import.meta.url);
const image = digest => `registry.cloudflare.com/acct/find-jobs-runner-staging-engine@sha256:${digest}`;
const version = (number, digest) => ({version: number, configuration: {image: image(digest)}});
const instance = (digest, state = 'running') => ({image: image(digest), status: {state}});
// A rollout as GET /containers/applications/{id}/rollouts answers it (5 Nov 2026, staging).
const rollout = (target, status, step = 2, percent = 100, starting = 0) => ({target_version: target, status, progress: {current_step: step, total_steps: 2, version_distribution: {target_version_percentage: percent}}, health: {instances: {starting, scheduling: 0, failed: 0}}});

test('the application name is the Worker name and the lower-cased container class', () => {
  assert.equal(appNameOf({name: 'find-jobs-runner-staging', containers: [{class_name: 'Engine'}]}), 'find-jobs-runner-staging-engine');
  assert.equal(appNameOf({name: 'find-jobs-runner', containers: [{class_name: 'Engine'}]}), 'find-jobs-runner-engine');
});

test('the 01:27 false DONE: the version with the pushed image is not listed yet, so it waits', () => {
  // Why (5 Nov 2026, hr 6/6 try 5): #380 compared "newest listed 3 = application 3" and said DONE on the old image.
  const answer = rolledOut([version(3, 'aaa')], [rollout(3, 'replaced')], [instance('aaa', 'inactive')], 'sha256:bbb');
  assert.equal(answer.done, false);
  assert.equal(answer.failed, undefined);
  assert.match(answer.why, /pushed image bbb not listed yet/);
});

test('the 01:30 state: the rollout to the pushed version sits at step 1 of 2 (50%), one instance starting: waiting, and the line says so', () => {
  const answer = rolledOut([version(4, 'bbb'), version(3, 'aaa')], [rollout(4, 'progressing', 1, 50, 1), rollout(3, 'replaced')], [instance('aaa', 'inactive')], 'sha256:bbb');
  assert.equal(answer.done, false);
  assert.match(answer.why, /rollout to version 4 progressing, step 1 of 2 \(50% on it; starting 1, failed 0\)/);
});

test('rolled out only when the rollout to the pushed version completed AND every instance runs that digest', () => {
  const versions = [version(4, 'bbb'), version(3, 'aaa')];
  assert.equal(rolledOut(versions, [rollout(4, 'completed')], [instance('aaa', 'inactive')], 'sha256:bbb').done, false);
  const done = rolledOut(versions, [rollout(4, 'completed')], [instance('bbb'), instance('bbb', 'inactive')], 'sha256:bbb');
  assert.deepEqual(done, {done: true, why: 'version 4 (bbb) rolled out'});
  assert.equal(rolledOut(versions, [rollout(4, 'completed')], [], 'sha256:bbb').done, true);   // no instance yet: the next one starts on it
});

// Why (13 Nov 2026, web #638 run 43493632676): the renamed runner's first deploy made a new application whose only version is 1, with no rollout ever; the wait timed out red after 10 min
// while version 1 held the pushed image. A first version is the application as created: nothing to roll from.
test('a new application: its only version, version 1, holds the pushed image and has no rollout: rolled out, not 10 minutes of waiting', () => {
  assert.deepEqual(rolledOut([version(1, 'ccc')], [], [], 'sha256:ccc'), {done: true, why: 'version 1 (ccc) is the new application\'s first version'});
  assert.equal(rolledOut([version(1, 'ccc')], [], [instance('ddd')], 'sha256:ccc').done, false, 'an instance on another image still waits');
  assert.equal(rolledOut([version(2, 'eee'), version(1, 'ccc')], [], [], 'sha256:eee').done, false, 'a later version with no rollout yet still waits');
  assert.equal(rolledOut([version(2, 'eee'), version(1, 'ccc')], [], [], 'sha256:ccc').done, false, 'version 1 of an older application is not a fresh one');
});

test('a rollout Cloudflare reverted or replaced fails the wait at once (no 10-minute wait for a rollout that will never come)', () => {
  for (const status of ['reverted', 'replaced']) {
    const answer = rolledOut([version(4, 'bbb')], [rollout(4, status)], [], 'sha256:bbb');
    assert.equal(answer.failed, true, status);
    assert.match(answer.why, new RegExp(`${status} the rollout to version 4`));
  }
});

test('a redeploy of an image an older version already used waits for its new version instead of failing on the old one\'s replaced rollout', () => {
  // Why (5 Nov 2026, Gitar on #383): a revert builds to the same digest as version 2; before version 4 is listed, version 2 (rollout "replaced") was taken as the target.
  const before = rolledOut([version(2, 'bbb'), version(3, 'aaa')], [rollout(3, 'completed'), rollout(2, 'replaced')], [instance('aaa')], 'sha256:bbb');
  assert.equal(before.failed, undefined);
  assert.equal(before.done, false);
  assert.match(before.why, /version 2 with the pushed image is an old one/);
  const listed = rolledOut([version(2, 'bbb'), version(4, 'bbb'), version(3, 'aaa')], [rollout(4, 'progressing', 1, 50), rollout(3, 'replaced'), rollout(2, 'replaced')], [instance('aaa')], 'sha256:bbb');
  assert.match(listed.why, /rollout to version 4 progressing/);   // the newest version with that digest, whatever the list's order
});

test('no image pushed: the target is the latest rollout, with the same verdict', () => {
  assert.equal(rolledOut([version(3, 'aaa')], [rollout(3, 'completed')], [instance('aaa')]).done, true);
  assert.equal(rolledOut([version(4, 'bbb'), version(3, 'aaa')], [rollout(4, 'pending', 1, 0)], [instance('aaa')]).done, false);
  assert.match(rolledOut([], [], []).why, /no rollout listed yet/);
});

test('images without a digest (a tag reference) are compared as whole strings, never as equal-because-empty', () => {
  const tagged = (number, tag) => ({version: number, configuration: {image: `registry.cloudflare.com/acct/find-jobs-runner-engine:${tag}`}});
  assert.equal(rolledOut([tagged(4, 'new')], [rollout(4, 'completed')], [{image: 'registry.cloudflare.com/acct/find-jobs-runner-engine:old'}]).done, false);   // Gitar on #380
  assert.equal(rolledOut([tagged(4, 'new')], [rollout(4, 'completed')], [{image: tagged(4, 'new').configuration.image}]).done, true);
});

test('the pushed digest is read from the deploy output, the last one wins; none when no image was pushed', () => {
  const out = 'abc: digest: sha256:aaa size: 1\n3b871bcf: digest: sha256:f381f5c9d114 size: 2412\n SUCCESS  Modified application';
  assert.equal(pushedDigest(out), 'sha256:f381f5c9d114');
  assert.equal(pushedDigest('Deployed find-jobs-runner-staging triggers'), '');
});

test('the deploy workflow waits for the rollout after wrangler deploy, with the same config and token', () => {
  const flow = readFileSync(new URL('.github/workflows/release-hosted-runner.yml', ROOT), 'utf8').replace(/^\s*#.*$/gm, '');
  const deploy = flow.indexOf('wrangler@4 deploy'), wait = flow.indexOf('wait-container-rollout.mjs');
  assert.ok(deploy > 0 && wait > deploy, 'the wait comes after the deploy');
  assert.match(flow.slice(wait - 200, wait + 200), /\$CONFIG|wrangler\.(staging\.)?jsonc/, 'it reads the config that was deployed');
});

test('the workflow keeps the deploy output and hands its pushed digest to the wait', () => {
  const flow = readFileSync(new URL('.github/workflows/release-hosted-runner.yml', ROOT), 'utf8');
  assert.match(flow, /wrangler@4 deploy --config "\$CONFIG"[^\n]*\| tee [^\n]*deploy\.out/);
  assert.match(flow, /set -o pipefail/);
  assert.match(flow, /wait-container-rollout\.mjs "\$CONFIG"[^\n]*--deploy-output=[^\n]*deploy\.out/);
});

test('one failed API call counts as "waiting" with its reason, it does not throw out of the wait (a green deploy must not turn red on a 502)', async () => {
  const flaky = async () => { throw new Error('/containers/applications: 502 Bad Gateway'); };
  const answer = await checkOnce('find-jobs-runner-staging-engine', flaky);
  assert.equal(answer.done, false);
  assert.match(answer.why, /API error: .*502/);
  const none = await checkOnce('find-jobs-runner-staging-engine', async () => []);
  assert.match(none.why, /no application find-jobs-runner-staging-engine yet/);
});

test('one look asks the versions, the rollouts and the instances of the named application', async () => {
  const asked = [];
  const get = async path => { asked.push(path); return path === '/containers/applications' ? [{name: 'x-engine', id: 'A'}] : []; };
  await checkOnce('x-engine', get, 'sha256:bbb');
  assert.deepEqual(asked, ['/containers/applications', '/containers/applications/A/versions', '/containers/applications/A/rollouts', '/containers/applications/A/instances-v2']);
});
