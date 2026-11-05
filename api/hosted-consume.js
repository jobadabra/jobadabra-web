// Hosted Always on, the Queue consumer's logic (the runner Worker workers/hosted-runner/worker.js is only glue around it): each message starts one container run and waits for it.
// A message is always acknowledged: the run token is single-use and the container posts its own result; a run that never posts is failed by the next tick (api/hosted-tick.js).
// Guard: test/unit/shared/hosted/hosted-guards.test.js.
export const RUN_TIMEOUT_MS = 14 * 60 * 1000;

// `runner(account)` -> {fetch(request)}: the container instance for that account (one at a time per account). -> {ok, failed} counts.
export async function consume(batch, runner, log = console) {
  const done = {ok: 0, failed: 0};
  await Promise.all(batch.messages.map(async message => {
    const {token, site, account} = message.body || {};
    try {
      const reply = await runner(account).fetch(new Request('http://container/run', {method: 'POST', body: JSON.stringify({token, site}), signal: AbortSignal.timeout(RUN_TIMEOUT_MS)}));
      if (reply.ok) done.ok++;
      else {
        done.failed++;
        // Why (5 Nov 2026, hr 6/6 try 3): a container that answered 500 left only "POST http://container/run"; its status and the reason it gave say what to fix. The token never goes in a log.
        const said = (await reply.text().catch(() => '')).replaceAll(token || '\u0000', '[run token]').slice(0, 400);
        log.error(`hosted run ${message.body?.run}: container answered ${reply.status} ${said}`);
      }
    } catch (error) {
      done.failed++;
      log.error(`hosted run ${message.body?.run}: ${error.message}`);
    }
    message.ack();
  }));
  return done;
}
