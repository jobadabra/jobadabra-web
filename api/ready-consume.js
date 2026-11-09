// Ready to send, the Queue consumer's logic (the runner Worker workers/ready-runner/worker.js is only glue around it): each message starts one night's container and returns at once (the container fills in the background and answers 202).
// A message is always acknowledged: the night token is bound to its batch and the container posts its own results; a night that never posts is finished by the next tick (api/ready-tick.js). Guard: test/unit/api/ready/ready-wiring.test.js.
export const START_TIMEOUT_MS = 60 * 1000;

// `runner(batchId)` -> {fetch(request)}: the container instance for that night. -> {ok, failed} counts.
export async function consume(batch, runner, log = console) {
  const done = {ok: 0, failed: 0};
  await Promise.all(batch.messages.map(async message => {
    const {batch: night, token, site, task} = message.body || {};   // task: fill | readiness (api/ready-read.js); a message from before it carries none, and the container then runs a fill
    try {
      const reply = await runner(night).fetch(new Request('http://container/run', {method: 'POST', body: JSON.stringify({token, site, ...(task ? {task} : {})}), signal: AbortSignal.timeout(START_TIMEOUT_MS)}));
      reply.ok ? done.ok++ : done.failed++;
    } catch (error) {
      done.failed++;
      log.error(`ready night ${night}: ${error.message}`);
    }
    message.ack();
  }));
  return done;
}
