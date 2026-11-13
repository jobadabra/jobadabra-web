// A priority queue with N slots: at most N calls run at once, and a waiting PR check always goes before waiting scheduled or benchmark work.
// Why (28 Oct 2026, spec ci-on-codex-subscription-design): PR 0 measured 4 parallel calls at ~9.8 s each, 60 of 60 valid; PR checks must never queue behind a benchmark.
const ORDER = ['pr', 'scheduled', 'bench'];

/**
 * Takes the number of slots; returns {acquire(lane, waitMs?) -> Promise<release()>, stats() -> {slots, active, waiting}}; /health shows stats() as `queue` (slots: search-pair.yml's admit check reads it). Each release() frees its slot once.
 * Why (3 Nov 2026, owner: "Why we need to wait for Codex? We have 3 models in the broker which we can fall back to"): with `waitMs` the promise gives up after that long and resolves null (the caller is out of the line, nothing is held); without it a call waits as before.
 */
export function slots(n) {
  let active = 0;
  const waiting = {pr: [], scheduled: [], bench: []};
  const next = () => { for (const lane of ORDER) if (waiting[lane].length) return waiting[lane].shift(); return null; };
  const releaser = () => { let done = false; return () => { if (done) return; done = true; const w = next(); if (w) w(releaser()); else active--; }; };
  return {
    acquire(lane, waitMs) {
      if (active < n) { active++; return Promise.resolve(releaser()); }
      return new Promise(resolve => {
        let timer;
        const turn = release => { clearTimeout(timer); resolve(release); };
        waiting[lane].push(turn);
        if (waitMs !== undefined) timer = setTimeout(() => { const at = waiting[lane].indexOf(turn); if (at >= 0) { waiting[lane].splice(at, 1); resolve(null); } }, waitMs);
      });
    },
    stats: () => ({slots: n, active, waiting: {pr: waiting.pr.length, scheduled: waiting.scheduled.length, bench: waiting.bench.length}}),
  };
}
