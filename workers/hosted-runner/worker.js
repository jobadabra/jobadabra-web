// The hosted Always on runner Worker (spec 2026-10-16-hosted-always-on.md §1): consumes the Queue "find-jobs-runs" and starts one engine container per message (api/hosted-consume.js has the logic).
// A separate Worker because the Container class needs @cloudflare/containers, which the site's tests cannot load. Deployed with .github/workflows/release-hosted-runner.yml, which public-watch.yml starts for production when the engine or these files change (13 Nov 2026); staging by hand.
import {Container, getContainer} from '@cloudflare/containers';
import {consume} from '../../api/hosted-consume.js';

export class Engine extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';   // billed only while it runs; it stops by itself after the run
  // Why (5 Nov 2026, hr staging proof): a container that dies or never listens must leave a line (with observability on in wrangler.jsonc), not only a run stuck "running".
  onStop(params) { console.log(`hosted runner container stopped: ${JSON.stringify(params)}`); }
  onError(error) { console.error(`hosted runner container error: ${error instanceof Error ? error.message : String(error)}`); throw error; }
}

export default {
  async queue(batch, env) { await consume(batch, account => getContainer(env.RUNNER, account), console, {build: env.HOSTED_BUILD}); },   // HOSTED_BUILD: the engine stamp the deploy built (release-hosted-runner.yml); each run checks its container against it
  async fetch() { return new Response('Not found', {status: 404}); },
};
