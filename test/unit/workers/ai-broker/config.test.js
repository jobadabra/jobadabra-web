// Guards the AI broker's deployed config (workers/ai-broker/wrangler.jsonc). The one-time move of its Durable Object from the Worker jobadabra-codex-broker (1 Nov 2026) is done; what stays guarded:
// Why (1 Nov 2026, owner: rename the Worker too): a wrong config creates an EMPTY namespace and the Codex login is lost (seen on the throwaway proof). The class keeps its old name `CodexBroker`:
// Cloudflare matches the namespace by class name, and renaming it needs a migration on a live container with stored state (parked, JOB-210).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(`../../../../workers/ai-broker/${path}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const final = read('wrangler.jsonc');
const source = readFileSync(new URL('../../../../workers/ai-broker/worker.js', import.meta.url), 'utf8');

test('the final config keeps the Worker, the class and the container application the stored login lives under', () => {
  assert.equal(final.name, 'jobadabra-ai-broker');
  assert.deepEqual(Object.keys(final.exports), ['CodexBroker']);   // the class name must not change without a migration
  assert.match(source, /export class CodexBroker extends Container/);
  assert.equal(final.durable_objects.bindings[0].class_name, 'CodexBroker');
  assert.equal(final.exports.CodexBroker.container, 'ai-broker');
  assert.equal(final.containers[0].name, 'ai-broker');
  assert.equal(final.containers[0].class_name, undefined);   // exports names the container; class_name beside it is the legacy form
  assert.equal(final.migrations, undefined);   // migrations and exports are mutually exclusive
});

test('only the AI broker audience is accepted: the old jobadabra-codex-broker name is gone from the config and the default (7/7, 2 Nov 2026)', () => {
  assert.equal(final.vars.AUDIENCE, 'jobadabra-ai-broker');
  assert.match(source, /env\.AUDIENCE \|\| 'jobadabra-ai-broker'\)/);
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), /jobadabra-codex-broker/);   // comments may say why; the code may not name it
});

test('the one-time transfer folder is gone and the deploy workflow still refuses a broker without a login', () => {
  const workflow = readFileSync(new URL('../../../../.github/workflows/release-ai-broker.yml', import.meta.url), 'utf8');
  const pattern = workflow.match(/grep -Eq '([^']+)'/)?.[1];   // the gate's own pattern, run on each state /health can say (#285: `starting` is a stored login whose container has not answered yet)
  assert.ok(pattern, 'the gate greps /health for the state');
  const passes = state => new RegExp(pattern).test(JSON.stringify({state, limits: null}));
  assert.deepEqual(['ready', 'starting', 'no-login', 'login-lost'].map(passes), [true, true, false, false]);
  assert.throws(() => readFileSync(new URL('../../../../workers/ai-broker/transfer/alias.js', import.meta.url)), /ENOENT/);
});

test('run tokens of the repos under both owners are accepted while they move to the jobadabra org (1 Nov 2026)', () => {
  const four = ['GarryOne/jobadabra', 'GarryOne/jobadabra-web', 'GarryOne/jobadabra-lab', 'jobadabra/jobadabra', 'jobadabra/jobadabra-web', 'jobadabra/jobadabra-lab'];
  assert.deepEqual(final.vars.REPOSITORY.split(','), four);
  assert.match(source, /env\.REPOSITORY \|\| 'GarryOne\/jobadabra,GarryOne\/jobadabra-web,GarryOne\/jobadabra-lab,jobadabra\/jobadabra,jobadabra\/jobadabra-web,jobadabra\/jobadabra-lab'/);
});
