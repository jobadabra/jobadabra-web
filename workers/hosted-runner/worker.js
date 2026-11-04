// The hosted Always on runner Worker (spec 2026-10-16-hosted-always-on.md §1): consumes the Queue "hosted-runs" and starts one engine container per message (api/hosted-consume.js has the logic).
// A separate Worker because the Container class needs @cloudflare/containers, which the site's tests cannot load. Deployed by hand with .github/workflows/release-hosted-runner.yml (target staging or production); site.yml never deployed it (fixed 5 Nov 2026).
import {Container, getContainer} from '@cloudflare/containers';
import {consume} from '../../api/hosted-consume.js';

export class HostedRunner extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';   // billed only while it runs; it stops by itself after the run
}

export default {
  async queue(batch, env) { await consume(batch, account => getContainer(env.RUNNER, account)); },
  async fetch() { return new Response('Not found', {status: 404}); },
};
