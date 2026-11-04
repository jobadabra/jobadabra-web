// /admin/ai/agents: every AI job on the CI that acts by itself (owner, 3 Nov 2026: fixers are "proper agents"; reviewers that only file or close issues are tagged "issues only"). One card per agent: when it starts,
// what it acts on, its engine, state, last runs, what it opened in 30 days and its broker tokens. Rows come from tools/ci-agents.json via the daily upload. Report only. Test: test/unit/admin/ai-section.test.js.
import {esc} from '../shared/html.js';
import {latestCard, shell, chip, engineChip, stateChip, dots, spendOf, spendRows, tokensWord, emptyCard} from './ai-section.js';

const ago = (day, now) => { const n = Math.floor((now - Date.parse(`${day}T00:00:00Z`)) / 86400000); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
const line = (agent, tally) => {
  const bits = [];
  if (agent.prs) bits.push(`PRs, 30 days: <b>${agent.prs.opened}</b> opened · <b>${agent.prs.merged}</b> merged · <b>${agent.prs.closed}</b> closed · <b>${agent.prs.open}</b> open`);
  if (agent.issues) bits.push(`Issues, 30 days: <b>${agent.issues.opened}</b> filed · <b>${agent.issues.closed}</b> closed`);
  if (tally) bits.push(tally.tokens ? `Broker: <b>${tokensWord(tally.tokens)}</b> tokens, <b>${tally.calls}</b> calls${tally.mix ? ` · ${esc(tally.mix)}` : ''}` : 'Broker: no call counted');
  return bits.length ? `<div class="ai-nums">${bits.map(bit => `<span>${bit}</span>`).join('')}</div>` : '';
};

/** One agent's card. `spend` is spendOf(...) for its workflow or undefined, `now` epoch ms. */
export function agentCard(agent, spend, now) {
  const red = agent.state === 'on' && agent.runs.endsWith('r');
  return `<section class="card ai-agent${agent.state === 'off' ? ' off' : ''}" id="agent-${esc(agent.id)}"><div class="ai-head"><b>${esc(agent.name)}</b>${chip('agent', '🤖 Agent')}${agent.issuesOnly ? chip('plain', 'issues only', 'Files or labels issues; it writes no code') : ''}${engineChip(agent.engine)}${stateChip(agent.state)}${red ? chip('bad', '🔴 last run red') : ''}${agent.today === 'one-shot' ? chip('wait', 'one shot today', 'Picks files or a verdict in one or two calls; the shared agent loop is planned') : ''}</div>
<dl class="ai-facts"><dt>Starts</dt><dd>${esc(agent.starts)}</dd><dt>Acts on</dt><dd>${esc(agent.acts)}</dd><dt>Last runs</dt><dd>${dots(agent.runs)}${agent.state === 'idle' && agent.runs && /^s+$/.test(agent.runs) ? ' <span class="muted">· skipped runs only, never ran</span>' : agent.lastRun ? ` <span class="muted">· last ${esc(ago(agent.lastRun, now))}</span>` : ''}</dd></dl>${line(agent, spend)}</section>`;
}

/** The Agents page from the latest card and the broker tally (null when unreadable). */
export function agentsPage(card, tally, now = new Date()) {
  const agents = card?.agents || [], today = now.toISOString().slice(0, 10), rows = spendRows(tally, today);
  const on = agents.filter(a => a.state === 'on').length, off = agents.filter(a => a.state === 'off').length, idle = agents.filter(a => a.state === 'idle').length, red = agents.filter(a => a.state === 'on' && a.runs.endsWith('r')).length;
  const verdict = `<section class="card"><h2>${agents.length} agents <span class="muted">· acts by itself: code, a pull request, issues or clicks in the app</span></h2><div class="ai-chips">${chip('good', `🟢 ${on} on`)}${off ? chip('wait', `⏸ ${off} off`) : ''}${idle ? chip('wait', `💤 ${idle} idle`) : ''}${red ? chip('bad', `🔴 ${red} last run red`) : chip('good', 'no red last run')}</div>
<p class="muted" style="margin:10px 0 0;font-size:13px">Jobs where the AI only answers a question and the code decides are on <a href="/admin/ai/steps">AI steps</a>.</p></section>`;
  const body = agents.length ? `<div class="ai-grid">${agents.map(agent => agentCard(agent, spendOf(rows, `jobadabra/${agent.id}.yml`), now.getTime())).join('')}</div>` : emptyCard;
  return shell({title: 'Agents', icon: '🤖', heading: 'AI agents', age: card?.at, verdict, body});
}
