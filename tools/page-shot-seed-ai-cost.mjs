// Demo data for /admin/ai/costs on tools/page-shot.mjs (5 Nov 2026, admin charts): the page with every section filled, all made up.
// Why (owner, 5 Nov 2026: "transform [the Costs tables] into a more visual representation"): the old seeds fill one section each, so a before/after shot of By job, By day,
// By API key, By workspace, By group and Free AI per install showed one row or an empty message. Names and numbers here are fictional; install ids are made-up 8-letter words.
import {ACTIONS} from '../shared/aicost.js';

const DAY = 86400000;
const wave = (n, k) => 0.6 + 0.4 * Math.abs(Math.sin(n * 1.7 + k * 2.3));   // a repeatable "random" between 0.6 and 1: the same shots every run

/** @param {{env: object, call: Function}} context the seed context of tools/worker-server.mjs; `seeds` the other seeds, for the Pro, web-search and broker parts */
export async function aiCostFull({env}, seeds) {
  await seeds['ai-cost-fallback']({env});
  await seeds['ai-cost-web']({env});
  const now = Date.now(), at = back => new Date(now - back * DAY), stamp = back => at(back).toISOString(), dayOf = back => stamp(back).slice(0, 10);
  const run = (job, run_id, back, usd, calls, provider) => env.STATS.prepare('INSERT INTO ai_cost_runs (job, run_id, day, at, usd, calls, repo, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(job, run_id, dayOf(back), stamp(back), usd, calls, 'demo/repo', provider).run();
  const perRun = {'central-scout': 0.9, 'form-lab': 0.55, 'recipe-proposer': 0.2, 'alias-proposer': 0.08, 'ui-fix': 1.4, 'ui-verdict': 0.12, 'code-review': 0.35, 'finder-review': 0.1,
    'e2e-screenshot-review': 0.25, 'e2e-app': 0.7, 'e2e-judges': 0.3, 'sentry-fix': 0.8, 'weekly-self-review': 1.1, 'product-brain': 0.45, 'pool-live': 0.6, 'replay-refill': 0.15};
  for (let back = 0; back < 30; back++) {
    let index = 0;
    for (const [job, usd] of Object.entries(perRun)) {
      index += 1;
      if ((back + index) % 3 === 0 && usd < 0.5) continue;   // the small jobs skip some days
      await run(job, `${job}-${back}`, back, +(usd * wave(back, index)).toFixed(3), Math.round(8 + 40 * wave(back, index)), job === 'e2e-judges' || job === 'alias-proposer' ? 'openai' : 'anthropic');
    }
  }
  for (let back = 0; back < 30; back++) {   // what Anthropic billed: close to the jobs' sum, a few cents over on most days, one day with a hole
    const sum = (await env.STATS.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM ai_cost_runs WHERE day = ? AND provider = ?').bind(dayOf(back), 'anthropic').first()).usd;
    if (back === 12) continue;
    await env.STATS.prepare('INSERT INTO ai_cost_billed (day, usd, at) VALUES (?, ?, ?)').bind(dayOf(back), +(sum * (1.04 + 0.08 * wave(back, 9))).toFixed(2), stamp(0)).run();
  }
  const keys = {'ci-main': 0.55, 'ci-tests': 0.2, 'self-heal': 0.35, 'product-brain': 0.06, 'web-search': 0.04};
  const spaces = {'ws.jobadabra-ci': 0.8, 'ws.jobadabra-tests': 0.2, 'ws.jobadabra-search': 0.04};
  for (let back = 0; back < 30; back++) {
    for (const [key, usd] of Object.entries({...keys, ...spaces})) {
      await env.STATS.prepare('INSERT INTO ai_cost_keys (day, key, usd, at) VALUES (?, ?, ?, ?)').bind(dayOf(back), key, +(usd * 9 * wave(back, key.length)).toFixed(2), stamp(0)).run();
    }
  }
  // Free AI: nine made-up installs, a day and a month each, over the usual steps
  const model = '@cf/qwen/qwen3-30b-a3b-fp8', who = ['amber0ak', 'birch7ly', 'cedar3rn', 'dune9fox', 'elm2glen', 'fern5bay', 'gale8ton', 'hazel1op', 'iris4mer'];
  const steps = ['scout', 'enrich', 'score', 'decide', 'title_triage', 'place_triage', 'visit_relevant', 'role_ideas'].map(step => (ACTIONS.includes(step) ? step : 'other'));
  for (let back = 0; back < 12; back++) {
    for (const [i, install] of who.entries()) {
      for (const [j, action] of steps.entries()) {
        const scale = (who.length - i) / who.length * wave(back, j + i) * (back === 0 ? 1 : 0.8);
        await env.STATS.prepare('INSERT INTO ai_calls (day, who, action, model, calls, tokens_in, tokens_out, cache_read, micro_usd) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (day, who, action, model) DO UPDATE SET calls = calls + excluded.calls')
          .bind(dayOf(back), install, action, model, Math.round(30 * scale * (8 - j) / 4), Math.round(140000 * scale * (8 - j) / 4), Math.round(30000 * scale), Math.round(31000 * scale * (8 - j) / 4)).run();
      }
    }
  }
  for (const [account, credit, action] of [['fixture-a', -90000, 'kit'], ['fixture-b', -75000, 'tailor'], ['fixture-c', -52000, 'answer'], ['fixture-a', -31000, 'cover_letter'], ['fixture-d', -22000, 'summary']]) {
    await env.STATS.prepare('INSERT INTO pro_credit (account, delta_micro, reason, ref, at) VALUES (?, ?, ?, ?, ?)').bind(account, credit, 'ai_call', action, stamp(1)).run();
  }
  // the broker's tally: tokens per workflow and day, the engine mix, and the jobs behind a workflow (ca's #379 shape)
  const previous = env.AI_BROKER, soon = Math.round(now / 1000);
  const health = await (await previous.fetch(new Request('https://broker.invalid/health'))).json();
  const engines = (codex, claude, free) => ({codex, claude, 'free-ai': free});
  const days = {}, jobDays = {};
  for (let back = 0; back < 7; back++) {
    days[dayOf(back)] = {
      'demo/repo/self-heal.yml': {calls: 60, ok: 58, tokens: Math.round(2.4e6 * wave(back, 1)), ms: 900000, engines: engines(40, 18, 2)},
      'demo/repo/e2e-quality.yml': {calls: 35, ok: 35, tokens: Math.round(1.1e6 * wave(back, 2)), ms: 400000, engines: engines(35, 0, 0)},
      'demo/repo/daily-digest.yml': {calls: 6, ok: 6, tokens: Math.round(0.2e6 * wave(back, 3)), ms: 60000, engines: engines(6, 0, 0)}};
    jobDays[dayOf(back)] = {'demo/repo/self-heal.yml|ui-fix': {calls: 30, tokens: Math.round(1.5e6 * wave(back, 4))}, 'demo/repo/self-heal.yml|code-review': {calls: 20, tokens: Math.round(0.7e6 * wave(back, 5))}};
  }
  env.AI_BROKER = {fetch: async () => Response.json({...health, limits: {...health.limits, resetsAt: soon + (6 * 24 + 9) * 3600}, tally: {days}, jobs: {days: jobDays}})};
}
