// When the Claude subscription's slots are all taken, a call that needs no web search does not queue behind them: it goes on to the next engine.
// Why (3 Nov 2026, owner: "Why Codex would work with more than 3 calls, but Claude no… Why we need to wait for Codex? We have 3 models in the broker which we can fall back to"): Claude runs 3 calls at once (1 GiB container), and a call that found them busy waited with no deadline
// (searches read "AI queue full (waited 47-68 s)", 0 jobs) while Free AI sat idle. The owner chose "Busy = next engine": after BUSY_MS, a call without search goes down the chain; a search waits, because only Codex and Claude can search.
import {underCap} from './fallback.mjs';

/** How long a call waits for a free Claude slot before it passes on (the owner's "more than ~10 s"). */
export const BUSY_MS = 10_000;

/**
 * Whether a call may pass on when Claude is busy: no web search, no pinned engine (`only`), and an engine behind Claude that can take it now.
 * Codex counts when its week is not used up for this call (`verdict.ranOut`) and its login stands; Free AI counts while its UTC-day cap has room.
 * Free AI does not count for a call with images (it cannot take them). A call that may not pass on waits for Claude as it always did.
 */
export async function mayPassOn({chain, body, env, storage, verdict}) {
  if (body.search === true || body.only === true) return false;
  for (const engine of chain.slice(chain.indexOf('claude') + 1)) {
    if (engine === 'codex') { if (!verdict.ranOut && (await storage.get('login')) && !(await storage.get('lost'))) return true; }
    else if (engine === 'free-ai' && body.images?.length) continue;   // Why (3 Nov 2026, review): Free AI refuses images (fallback:unsupported), so a call with images would lose 10 s and its place in the line for nothing
    else if (await underCap(storage, env)) return true;
  }
  return false;
}
