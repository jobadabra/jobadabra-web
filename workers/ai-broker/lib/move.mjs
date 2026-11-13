// Moving the broker's stored state from CodexBroker (today's container policy) to AiBroker (durable_object policy, 4 vCPU), and which of the two CI calls reach.
// Why (13 Nov 2026, owner: "do it one PR if possible" · "Ok, do it then in 2 PRs" · "the 2nd one will do the cleanup" · "and eventually the switch"): the new broker ships beside the old;
// one admin call copies the state across inside Cloudflare (the Codex login among it, so it is never logged or returned), and the Worker setting BROKER_ACTIVE=next sends CI's calls
// to the new one. Rollback = unset it: the old broker kept its own copy. PR 2 removes the old broker and this switch.

/** Kept per container, not per broker: a new container proves itself again (worker.js onStart, markIfAnswered). */
const PER_CONTAINER = new Set(['answered', 'startError', 'containerImage']);

/** Every stored key and value of a broker, except the per-container ones. */
export async function exportState(storage) {
  return Object.fromEntries([...(await storage.list())].filter(([key]) => !PER_CONTAINER.has(key)));
}

/** Writes an exported state into a broker; returns the key names written (never a value). */
export async function importState(storage, state) {
  const keys = Object.keys(state || {}).filter(key => !PER_CONTAINER.has(key));
  for (const key of keys) await storage.put(key, state[key]);
  await storage.put('answered', false);   // the copied login is unproven in this broker's container until a call answers
  return keys;
}

/** The front Worker's copy: the old broker's state into the new one; returns {copied: [key names]}. */
export async function copyState(from, to) {
  const out = await from.fetch(new Request('http://c/export', {method: 'POST'}));
  if (!out.ok) return {status: 502, body: {error: `export: ${out.status}`}};
  const done = await to.fetch(new Request('http://c/import', {method: 'POST', body: await out.text()}));
  return {status: done.status, body: await done.json()};
}

/** Whether CI's calls go to the new broker: the Worker setting BROKER_ACTIVE, "next" or not. */
export const nextActive = env => String(env?.BROKER_ACTIVE || '').trim() === 'next';
