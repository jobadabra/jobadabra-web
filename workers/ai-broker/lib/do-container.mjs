// The broker's container on Cloudflare's durable_object scheduling policy (ctx.container): what the @cloudflare/containers Container class gives CodexBroker, rebuilt for AiBroker.
// Why (13 Nov 2026, owner: "then, explore and try" Cloudflare's custom instance types; asked via AskUserQuestion: "Measure, then migrate (Recommended)", then "Yes, start PR 1/3 (Recommended)"):
// with 16 Claude slots the 2 vCPU container peaked at 1.94-1.99 vCPU (13 Nov 00:21, 00:25Z; memory 2.2 of 6 GiB). The old policy needs 3 GiB a vCPU (4 vCPU = 12 GiB, paid while awake);
// this one takes any size up to the account's 4 vCPU / 12 GiB, and CPU is billed by use, so 4 vCPU at the same 6 GiB costs about nothing more. The Container class does not run on this policy.
// Design: one container per broker object. A call needs it: started once (allowed hosts first, then start, then ready on GET /health, then onStart) and shared by every call that waits;
// a container this object did not start (a restart of the object) is used as it is. The image it was started from is stored: an object that wakes to a container of an older image
// (a deploy; containers on this policy take no part in Cloudflare's rollouts) sends it SIGTERM, and container/server.mjs drains it (new calls refused with x-broker-draining, which
// worker.js toContainer sends again until the next container takes them).

/** The size AiBroker's container starts with (Cloudflare's runtime field names). */
export const INSTANCE = {vcpu: 4, memoryMib: 6144, diskMb: 4000};
/** How long a new container may take to answer GET /health, and how long it stays up after the last call (the old class's sleepAfter '10m'). */
export const READY_MS = 30_000, SLEEP_MS = 600_000;
const POLL_MS = 250;

/** A WorkerEntrypoint that passes a request on only to `hosts` (the container's one way out); AiBroker registers it for each host. */
export const allowHosts = (Entrypoint, hosts) => class extends Entrypoint {
  fetch(request) { return hosts.includes(new URL(request.url).hostname) ? fetch(request) : new Response('host not allowed', {status: 403}); }
};

/**
 * A Durable Object base (`Base` = cloudflare:workers DurableObject) with the members the broker uses from the Container class: containerFetch, stop and the onStart hook.
 * The subclass sets `defaultPort`, `allowedHosts`, `envVars`; the Worker exports the allow-hosts entrypoint as `AllowHosts` (ctx.exports).
 */
export const doContainer = Base => class extends Base {
  #ready = null;   // the start in flight or done, shared by every call; null = nothing started by this object
  #up = false;     // #ready has settled with a container up: once that container is gone, the next call starts a new one

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile?.(() => this.wake());
  }

  /** On every wake of the object: a running container of an older image is told to drain; one of the current image keeps running and gets its sleep timer back. */
  async wake() {
    const box = this.ctx.container;
    if (!box?.running) return;
    if ((await this.ctx.storage.get('containerImage')) !== box.images?.base) { box.signal(15); return; }
    await box.setInactivityTimeout(SLEEP_MS);
  }

  /** Sends a request to the container, starting it first when none runs. */
  async containerFetch(url, init) {
    const box = this.ctx.container;
    if (this.#up && !box.running) { this.#ready = null; this.#up = false; }   // it slept, crashed or drained away
    // A start in flight is shared, never repeated: `running` turns true only midway through boot(). A container this object did not start (it woke to one) is used as it is: ready, or draining (it says so per call).
    this.#ready ||= (box.running ? Promise.resolve() : this.boot()).then(() => { this.#up = true; });
    try { await this.#ready; } catch (error) { this.#ready = null; throw error; }
    try { return await box.getTcpPort(this.defaultPort).fetch(url, init); }
    finally { box.setInactivityTimeout(SLEEP_MS).catch(() => {}); }   // Gitar on #606: the old class renewed sleepAfter on every request; renewed here too, whatever the runtime counts from
  }

  /** Allowed hosts, start, ready, onStart: in that order, once per container. */
  async boot() {
    const box = this.ctx.container, allow = this.ctx.exports.AllowHosts;
    for (const host of this.allowedHosts) await box.interceptOutboundHttps(host, allow);   // internet off: only these names resolve, and only through the entrypoint
    box.start({image: box.images.base, instance: INSTANCE, enableInternet: false, env: this.envVars});
    // Gitar on #606: a step that fails after start() must not leave a running container that the next call would take as ready (no login restored): it is destroyed, and the next call starts over.
    try {
      await this.ctx.storage.put('containerImage', box.images.base);
      await box.setInactivityTimeout(SLEEP_MS);
      const until = Date.now() + READY_MS;
      for (;;) {
        try { if ((await box.getTcpPort(this.defaultPort).fetch('http://c/health')).ok) break; } catch { /* not listening yet */ }
        if (!box.running || Date.now() >= until) throw new Error(`container not ready after ${Math.round((Date.now() - until + READY_MS) / 1000)} s`);
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
      await this.onStart?.((url, init) => box.getTcpPort(this.defaultPort).fetch(url, init));   // not containerFetch: that one waits for this very start
    } catch (error) {
      await box.destroy(error).catch(() => {});
      throw error;
    }
  }

  /** The owner's kill test (/admin/stop): the container goes, the stored login stays. */
  async stop() {
    this.#ready = null; this.#up = false;
    await this.ctx.container.destroy();
  }
};
