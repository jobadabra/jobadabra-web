// admin/ai-workflow-tokens.js: "what each CI workflow spent on the AI broker" on the AI cost page, from the broker's /health tally (owner, 3 Nov 2026: "how many tokens it burns compared to all the CI workflows").
// Counts and token sums per workflow file, last 7 days and today; never a prompt, a login or a key. Guard: test/admin/ai-workflow-tokens.test.js.
import {esc} from '../shared/html.js';
import {ENGINE_NAMES} from '../shared/ai-broker.js';

const number = value => Number(value || 0).toLocaleString('en-US');
const tokens = value => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value));

/**
 * One row per workflow, biggest token user first, summed over the days given: [{name, calls, ok, tokens, today, engines: {name: calls}, share}], share = its tokens / all workflows' tokens (0..1).
 * Takes the broker's tally ({days: {<YYYY-MM-DD>: {<workflow>: {calls, ok, tokens, ms, engines}}}}) and today's UTC day.
 */
export function workflowRows(tally, today) {
  const rows = new Map();
  for (const [day, workflows] of Object.entries(tally?.days || {})) {
    for (const [name, item] of Object.entries(workflows || {})) {
      const row = rows.get(name) || {name, calls: 0, ok: 0, tokens: 0, today: 0, engines: {}};
      row.calls += item.calls || 0; row.ok += item.ok || 0; row.tokens += item.tokens || 0;
      if (day === today) row.today += item.tokens || 0;
      for (const [engine, n] of Object.entries(item.engines || {})) row.engines[engine] = (row.engines[engine] || 0) + n;
      rows.set(name, row);
    }
  }
  const all = [...rows.values()], total = all.reduce((sum, row) => sum + row.tokens, 0);
  return all.map(row => ({...row, share: total ? row.tokens / total : 0})).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/** "Codex 60% · Claude 40%" from the engine call counts; '' when none answered. */
export function engineMix(engines) {
  const total = Object.values(engines || {}).reduce((sum, n) => sum + n, 0);
  return total ? Object.entries(engines).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${ENGINE_NAMES[name] || name} ${Math.round(100 * n / total)}%`).join(' · ') : '';
}

/** The card for a /health tally (null: the broker has none yet, an older build). `today` is the UTC day "YYYY-MM-DD". */
export function workflowCard(tally, today) {
  if (!tally) return '<section class="card" id="ai-workflow-tokens"><p class="muted" style="margin:0">Tokens per workflow: data unavailable</p></section>';
  const rows = workflowRows(tally, today), days = Object.keys(tally.days || {}).length;
  const body = rows.length ? rows.map(row => `<tr><td style="white-space:nowrap">${esc(row.name)}</td><td class="n">${number(row.calls)}</td><td class="n">${tokens(row.tokens)}</td><td class="n">${tokens(row.today)}</td>
<td style="min-width:120px"><div style="background:var(--line);border-radius:4px;height:10px"><div style="background:var(--amber);height:10px;border-radius:4px;width:${Math.max(1, Math.round(row.share * 100))}%"></div></div></td><td class="n">${Math.round(row.share * 100)}%</td><td class="muted" style="white-space:nowrap">${esc(engineMix(row.engines))}</td></tr>`).join('\n')
    : '<tr><td colspan="7" class="muted">No call counted yet: the count starts with the first AI call after this broker build.</td></tr>';
  return `<section class="card" id="ai-workflow-tokens"><h2>⚙️ Tokens per CI workflow</h2><small class="muted">The last ${days} day${days === 1 ? '' : 's'} the broker has counted (the workflow comes from GitHub's signed run token) · tokens = input + output as the engine reports them; a refused or failed answer counts as a call with no tokens</small>
<div class="wrap"><table><tr><th>Workflow</th><th>Calls</th><th>Tokens</th><th>Today</th><th>Share</th><th></th><th>Answered by</th></tr>
${body}
</table></div></section>`;
}
