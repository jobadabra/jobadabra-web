// "Who answered today" on the AI cost page (owner, 1 Nov 2026: Claude, Codex or Free AI by one flag, and CI should know which one answers): one row per engine from the broker's /health chain.
// Words and icons, no raw states; one row per engine the broker reports. Guard: test/unit/admin/ai/ai-broker-card.test.js.
import {esc} from '../shared/html.js';
import {ENGINE_NAMES} from '../shared/ai-broker.js';
import {figure, stacks} from './viz.js';

const seconds = ms => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '–');

/** One engine's state as a short phrase with its icon; `now` is epoch ms. */
export function stateOf(item, now) {
  if (!item.configured) return '⚪ off';
  if (item.state === 'token-invalid') return '❌ token rejected';
  if (item.state === 'ran-out') return '⛔ used up';
  const until = Date.parse(item.demotedUntil || '');
  if (until > now) return `⏸ paused until ${new Date(until).toISOString().slice(11, 16)}`;
  if (item.name === 'codex' && !item.answeredToday && item.ranOutToday) return '⛔ used up';   // Codex has no state of its own: every call today said "ran out"
  return '✅ ready';
}

/** The card for a /health chain (null: the broker was not readable). */
export function brokerCard(chain, now = Date.now()) {
  if (!chain) return '<section class="card" id="ai-broker-today"><p class="muted" style="margin:0">Who answered today: data unavailable</p></section>';
  const rows = chain.filter(item => item.name !== 'claude-api');   // Why (3 Nov 2026): a broker not yet redeployed still lists the removed paid engine; never shown
  const table = `<div class="wrap"><table><tr><th>Engine</th><th>Answered</th><th>Ran out</th><th>Failed</th><th>Avg time</th><th>State</th></tr>
${rows.map(item => `<tr><td>${esc(ENGINE_NAMES[item.name] || item.name)}</td><td class="n">${item.answeredToday || 0}</td><td class="n">${item.ranOutToday || 0}</td><td class="n">${item.failedToday || 0}</td><td class="n">${seconds(item.avgMs)}</td><td>${stateOf(item, now)}</td></tr>`).join('\n')}
</table></div>`;
  // The same figures as one stacked bar per engine (owner, 5 Nov 2026: tables that are summaries become charts); the table above stays behind "Show table".
  const chart = stacks(rows.map(item => {
    const [answered, ranOut, failed] = [item.answeredToday || 0, item.ranOutToday || 0, item.failedToday || 0], name = ENGINE_NAMES[item.name] || item.name;
    return {label: name, text: stateOf(item, now), sub: `${answered} ✓ · ${ranOut} ⏳ · ${failed} ✕`, parts: [{value: answered, tone: 'good'}, {value: ranOut, tone: 'warn'}, {value: failed, tone: 'bad'}],
      tip: `${name} · answered ${answered} · ran out ${ranOut} · failed ${failed} · avg time ${seconds(item.avgMs)} · ${stateOf(item, now)}`};
  }), [['good', '✓ answered'], ['warn', '⏳ ran out'], ['bad', '✕ failed']]);
  return `<section class="card" id="ai-broker-today"><h2>🤖 Who answered today</h2><small class="muted">The AI broker tries them in this order; the next one answers when one is used up or fails</small>
${figure({chart, table})}</section>`;
}
