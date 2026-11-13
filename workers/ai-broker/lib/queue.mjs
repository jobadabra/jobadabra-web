// A priority queue with N slots: at most N calls run at once, and a waiting PR check always goes before every other waiting call.
// Why (28 Oct 2026, spec ci-on-codex-subscription-design): PR 0 measured 4 parallel calls at ~9.8 s each, 60 of 60 valid; PR checks must never queue behind a benchmark.
// Why (13 Nov 2026, owner via sa: "First come, first serve"; cx's read of the broker's records): a third queue for benchmarks served them only when no by-hand call waited, so at
//   03:24-03:27Z a 30-profile run's 9-25 waiting calls kept four benchmark calls 166 s in line and that person scored 0. Everything but a PR check now waits in one line, in arrival order.
const ORDER = ['pr', 'scheduled'];

/**
 * Takes the number of slots; returns {acquire(lane, waitMs?) -> Promise<release()>, stats() -> {slots, active, waiting}}; /health shows stats() as `queue` (slots: search-pair.yml's admit check reads it). Each release() frees its slot once.
 * Why (3 Nov 2026, owner: "Why we need to wait for Codex? We have 3 models in the broker which we can fall back to"): with `waitMs` the promise gives up after that long and resolves null (the caller is out of the line, nothing is held); without it a call waits as before.
 */
export function slots(n) {
  let active = 0;
  const waiting = {pr: [], scheduled: []};
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
    stats: () => ({slots: n, active, waiting: {pr: waiting.pr.length, scheduled: waiting.scheduled.length}}),
  };
}
