// Demo data for /admin/testing/report-only's Finders card on tools/page-shot.mjs (5 Nov 2026, [gi]): 14 made-up self-healing snapshots where only the AI screenshot review still files,
// the layout checks last filed 4 days ago and the interaction probe 12 days ago. Like the real writer (desktop/e2e/lib/selfheal-stats.mjs), a snapshot lists only detectors that filed in its 7 days.
const DAY = 86400000;
const row = (detector, filed, fixed, queued) => ({detector, filed, fixed, queued});

/** @param {{env: object}} context the seed context of tools/worker-server.mjs; `seeds` the seed table (the seed this one lays itself over) */
export async function finderSilence({env}, seeds) {
  await seeds['nightly-trends']({env});
  const now = new Date(), day = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);
  const base = JSON.parse((await env.STATS.prepare('SELECT body FROM selfheal_snapshots ORDER BY day DESC LIMIT 1').first()).body);
  for (let back = 0; back < 14; back++) {
    const byDetector = [row('AI screenshot review', 2, back < 3 ? 1 : 0, 0)];
    if (back >= 4 && back <= 10) byDetector.push(row('Layout and DOM checks', 2, 0, 0));   // filed 2, none judged real
    if (back >= 12) byDetector.push(row('Interaction probe', 1, 0, 0));
    const body = {...base, at: new Date(now.getTime() - back * DAY).toISOString(), periods: {...base.periods, last7: {...base.periods?.last7, byDetector}}};
    await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(day(back), body.at, JSON.stringify(body)).run();
  }
}
