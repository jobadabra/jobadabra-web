// The broker Worker loaded offline for tests: Cloudflare's Container runtime replaced, isolated storage and transport per test (shared by worker.test.js and engines.test.js).
import {readFileSync} from 'node:fs';
import {kindOf} from '../../../../workers/ai-broker/container/kinds.mjs';

// Node cannot load Cloudflare's Container runtime. Keep the actual Worker and its libraries;
// substitute the runtime constructor, then provide isolated storage and transport per test.
const workerUrl = new URL('../../../../workers/ai-broker/worker.js', import.meta.url);
const runtime = 'data:text/javascript;base64,' + Buffer.from(`
  export class Container { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
  export class ContainerProxy {}
  export const getContainer = broker => broker;
`).toString('base64');
const workers = 'data:text/javascript;base64,' + Buffer.from(`
  export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
  export class WorkerEntrypoint {}
`).toString('base64');
const source = readFileSync(workerUrl, 'utf8')
  .replaceAll("'@cloudflare/containers'", JSON.stringify(runtime))
  .replaceAll("'cloudflare:workers'", JSON.stringify(workers))
  .replace(/from '(\.{1,2}\/[^']+)'/g, (_, ref) => `from '${new URL(ref, workerUrl).href}'`);
export const {CodexBroker, AiBroker, AllowHosts, PARALLEL, default: entry} = await import('data:text/javascript;base64,' + Buffer.from(source + `\n//# sourceURL=${workerUrl.href}`).toString('base64'));
export const day = Date.parse('2026-10-30T23:59:59Z');
export const body = {prompt: 'offline test', tier: 'small'};
// A failed container reply as server.mjs sends it: the error text plus the coded `kind` (container/kinds.mjs; owner, 8 Nov 2026: "Yes, codes").
export const containerError = (error, extra = {}, status = 500) => new Response(JSON.stringify({error, kind: kindOf(error), ...extra}), {status});
// The site's switchboard as the broker sees it (12 Nov 2026, ba): the SITE service binding to `www` plus the key for POST /ops/notify. Every note posted lands in `sent` as {url, auth, event, text, link?}.
export const switchboard = (sent = []) => ({SELFHEAL_PUBLISH_KEY: 'fixture-publish-key', SITE: {fetch: async (url, init) => { sent.push({url: String(url), auth: init.headers.authorization, ...JSON.parse(init.body)}); return Response.json({ok: true, sent: true}); }}});
export const success = () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 2, output: 3}, ms: 1}));

export function harness(meter, env = {}) {
  const values = new Map([['login', 'test login'], ['answered', true]]);   // a broker whose container has answered: a Codex failure is a failure. startup.test.js starts a container with onStart() to play the first minutes (#285)
  if (meter) values.set('meter', structuredClone(meter));
  let pending = Promise.resolve();
  const storage = {
    get: async key => structuredClone(values.get(key)),
    put: async (key, value) => { values.set(key, structuredClone(value)); },
    delete: async key => values.delete(key),
    // Serialize admission and completion transactions; snapshots are independent, as in DO storage.
    transaction(fn) {
      const next = pending.then(() => fn(storage));
      pending = next.catch(() => {});
      return next;
    },
  };
  const restart = () => {
    const broker = new CodexBroker({storage}, env);
    broker.containerFetch = async () => success();
    return broker;
  };
  return {broker: restart(), restart, storage};
}

