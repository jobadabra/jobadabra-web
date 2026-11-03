// The AI section of /admin (owner, 3 Nov 2026: "a separate top level: AI tab ... AI Agents, AI steps ... AI costs ... everything happening on the CI"): what the pages Agents, AI steps and Engines share.
// Data: the daily upload of kind "agents" (tools/ci-agents-stats.mjs in the public repo, from its registry tools/ci-agents.json, stored by admin/agent-coding.js) and the broker's /health tally.
// Pure parts: rows in, HTML out; report only, nothing here changes anything. Test: test/admin/ai-section.test.js.
import {esc} from '../shared/html.js';
import {workflowRows, engineMix} from './ai-workflow-tokens.js';

export const ENGINE_WORDS = {broker: 'Broker', 'api-key': 'API key', free: 'Free AI', 'workers-ai': 'Workers AI'};
const STATE_WORDS = {on: ['good', '🟢 On'], idle: ['wait', '⚪ Idle'], off: ['wait', '⏸ Off']};
const RUN_WORDS = {g: 'green', r: 'red', s: 'skipped', c: 'cancelled', '.': 'running'};
const COUNT = new Intl.NumberFormat('en-US');

/** The newest stored "agents" card {agents, steps} with its day, or null when nothing was uploaded. Takes the D1 handle. */
export async function latestCard(env) {
  try {
    const row = await env.STATS?.prepare("SELECT day, card, updated_at FROM agent_coding_days WHERE kind = 'agents' ORDER BY day DESC LIMIT 1").first();
    return row ? {...JSON.parse(row.card), day: row.day, at: row.updated_at} : null;
  } catch { return null; }
}

export const chip = (kind, text, title = '') => `<span class="ai-chip ${kind}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
export const engineChip = engine => chip(engine === 'api-key' ? 'warn' : 'plain', ENGINE_WORDS[engine] || engine, engine === 'api-key' ? 'Runs on an API key, not the Codex plan' : '');
export const stateChip = state => chip(...(STATE_WORDS[state] || STATE_WORDS.idle));
/** The last runs as coloured dots, oldest first, each with its word for screen readers and tooltips; '' when there are none. */
export const dots = runs => (runs ? `<span class="ai-dots" role="img" aria-label="Last runs, oldest first: ${esc([...runs].map(c => RUN_WORDS[c] || 'unknown').join(', '))}">${[...runs].map(c => `<i class="r-${c === '.' ? 'x' : c}" title="${RUN_WORDS[c] || ''}"></i>`).join('')}</span>` : '<span class="muted">no runs</span>');
/** One workflow's tokens in the last days the broker counted: {calls, tokens, mix} or null when it made no call. Takes the rows of workflowRows and the "repo/file" key. */
export const spendOf = (rows, key) => { const row = rows.find(item => item.name === key); return row ? {calls: row.calls, tokens: row.tokens, mix: engineMix(row.engines)} : null; };
export const tokensWord = value => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : COUNT.format(value));
export const spendRows = (tally, today) => (tally ? workflowRows(tally, today) : []);

export const STYLE = `.ai-top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.ai-chips{display:flex;flex-wrap:wrap;gap:8px}
.ai-chip{border:1px solid #262c33;border-radius:999px;padding:3px 11px;font-size:12.5px;white-space:nowrap;color:#c4c9cf}.ai-chip.good{color:#5ec47a;border-color:#2d5a3b}.ai-chip.warn{color:#f2c14e;border-color:#6b5a21}.ai-chip.bad{color:#ff8f84;border-color:#7a3430}.ai-chip.wait{color:#8d949c}.ai-chip.agent{color:#b48cff;border-color:#4d3a7a}
.ai-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px}.ai-agent{display:grid;gap:8px;align-content:start;margin:0!important}.ai-agent.off{opacity:.7}
.ai-head{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}.ai-head b{font-size:15px;margin-right:4px}.ai-facts{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px;margin:0}.ai-facts dt{color:#8d949c}.ai-facts dd{margin:0}
.ai-dots{display:inline-flex;gap:3px;vertical-align:middle}.ai-dots i{width:10px;height:10px;border-radius:50%;background:#5b6470}.ai-dots i.r-g{background:#5ec47a}.ai-dots i.r-r{background:#e5484d}.ai-dots i.r-x{background:#f2c14e}
.ai-nums{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13px;color:#c4c9cf}.ai-nums b{font-variant-numeric:tabular-nums}.ai-wrap{overflow-x:auto}.ai-wrap table{min-width:640px}
@media (max-width:700px){.ai-grid{grid-template-columns:1fr}}`;

/** The page shell the three views share: title, heading with the data's age, a verdict card, then the body. `age` is the card's stored time or ''. */
export function shell({title, icon, heading, age, verdict, body}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · AI · Admin</title>
<link rel="icon" href="/favicon-32.png"><style>${STYLE}</style></head><body><main>
<header><h1>${icon} ${esc(heading)}</h1><span class="muted ai-top">${age ? `data as of ${esc(String(age).slice(0, 16).replace('T', ' '))} UTC` : 'no data yet'}</span></header>
${verdict}${body}</main></body></html>`;
}
export const emptyCard = '<section class="card"><p class="muted" style="margin:0">No agent numbers yet: the daily stats run (agent-coding-stats.yml) uploads them once it has the registry.</p></section>';
