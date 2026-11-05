// /admin/ai/costs: the board web search for Free AI without a plan (shared/free-ai-web.js) against its month line (owner, 26 Oct 2026: "Yes, $10/month cap"):
// this month's spend, the searches it paid for, and the asks answered from the shared 30-day answers at no cost. Counts and money only.
// Guard: test/unit/shared/free-ai/free-ai-web.test.js.
import {keys, monthLine} from '../shared/free-ai-web.js';
const money = n => `$${(Number(n) || 0).toFixed(2)}`;

export async function webMonth(kv, env = {}, now = new Date()) {
  if (!kv) return null;
  const month = now.toISOString().slice(0, 7);
  try {
    const [micro, calls, hits] = await Promise.all([keys.month(month), keys.calls(month), keys.hits(month)].map(async key => Number(await kv.get(key)) || 0));
    return {month, usd: micro / 1e6, line: monthLine(env), calls, hits, paused: env.FREE_AI_WEB_SEARCH === 'off' || !env.WEB_SEARCH_ANTHROPIC_KEY};
  } catch { return null; }
}

export function webSection(web) {
  if (!web) return '';
  const share = web.line ? Math.min(100, Math.round(100 * web.usd / web.line)) : 0;
  const state = web.paused ? ' · ⏸ paused (FREE_AI_WEB_SEARCH=off or no WEB_SEARCH_ANTHROPIC_KEY)' : web.usd >= web.line ? ' · ⛔ stopped until next month' : '';
  return `<section class="card"><h2>🔎 Web search for Free AI</h2><small class="muted">Job board search for installs without Claude Code or Codex: Anthropic API, its own key and workspace. ${web.month}: ${money(web.usd)} of ${money(web.line)} (${share}%) · ${web.calls} searches paid · ${web.hits} answered from the shared answers ($0)${state}</small></section>`;
}
