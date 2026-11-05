// The container's side of "one Codex conversation per persona run" (spec docs/superpowers/specs/2026-11-05-broker-codex-resume-design.md): which conversations are on this disk, and what one turn of them cost.
// Why (5 Nov 2026, [bf], owner: "that context should be only once, at the start of the session"): every call opened a new Codex thread and paid its ~12k fixed context again. The Durable Object decides WHEN a conversation lives; this table only remembers WHERE (a folder and the thread's running token total).
// The table is in memory on purpose: a sleep or a redeploy wipes the disk, and an empty table is exactly "lost" (the next call starts a conversation from the full prompt).

/** A conversation nobody has asked anything of for this long is deleted (below the container's own 10 minute sleep). */
export const IDLE_MS = 5 * 60_000;
/** At most this many conversations on disk; opening one more drops the longest idle. */
export const MAX_THREADS = 8;
const FIELDS = ['input', 'cached', 'output'];

/**
 * Reads what `codex exec --json` printed: the thread id and the last usage it reported (Codex puts it on turn.completed; any event with a `usage` object counts, as the old reader did).
 * Takes the stdout text; returns {thread, usage: {input, cached, output} | null}. On a resumed thread that usage is the THREAD'S running total, not the turn's (measured 5 Nov 2026: 16,543 / 33,121 / 49,734 ... for five 16.5k turns): use turnUsage().
 */
export function readTurn(out) {
  let thread = null, usage = null;
  for (const line of String(out).split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'thread.started' && typeof event.thread_id === 'string') thread = event.thread_id;
    if (event?.usage && typeof event.usage === 'object') usage = {input: event.usage.input_tokens || 0, cached: event.usage.cached_input_tokens || 0, output: event.usage.output_tokens || 0};
  }
  return {thread, usage};
}

/** What one turn cost: the thread's running total now minus the total before it (null before = a thread's first turn). Never negative. */
export const turnUsage = (total, before) => Object.fromEntries(FIELDS.map(field => [field, Math.max(0, (total?.[field] || 0) - (before?.[field] || 0))]));

/** The conversations on this disk, keyed by the broker's session key: {thread, dir, model, total, last}. `now` is injectable for tests. */
export function threadTable(now = Date.now) {
  const map = new Map();
  return {
    get: key => map.get(key),
    /** Stores a conversation; returns the ones that no longer fit (longest idle first), for the caller to delete. */
    set(key, entry) {
      map.set(key, {...entry, last: now()});
      const evicted = [];
      while (map.size > MAX_THREADS) {
        const idle = [...map].filter(([name, entry]) => name !== key && !entry.busy).sort((a, b) => a[1].last - b[1].last)[0];
        if (!idle) break;   // every other one is mid-turn: the table is briefly over its size, never a running turn deleted
        evicted.push(map.get(idle[0])); map.delete(idle[0]);
      }
      return evicted;
    },
    touch(key, patch = {}) { const entry = map.get(key); if (entry) Object.assign(entry, patch, {last: now()}); },
    /** Forgets one conversation; returns it (or undefined) for the caller to delete. */
    drop(key) { const entry = map.get(key); map.delete(key); return entry; },
    /** Forgets every conversation idle past IDLE_MS that is not in the middle of a turn; returns them. */
    sweep() { const gone = []; for (const [key, entry] of map) if (!entry.busy && now() - entry.last > IDLE_MS) { gone.push(entry); map.delete(key); } return gone; },
    size: () => map.size,
  };
}
