// Hosted Always on, the Queue consumer's logic (the runner Worker workers/hosted-runner/worker.js is only glue around it): each message starts one container run and waits for it.
// A message is always acknowledged: the run token is single-use and the container posts its own result; a run that never posts is failed by the next tick (api/hosted-tick.js).
// Guard: test/unit/shared/hosted/hosted-guards.test.js.
export const RUN_TIMEOUT_MS = 14 * 60 * 1000;
// Why (5 Nov 2026, hr 6/6 try 4; review): the look at the container's build must not hold a run: the library bounds a cold start at about 28 s, a wedged instance never answers. Look and run share ONE deadline
// (RUN_TIMEOUT_MS from the message), so a hung look can never push the invocation past the Queue consumer's wall time with the message unacknowledged.
const BUILD_LOOK_MS = 30 * 1000;

/** One line per run: which code the container runs (its GET / answers `build`, a hash of hosted_run.py, and `started`). A failed look is logged and never stops the run.
 * Why (5 Nov 2026, hr 6/6 try 4, owner: "Build stamp, then 1 press"): the instance's image digest was the new one yet the 500 had the old body; nothing said which code answered. */
async function logBuild(container, run, log) {
  try {
    const reply = await container.fetch(new Request('http://container/', {signal: AbortSignal.timeout(BUILD_LOOK_MS)}));
    if (!reply.ok) {   // the library answers a start failure as a plain 500 "Failed to start container: …", it does not throw
      log.error(`hosted run ${run}: could not read the container build: it answered ${reply.status} ${(await reply.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
      return;
    }
    const said = await reply.json();
    log.log(`hosted run ${run}: container build ${said.build ?? 'unknown (an old image: no stamp)'}, started ${said.started ?? 'unknown'}`);
  } catch (error) {
    log.error(`hosted run ${run}: could not read the container build: ${error.message}`);
  }
}

// `runner(account)` -> {fetch(request)}: the container instance for that account (one at a time per account). -> {ok, failed} counts.
export async function consume(batch, runner, log = console) {
  const done = {ok: 0, failed: 0};
  await Promise.all(batch.messages.map(async message => {
    const {token, site, account} = message.body || {}, deadline = Date.now() + RUN_TIMEOUT_MS;
    try {
      await logBuild(runner(account), message.body?.run, log);
      const reply = await runner(account).fetch(new Request('http://container/run', {method: 'POST', body: JSON.stringify({token, site}), signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1000))}));
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
