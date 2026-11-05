// /admin/ai/steps: the AI steps of the CI (owner, 3 Nov 2026): jobs where the AI answers a question and the code decides what happens (judges, drift, personas, learners, digests). One table from the registry
// tools/ci-agents.json via the daily upload, with each job's engine, state, last runs and broker tokens. Only this repo's workflows carry runs; the web and lab repos' rows show their engine only. Test: test/unit/admin/ai-section.test.js.
import {esc} from '../shared/html.js';
import {shell, chip, engineChip, stateChip, dots, spendOf, spendRows, tokensWord, emptyCard} from './ai-section.js';

/** The AI steps page from the latest card and the broker tally (null when unreadable). */
export function stepsPage(card, tally, now = new Date()) {
  const steps = card?.steps || [], rows = spendRows(tally, now.toISOString().slice(0, 10)), keys = steps.filter(step => step.engine === 'api-key' && !step.product).length;
  const verdict = `<section class="card"><h2>${steps.length} AI steps <span class="muted">· the AI answers, the code decides</span></h2><div class="ai-chips">${keys ? chip('warn', `▲ ${keys} CI job${keys === 1 ? '' : 's'} still on an API key`, 'Against the rule: CI AI runs on the Codex plan') : chip('good', 'none on an API key')}</div>
<p class="muted" style="margin:10px 0 0;font-size:13px">Jobs that act by themselves are on <a href="/admin/ai/agents">AI agents</a>.</p></section>`;
  const body = steps.length ? `<section class="card ai-wrap"><table><tr><th>Job</th><th>Repo</th><th>Engine</th><th>State</th><th>Last runs</th><th>Broker, last days</th></tr>
${steps.map(step => { const spend = spendOf(rows, `${step.repo}/${step.file}`); return `<tr><td><b>${esc(step.name)}</b><br><span class="muted" style="font-size:12px">${esc(step.file)}</span></td><td class="muted">${esc(step.repo)}</td><td>${engineChip(step.engine)}${step.product ? ` ${chip('plain', 'product pipeline', 'The user\'s own job-search pipeline, called from the private repo')}` : ''}</td><td>${step.state ? stateChip(step.state) : '<span class="muted">–</span>'}</td><td>${step.runs ? dots(step.runs) : step.state ? '<span class="muted">no runs of its own</span>' : '<span class="muted">not read here</span>'}</td><td>${spend && spend.tokens ? `${tokensWord(spend.tokens)} tokens · ${spend.calls} calls` : '<span class="muted">none</span>'}</td></tr>`; }).join('\n')}
</table></section>` : emptyCard;
  return shell({title: 'AI steps', icon: '⚙️', heading: 'AI steps', age: card?.at, verdict, body});
}
