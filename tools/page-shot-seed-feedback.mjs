// Fictional feedback rows for the real Worker previews; no live data, account or AI call.
import {reconcileRuns} from '../shared/feedback-runs.js';
import {PUBLIC_REPO} from '../shared/repos.js';

/** Seeds the feedback inbox with the existing fictional reports and workflow states. */
export async function feedbackSeed({env}) {
  if (await env.STATS.prepare("SELECT ref FROM feedback WHERE ref = 'a1b2c3d4e5f60718'").first()) return;   // the all-pages walk composes these seeds in one database
    const fs = await import('node:fs'), kept = new Map(), shot = fs.readFileSync('desktop/docs/ui/actions.jpg');
    env.FEEDBACK_FILES = {put: async (key, value) => { kept.set(key, value); }, get: async key => (kept.has(key) ? {body: kept.get(key)} : null),
      list: async ({prefix}) => ({objects: [...kept.keys()].filter(key => key.startsWith(prefix)).map(key => ({key})), truncated: false}), delete: async keys => { for (const key of [].concat(keys)) kept.delete(key); }};
    const logs = ['2026-11-02 09:12:03 info  app v0.5.71 win32 10.0.19045', '2026-11-02 09:12:41 warn  setup  AI engine: not ready (no key)', '2026-11-02 09:12:42 error setup  Notion connect failed: 401', 'Authorization: <secret>'].join('\n');
    const pageData = JSON.stringify({screen: 'What we learned', questions: [{id: 'q-summary', wording: 'Summary', field: 'summary', value: 'Summary', verdict: 'saved'}]}, null, 1);
    const rows = [['a1b2c3d4e5f60718', 'win32', 'Settings', 'Setup stops at the AI step and nothing says why.', 'sent', 'jpg', 1, 5], ['0f0e0d0c0b0a0908', 'darwin', '', 'The kit is great, setup took 20 min.', 'sent', '', 0, 30], ['1122334455667788', 'win32', 'Actions', 'Find jobs does nothing after the update.', 'failed: 400 Bad Request: chat not found', '', 0, 50]];
    for (const [ref, platform, screen, text, notified, shotType, hasLogs, minutes] of rows) {
      const at = new Date(Date.now() - minutes * 60000).toISOString();
      if (shotType) kept.set(`feedback/${ref}/screen.jpg`, shot);
      if (hasLogs) kept.set(`feedback/${ref}/logs.txt`, logs);
      if (hasLogs) { kept.set(`feedback/${ref}/page.json`, pageData); kept.set(`feedback/${ref}/profile.json`, '{\n "details": {"role": "Product designer", "city": "Porto"}\n}'); }
      await env.STATS.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, screen, shot, logs, page, profile, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(at, at.slice(0, 10), `install-${ref.slice(0, 8)}`, '0.5.71', platform, text, hasLogs ? 'ana@example.com' : '', ref, screen, shotType, hasLogs, hasLogs, hasLogs, notified).run();
    }
    // 3 Nov 2026 (feedback actions): the first one rated high, the second medium; a dismissed one and a false positive with its reason, older, so the filters have something to show
    await env.STATS.prepare("UPDATE feedback SET impact = 'high' WHERE ref = 'a1b2c3d4e5f60718'").run();
    await env.STATS.prepare("UPDATE feedback SET impact = 'medium' WHERE ref = '0f0e0d0c0b0a0908'").run();
    // PR 2/7: the AI's suggestions: one the owner already agreed with, one still waiting for his decision, one where the AI was unavailable
    await env.STATS.prepare("UPDATE feedback SET impact_ai = 'high', impact_why = 'blocks setup for this person' WHERE ref = 'a1b2c3d4e5f60718'").run();
    await env.STATS.prepare("UPDATE feedback SET impact_ai = 'low', impact_why = 'praise with a timing remark' WHERE ref = '0f0e0d0c0b0a0908'").run();
    await env.STATS.prepare("UPDATE feedback SET impact_ai = 'medium', impact_why = 'real problem, a workaround exists' WHERE ref = '1122334455667788'").run();
    await env.STATS.prepare("UPDATE feedback SET impact_why = 'AI unavailable: 4006: daily free allocation used', impact_tries = 1 WHERE ref = 'aaaa000011112222'").run();
    // PR 3/7 and the Released PR: a fixed one (told, seen), one fixed and waiting for a release, three released (told; mid-tell; e-mail not confirmed), one deferred with its Linear link
    for (const [ref, text, state, hours, cols] of [['cccc000011112222', 'Setup stops at Connect LinkedIn and the button does nothing.', 'fixed', 80, {fixed_in: '0.9.12', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3012', told: 'app+mail', seen_at: 'x'}],
      ['dddd000011112222', 'The tracker loses my column order after an update.', 'fixed', 90, {pr_url: 'https://github.com/jobadabra/jobadabra/pull/3020', told: 'pending', tell_mode: 'release'}],
      ['ffff000011112222', 'The CV import drops my last job.', 'released', 70, {fixed_in: '0.9.13 (beta)', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3031', told: 'app, error: not confirmed'}],
      ['9999000011112222', 'Reminders fire an hour late after the clocks change.', 'released', 60, {fixed_in: '0.9.13 (beta)', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3033', told: 'telling'}],
      ['abab000011112222', 'The Windows installer says the app is damaged.', 'released', 50, {fixed_in: '0.9.12 (stable)', pr_url: 'https://github.com/jobadabra/jobadabra/pull/3015', told: 'app+mail', impact: 'high'}],
      ['eeee000011112222', 'Would be nice to export the tracker as CSV.', 'deferred', 100, {linear_url: 'https://linear.app/jobadabra/issue/JOB-142', told: 'app, mail refused: unsubscribed', impact: 'low'}]]) {
      const at = new Date(Date.now() - hours * 3600000).toISOString();
      await env.STATS.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, notified, state, state_at, fixed_in, pr_url, linear_url, told, tell_mode, seen_at, impact) VALUES (?, ?, ?, '0.5.70', 'darwin', ?, 'ana@example.com', ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(at, at.slice(0, 10), `install-${ref.slice(0, 8)}`, text, ref, state, at, cols.fixed_in || '', cols.pr_url || '', cols.linear_url || '', cols.told || '', cols.tell_mode || '', cols.seen_at ? at : '', cols.impact || '').run();
    }
    for (const [ref, text, state, note, hours] of [['aaaa000011112222', 'asdf test test', 'dismissed', '', 30], ['bbbb000011112222', 'Why does the app not open my own browser profile?', 'false_positive', 'Works as designed: it uses its own profile', 52]]) {
      const at = new Date(Date.now() - hours * 3600000).toISOString();
      await env.STATS.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, notified, state, state_at, state_note) VALUES (?, ?, ?, '0.5.70', 'darwin', ?, '', ?, 'sent', ?, ?, ?)")
        .bind(at, at.slice(0, 10), `install-${ref.slice(0, 8)}`, text, ref, state, at, note).run();
    }
    // 3 Nov 2026 (Send to AI, 7/7; invented rows): one run going (with its GitHub run link), one with its draft PR open, one back to new with the AI's verdict and reason
    for (const [ref, text, state, hours, cols] of [
      ['5151000011112222', 'The Track page crashes when I filter by a company with an accent.', 'ai_running', 0.2, {ai_run: '9001', ai_run_url: 'https://github.com/jobadabra/jobadabra/actions/runs/9001'}],
      ['5252000011112222', 'Dark mode: the salary field text is unreadable.', 'ai_pr', 2, {pr_url: 'https://github.com/jobadabra/jobadabra/pull/3100', ai_run_url: ''}],
      ['5353000011112222', 'The Apply button does nothing on one job board.', 'new', 3, {state_note: '🤖 not-reproducible: the button works on the recorded page of that board; it needs the browser version and the board name'}]]) {
      const at = new Date(Date.now() - hours * 3600000).toISOString();
      await env.STATS.prepare("INSERT INTO feedback (at, day, install, version, platform, text, contact, ref, notified, state, state_at, ai_run, ai_run_url, pr_url, state_note) VALUES (?, ?, ?, '0.5.70', 'darwin', ?, '', ?, 'sent', ?, ?, ?, ?, ?, ?)")
        .bind(at, at.slice(0, 10), `install-${ref.slice(0, 8)}`, text, ref, state, at, cols.ai_run || '', cols.ai_run_url || '', cols.pr_url || '', cols.state_note || '').run();
    }
}

/** Shows the same fictional card before and after a failed run is reconciled, with a stand-in GitHub response only. */
export async function feedbackRunSeed(context, recovered = false) {
  await feedbackSeed(context);
  const now = new Date(), ref = 'a1b2c3d4e5f60718';
  await context.env.STATS.prepare("UPDATE feedback SET state = 'ai_running', state_at = ?, ai_run = '', ai_run_url = '', state_note = '' WHERE ref = ?").bind(now.toISOString(), ref).run();
  if (recovered) {
    const run = {id: 9002, display_title: `AI fixer feedback ${ref}`, path: '.github/workflows/ai-fixer.yml', event: 'workflow_dispatch', head_branch: 'main', created_at: now.toISOString(), status: 'completed', conclusion: 'failure'};
    await reconcileRuns({...context.env, TIMERS_REPO: PUBLIC_REPO, TIMERS_GITHUB_TOKEN: 'demo-token'}, now, async () => Response.json({workflow_runs: [run]}));
  }
}
