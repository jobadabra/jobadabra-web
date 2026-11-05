// /admin/ai/harness: the AI fixer's context layers and source adapters, from the existing harness upload.
// Run outcomes live on the separate Agent runs tab; repository plan checklists are not shown here.
import {esc} from '../shared/html.js';
import {shell, chip} from './ai-section.js';

// Why (5 Nov 2026, owner: "why it shows that PostHog is green when you say is not connected"): the chip said "built" in green for a fetcher whose key was never created. Now the word names
// both facts: the code is in the repo, and a read-only key is stored or not. `key` comes from a trusted CI step that only tests whether the secret is set ('' = the sender did not say).
// Neither fact proves a live read worked, and the title says so. A card stored before this field existed is rendered raw (cleanHarness runs on write only), so a missing key reads as ''.
const KEY_WORDS = {set: ['good', '✅ code built · key set'], missing: ['warn', '⚠️ code built · no key yet'], '': ['wait', '🔧 code built · key not reported']};
const sourceChip = source => {
  const [kind, text] = source.built ? KEY_WORDS[source.key] || KEY_WORDS[''] : ['wait', '⬜ not built'];
  return chip(kind, `${text} · ${source.name}`, 'code built = the fetcher file is in the repo; key = a read-only key is stored for the CI fixer. Neither proves a live read worked.');
};

/** The harness context and sources only; null data shows an explicit empty state. */
export function harnessPage(card) {
  const layers = card?.layers?.length || card?.sources?.length ? `<section class="card"><h2>Context layers and sources <span class="muted">· what the repo has, and whether a key is stored; a live read is not proven here</span></h2>
<div class="ai-wrap"><table><tr><th>Layer</th><th>In the repo</th><th>What</th></tr>${(card.layers || []).map(layer => `<tr><td><b>${esc(layer.id)}</b> ${esc(layer.name)}</td><td>${layer.present ? chip('good', '✅ present') : chip('wait', '⬜ not present')}</td><td class="muted">${esc(layer.note)}</td></tr>`).join('')}</table></div>
<div class="ai-chips" style="margin-top:10px">${(card.sources || []).map(sourceChip).join('')}</div></section>` : '<section class="card"><h2>Context layers and sources</h2><p class="muted" style="margin:0">Not reported yet.</p></section>';
  return shell({title: 'Agent harness', icon: '🧰', heading: 'Agent harness', age: card?.at, verdict: '', body: layers});
}
