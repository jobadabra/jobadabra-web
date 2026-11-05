// The owner’s Pro AI cost section: actual charged calls from the credit ledger, with raw cost estimated at the current credit conversion.
import {CREDIT_PER_COST, USD_PER_EUR} from '../shared/pro-packages.js';
import {esc} from '../shared/html.js';
import {proFigure} from './jobcost-charts.js';
const money = (value, currency = '$') => `${currency}${Number(value || 0).toFixed(2)}`;
const rawUsd = creditEur => creditEur / CREDIT_PER_COST * USD_PER_EUR;

/** Read aggregate Pro charges only; no account identities leave the query. Null means unavailable, distinct from zero use. */
export async function readProCosts(db, now = new Date(), hours = 720, start = '') {
  const cutoff = new Date(now.getTime() - (hours <= 24 ? hours : hours - 24) * 3600000).toISOString();
  const from = hours <= 24 ? cutoff : `${cutoff.slice(0, 10)}T00:00:00.000Z`;
  const since = start && `${start}T00:00:00.000Z` > from ? `${start}T00:00:00.000Z` : from;
  // Why (27 Oct 2026, owner): the approved Pro section must count charged Pro calls; model names cannot identify a billing lane in the older ai_calls log.
  const where = "FROM pro_credit WHERE reason = 'ai_call' AND delta_micro < 0 AND at >= ? AND at <= ?";
  try {
    const all = async sql => (await db.prepare(sql).bind(since, now.toISOString()).all()).results || [];
    const [totals, rows] = await Promise.all([
      all(`SELECT COUNT(*) AS calls, COUNT(DISTINCT account) AS accounts, COALESCE(-SUM(delta_micro), 0) AS micro ${where}`),
      all(`SELECT COALESCE(ref, 'other') AS action, COUNT(*) AS calls, -SUM(delta_micro) AS micro ${where} GROUP BY COALESCE(ref, 'other') ORDER BY micro DESC`),
    ]);
    const total = totals[0], creditEur = Number(total.micro) / 1e6;
    return {calls: Number(total.calls), accounts: Number(total.accounts), creditEur, estimatedUsd: rawUsd(creditEur),
      steps: rows.map(row => ({action: row.action, calls: Number(row.calls), creditEur: Number(row.micro) / 1e6, estimatedUsd: rawUsd(Number(row.micro) / 1e6)}))};
  } catch { return null; }
}

/** Render Pro credit use separately from Free AI and scheduled-job totals; raw USD is explicitly an estimate, not a provider bill. */
export function proSection(summary, label) {
  if (!summary) return '<section class="card" id="pro-ai-cost"><h2>✨ Pro AI</h2><p class="muted">Pro cost data unavailable.</p></section>';
  return `<section class="card" id="pro-ai-cost"><h2>✨ Pro AI</h2>
<p class="muted">Last ${esc(label)} · ${summary.calls} calls · ${summary.accounts} accounts · ${money(summary.creditEur, '€')} of credit used</p>
<p class="muted">Estimated raw cost: ${money(summary.estimatedUsd)}. Converted from charged credit at the current rate (€1 credit = €${1 / CREDIT_PER_COST} raw cost; €1 = $${USD_PER_EUR}). These are Pro credit charges, including Workers AI fallback calls. Free AI and scheduled-job totals are separate.</p>
${summary.calls ? proFigure(summary.steps, `<div class="wrap"><table><tr><th>Step</th><th>Calls</th><th>Credit used</th><th>Estimated raw cost</th><th>Per call</th></tr>
${summary.steps.map(row => `<tr><td>${esc(row.action)}</td><td class="n">${row.calls}</td><td class="n">${money(row.creditEur, '€')}</td><td class="n">${money(row.estimatedUsd)}</td><td class="n">$${(row.estimatedUsd / row.calls).toFixed(4)}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="n">${summary.calls}</td><td class="n">${money(summary.creditEur, '€')}</td><td class="n">${money(summary.estimatedUsd)}</td><td class="n">$${(summary.estimatedUsd / summary.calls).toFixed(4)}</td></tr></table></div>`) : '<p class="muted">No charged Pro AI calls in this period.</p>'}</section>`;
}
