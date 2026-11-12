// Demo data for the Testing Overview's day cells (12 Nov 2026, [27-pane-dg]): the testing-overview seed, then the e2e snapshot's days rewritten so the "After each merge" and "Night" rows show every
// share the rule paints (100%, 99%, 98%, 95%, 85%, 70%, a one-run green and a one-run red day). All made up. Why: the real rows have 25-110 runs a day, so a shot needs days at known shares to prove the colours.
const DAY = 86400000;
// [greens, reds] per day, oldest first (14 days); after-merge has many runs a day, the night one run
const MERGE = [[40, 0], [99, 1], [39, 2], [28, 12], [1, 0], [0, 1], [60, 0], [96, 4], [34, 6], [98, 2], [197, 3], [12, 8], [45, 0], [80, 1]];
const NIGHT = [[1, 0], [1, 0], [0, 1], [1, 0], [1, 0], [1, 0], [0, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [0, 1], [1, 0]];

/** @param {{env: object}} context the seed context of tools/worker-server.mjs; @param {object} seeds the seed table (for 'testing-overview') */
export async function dayShare({env}, seeds) {
  await seeds['testing-overview']({env});
  const now = new Date(), day = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);
  const row = await env.STATS.prepare('SELECT body FROM e2e_snapshot WHERE id = 1').first(), body = JSON.parse(row.body);
  const rows = (kind, table) => table.map(([greens, reds], i) => ({day: day(13 - i), kind, runs: greens + reds, greens, reds}));
  body.days = [...rows('after-merge', MERGE), ...rows('nightly', NIGHT), ...rows('beta', NIGHT.map(([g, r]) => [g, 0]))];
  await env.STATS.prepare('UPDATE e2e_snapshot SET body = ? WHERE id = 1').bind(JSON.stringify(body)).run();
}
