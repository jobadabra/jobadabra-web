// /admin/ai/harness: the AI fixer's context layers and source adapters, from the existing harness upload.
// Run outcomes live on the separate Agent runs tab; repository plan checklists are not shown here.
import {esc} from '../shared/html.js';
import {shell, chip} from './ai-section.js';

/** The harness context and sources only; null data shows an explicit empty state. */
export function harnessPage(card) {
  const layers = card?.layers?.length || card?.sources?.length ? `<section class="card"><h2>Context layers and sources <span class="muted">· file facts from the repo, not proof a key works</span></h2>
<div class="ai-wrap"><table><tr><th>Layer</th><th>In the repo</th><th>What</th></tr>${(card.layers || []).map(layer => `<tr><td><b>${esc(layer.id)}</b> ${esc(layer.name)}</td><td>${layer.present ? chip('good', '✅ present') : chip('wait', '⬜ not present')}</td><td class="muted">${esc(layer.note)}</td></tr>`).join('')}</table></div>
<div class="ai-chips" style="margin-top:10px">${(card.sources || []).map(source => chip(source.built ? 'good' : 'wait', `${source.built ? '✅ built' : '⬜ not built'} · ${source.name}`, 'built = a fetcher file exists in the repo; it does not prove its key or a live read')).join('')}</div></section>` : '<section class="card"><h2>Context layers and sources</h2><p class="muted" style="margin:0">Not reported yet.</p></section>';
  return shell({title: 'Agent harness', icon: '🧰', heading: 'Agent harness', age: card?.at, verdict: '', body: layers});
}
