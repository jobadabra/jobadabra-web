// Demo data for Testing → Overview's "Bugs found vs what they cost" card (7 Nov 2026, [at]): 14 made-up self-healing snapshots (one day with none: a hollow column), the broker's 7-day tally
// per workflow and the schedules snapshot's weekly minutes. Numbers are made up, shaped like the first cut: the AI persona and the code review find real bugs, the screenshot review mostly false alarms,
// the layout checks nothing real (so "no real bug"), people a few. Like the real writer (desktop/e2e/lib/selfheal-stats.mjs) a snapshot lists only the detectors that filed in its 7 days.
const DAY = 86400000;
const row = (detector, fixed, queued, falsePositive, filed = fixed + queued + falsePositive) => ({detector, filed, fixed, queued, falsePositive, harness: 0});

/** @param {{env: object}} context the seed context of tools/worker-server.mjs; `seeds` the seed table (the seed this one lays itself over) */
export async function methodsCost({env}, seeds) {
  await seeds['nightly-trends']({env});
  const now = new Date(), day = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);
  const base = JSON.parse((await env.STATS.prepare('SELECT body FROM selfheal_snapshots ORDER BY day DESC LIMIT 1').first()).body);
  await env.STATS.prepare('DELETE FROM selfheal_snapshots WHERE day = ?').bind(day(9)).run();   // the day with no snapshot (the seed under this one stored one)
  for (let back = 0; back < 14; back++) {
    if (back === 9) continue;
    const wave = back < 7 ? 0 : 1, byDetector = [row('AI user agent', 2 + (back % 3), wave ? 0 : 1, 3 + (back % 2)), row('AI code review', 6 + (back % 4), 0, 4 + wave), row('AI screenshot review', wave + (back % 2), 0, 9 - wave),
      row('Layout and DOM checks', 0, 0, 0, 2), row('Failed test steps', 0, 0, 0, 3), row('other', 2 + wave, 0, 1)];
    const body = {...base, at: new Date(now.getTime() - back * DAY).toISOString(), periods: {...base.periods, last7: {...base.periods?.last7, byDetector}}};
    await env.STATS.prepare('INSERT INTO selfheal_snapshots (day, at, body) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, body = excluded.body').bind(day(back), body.at, JSON.stringify(body)).run();
  }
  const {clean} = await import('../admin/schedules.js');
  const schedules = JSON.parse((await env.STATS.prepare('SELECT body FROM schedules_snapshot WHERE id = 1').first()).body), minutes = {'ai-user-agents.yml': 410, 'code-review.yml': 96, 'ui-findings.yml': 240};
  const jobs = schedules.jobs.map(job => (job.file in minutes && job.repo === schedules.jobs[0].repo ? {...job, weeklyMin: minutes[job.file]} : job));
  const has = new Set(jobs.map(job => job.file)), repo = schedules.jobs[0].repo;
  for (const file of Object.keys(minutes)) if (!has.has(file)) jobs.push({repo, file, name: file, about: '', crons: [], source: 'github', manual: true, disabled: false, ai: true, weeklyMin: minutes[file], billedMin: 0, recent: []});
  await env.STATS.prepare('UPDATE schedules_snapshot SET body = ? WHERE id = 1').bind(JSON.stringify(clean({...schedules, jobs}))).run();
  const entry = (calls, tokens) => ({calls, ok: calls, tokens, ms: 1, engines: {codex: calls}});
  const tally = {days: Object.fromEntries(Array.from({length: 7}, (_, back) => [day(back), {'jobadabra/ai-user-agents.yml': entry(30, 410000 + back * 9000), 'jobadabra/code-review.yml': entry(6, 84000 + back * 1500), 'jobadabra/ui-findings.yml': entry(14, 118000 + back * 2000)}]))};
  env.AI_BROKER = {fetch: async () => Response.json({fallback: {day: day(0), freeAi: 4, freeAiCap: 200, held: {freeAi: 0}}, chain: [{name: 'codex', configured: true, answeredToday: 50, ranOutToday: 0, failedToday: 0, avgMs: 41000}], tally})};
}
