// AiBroker: the broker on Cloudflare's durable_object policy at 4 vCPU / 6 GiB (lib/do-container.mjs; owner, 13 Nov 2026: "Yes, start PR 1/3 (Recommended)" after the CPU peaked at 1.99 of 2).
// Fakes only: ctx.container is a recording stand-in for Cloudflare's runtime; no container, network or provider is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AiBroker, AllowHosts, body, success, entry, harness, PARALLEL} from './harness.mjs';
import {INSTANCE} from '../../../../workers/ai-broker/lib/do-container.mjs';

const config = JSON.parse(readFileSync(new URL('../../../../workers/ai-broker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const HOSTS = ['chatgpt.com', 'auth.openai.com', 'api.openai.com', 'api.anthropic.com'];

// Cloudflare's ctx.container as the broker sees it: `log` keeps every step in order; /health answers once `readyAfter` polls have failed.
function box({running = false, image = 'registry/ai-broker@sha256:new', readyAfter = 1} = {}) {
  const log = [];
  let polls = 0;
  const fake = {
    running, images: {base: image}, log,
    start(options) { if (fake.running) throw new Error('already running'); fake.running = true; log.push(['start', options]); },
    async interceptOutboundHttps(host, binding) { log.push(['allow', host, binding]); },
    async setInactivityTimeout(ms) { log.push(['sleep', ms]); },
    signal(n) { log.push(['signal', n]); },
    async destroy() { fake.running = false; log.push(['destroy']); },
    getTcpPort: port => ({fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      log.push([path, port, init.body ?? null]);
      if (path === '/health') { if (polls++ < readyAfter) throw new Error('connection refused'); return Response.json({hasLogin: true}); }
      if (path === '/auth') return Response.json({ok: true});
      return success();
    }}),
  };
  return fake;
}

function broker(t, container, stored = {}) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ok: true}));
  const values = new Map([['login', '{"tokens":{}}'], ['answered', true], ['limits', {usedPercent: 10, resetsAt: Date.now() / 1000 + 3600}], ...Object.entries(stored)]);
  const storage = {get: async key => structuredClone(values.get(key)), put: async (key, value) => { values.set(key, structuredClone(value)); }, delete: async key => values.delete(key), list: async () => new Map(structuredClone([...values])), transaction: fn => fn(storage)};
  let woke = Promise.resolve();
  const ctx = {storage, container, exports: {AllowHosts: 'the AllowHosts entrypoint'}, blockConcurrencyWhile: fn => { woke = fn(); return woke; }};
  const made = new AiBroker(ctx, {ENGINE: 'codex', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'});
  return {made, storage, woke: () => woke};
}

test('the first call starts the container once: the 4 AI hosts allowed first, then 4 vCPU / 6 GiB with the internet off and the Claude token, ready on /health, the stored login restored, then the call', async t => {
  const container = box({readyAfter: 2}), {made, storage} = broker(t, container);
  const replies = await Promise.all([1, 2, 3].map(() => made.call('pr', {...body}, 'jobadabra/nightly.yml')));
  assert.deepEqual(replies.map(r => r.status), [200, 200, 200]);
  const steps = container.log.map(([what]) => what);
  assert.equal(steps.filter(s => s === 'start').length, 1, 'three calls at once start one container');
  assert.deepEqual(container.log.filter(([what]) => what === 'allow').map(([, host, binding]) => [host, binding]), HOSTS.map(h => [h, 'the AllowHosts entrypoint']));
  assert.ok(steps.lastIndexOf('allow') < steps.indexOf('start'), 'the hosts are allowed before the container starts');
  const [, options] = container.log.find(([what]) => what === 'start');
  assert.deepEqual(options, {image: 'registry/ai-broker@sha256:new', instance: {vcpu: 4, memoryMib: 6144, diskMb: 4000}, enableInternet: false, env: {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'}});
  assert.deepEqual(INSTANCE, options.instance);
  const auth = steps.indexOf('/auth'), firstCall = steps.indexOf('/call');
  assert.ok(steps.indexOf('/health') < auth && auth < firstCall, 'ready, then the login, then the call');
  assert.equal(container.log[auth][2], '{"tokens":{}}', 'onStart puts the stored login back');
  assert.ok(container.log.some(([what, ms]) => what === 'sleep' && ms === 600_000), 'it sleeps 10 minutes after the last call, as the old class did');
  assert.equal(await storage.get('containerImage'), 'registry/ai-broker@sha256:new');
});

test('a wake to a running container of an older image (a deploy) sends it SIGTERM to drain; a wake to the current image keeps it and starts nothing', async t => {
  const old = box({running: true}), a = broker(t, old, {containerImage: 'registry/ai-broker@sha256:old'});
  await a.woke();
  assert.deepEqual(old.log, [['signal', 15]]);
  const same = box({running: true}), b = broker(t, same, {containerImage: 'registry/ai-broker@sha256:new'});
  await b.woke();
  assert.deepEqual(same.log, [['sleep', 600_000]]);
  assert.equal((await b.made.call('pr', {...body}, 'x.yml')).status, 200);
  assert.ok(!same.log.some(([what]) => what === 'start' || what === '/auth'), 'a running container is used as it is');
});

test('a container that never answers /health in time is destroyed and the next call starts a new one', async t => {
  const container = box({readyAfter: Infinity}), {made} = broker(t, container);
  let now = Date.now();
  t.mock.method(Date, 'now', () => (now += 5_000));
  t.mock.timers.enable({apis: ['setTimeout']});
  const outcome = made.containerFetch('http://c/call', {method: 'POST', body: '{}'}).then(() => null, error => error);
  for (let i = 0; i < 20; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(250); }
  assert.match((await outcome)?.message ?? '', /container not ready/);
  assert.ok(container.log.some(([what]) => what === 'destroy'));
  assert.equal(container.running, false);
  Date.now.mock.restore(); t.mock.timers.reset();
  const healthy = box({readyAfter: 0});
  Object.assign(container, {getTcpPort: healthy.getTcpPort, start: options => { container.running = true; container.log.push(['start', options]); }});
  assert.equal((await made.containerFetch('http://c/call', {method: 'POST', body: '{}'})).status, 200);
  assert.equal(container.log.filter(([what]) => what === 'start').length, 2, 'the next call started a new container');
});

test('AllowHosts passes only the AI hosts on', async t => {
  const passed = [];
  t.mock.method(globalThis, 'fetch', async request => { passed.push(new URL(request.url).hostname); return new Response('ok'); });
  const gate = new AllowHosts();
  assert.equal((await gate.fetch(new Request('https://api.anthropic.com/v1/messages'))).status, 200);
  assert.equal((await gate.fetch(new Request('https://example.com/'))).status, 403);
  assert.deepEqual(passed, ['api.anthropic.com']);
});

test('the front Worker sends /health, /call and /admin/* to the one AiBroker object; the move routes (/next, /old, /admin/copy) are gone (plan 2/2)', async t => {
  const seen = [];
  const env = {BROKER_ADMIN_TOKEN: 'admin', BROKER_NEXT: {getByName: name => ({fetch: async request => { seen.push([name, new URL(request.url).pathname]); return Response.json({}); }})}};
  await entry.fetch(new Request('https://broker/health'), env);
  await entry.fetch(new Request('https://broker/admin/stop', {method: 'POST', headers: {authorization: 'Bearer admin'}}), env);
  assert.deepEqual(seen, [['broker', '/health'], ['broker', '/stop']]);
  assert.equal((await entry.fetch(new Request('https://broker/admin/call', {method: 'POST', body: '{}'}), env)).status, 401, 'admin only');
  assert.equal((await entry.fetch(new Request('https://broker/call', {method: 'POST', body: '{}'}), env)).status, 401, 'CI calls need their run token');
  for (const gone of ['/admin/copy', '/admin/next/call']) assert.equal((await entry.fetch(new Request(`https://broker${gone}`, {method: 'POST', headers: {authorization: 'Bearer admin'}}), env)).status, 404, gone);
  assert.equal(seen.length, 2);
  const [only] = config.containers;
  assert.deepEqual([config.containers.length, only.class_name, only.scheduling_policy, only.images?.base?.dockerfile], [1, 'AiBroker', 'durable_object', './container/Dockerfile']);
});

test('Gitar on #606: every call renews the 10-minute sleep, and a start whose login restore fails is destroyed, so the next call starts over instead of using a container without the login', async t => {
  const container = box({readyAfter: 0}), {made} = broker(t, container);
  await made.containerFetch('http://c/call', {method: 'POST', body: '{}'});
  await made.containerFetch('http://c/call', {method: 'POST', body: '{}'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(container.log.filter(([what, ms]) => what === 'sleep' && ms === 600_000).length, 3, 'once at the start, then after each call');
  const failing = box({readyAfter: 0}), b = broker(t, failing);
  const port = failing.getTcpPort;
  let fail = true;
  failing.getTcpPort = n => ({fetch: async (url, init) => { if (fail && new URL(url).pathname === '/auth') throw new Error('auth refused'); return port(n).fetch(url, init); }});
  await assert.rejects(b.made.containerFetch('http://c/call', {method: 'POST', body: '{}'}), /auth refused/);
  assert.equal(failing.running, false, 'the half-started container is gone');
  fail = false;
  assert.equal((await b.made.containerFetch('http://c/call', {method: 'POST', body: '{}'})).status, 200);
  assert.equal(failing.log.filter(([what]) => what === 'start').length, 2, 'the next call started a new container, with its login');
});

test('the broker runs PARALLEL (24) calls at once on its 4 vCPU (owner, 13 Nov 2026: "24 slots and 4 vCPU")', t => {
  const {made} = broker(t, box());
  assert.deepEqual([made.gate.stats().slots, PARALLEL, harness().broker.gate.stats().slots], [24, 24, 24]);
});
