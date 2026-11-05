// The "harness-fixer" upload and its card on /admin/ai/harness (owner, 5 Nov 2026: "how efficient it is ..." for the harness tools; then "Let's for now go on the CI harness only").
// Sent daily by the public repo's tools/harness-stats.mjs (kind "harness-fixer" of /agent-coding/data) from the fixer's run records of the last 30 days: a run "used the map" when a step read a page under docs/map/.
// Schema (agreed with the fixer's pane, 5 Nov 2026): {runs, tools: [{id: 'map-index'|'map-hub', runs}], help: {with_map, without_map}} where a group is {n, turns, calls, minutes, ready}: n runs, AVERAGES of turns/calls/minutes (1 decimal), ready = runs of the group that stopped 'ready'.
// Numbers only. Every value is data: clamped here on write AND again on read (the page reads stored JSON as it is), so a card from before a change cannot throw or become HTML. Test: test/unit/admin/ai/harness-usage.test.js.
import {esc} from '../shared/html.js';
import {chip} from './ai-section.js';

const count = value => Math.min(1e7, Math.max(0, Math.round(Number(value) || 0)));
const avg = value => Math.min(1e5, Math.max(0, Math.round((Number(value) || 0) * 10) / 10));
export const TOOL_IDS = ['map-index', 'map-hub'];
const TOOL_WORDS = {'map-index': ['Map index', 'docs/map/index.md'], 'map-hub': ['Map hub', 'a docs/map/<hub>.md page']};
/** Below this many runs in a group the page says "too few to compare" instead of a verdict. */
export const MIN_GROUP = 5;
const DAY = /^\d{4}-\d\d-\d\d$/;

const group = (source, room) => { const n = Math.min(room, count(source?.n)); return {n, turns: avg(source?.turns), calls: avg(source?.calls), minutes: avg(source?.minutes), ready: Math.min(n, count(source?.ready))}; };

/** One day of the fixer upload -> the clamped card, or null when it is not an object. Unknown tool ids are dropped, a repeated id keeps its first row. */
export function cleanFixer(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card) || typeof card.runs !== 'number' || !Array.isArray(card.tools)) return null;   // Why (5 Nov 2026, review): a malformed day must answer 400, not overwrite the last good day with zeros
  const runs = count(card.runs), seen = new Set();
  const tools = (Array.isArray(card.tools) ? card.tools.slice(0, 20) : []).filter(tool => TOOL_IDS.includes(tool?.id) && !seen.has(tool.id) && seen.add(tool.id)).map(tool => ({id: tool.id, runs: Math.min(runs, count(tool.runs))}));
  const yes = group(card.help?.with_map, runs);   // the two groups are parts of the same runs: they cannot add up to more than `runs`
  return {runs, tools, help: {with_map: yes, without_map: group(card.help?.without_map, runs - yes.n)}};
}

const pct = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);
const bar = share => `<span class="hu-bar" role="img" aria-label="${share}% of runs"><i style="width:${share}%"></i></span>`;

/** The verdict chip and sentence: nothing is claimed below MIN_GROUP runs in either group; otherwise the difference in turns, said as a link in observed runs, not a cause. */
function verdict(help) {
  const {with_map: yes, without_map: no} = help;
  if (yes.n < MIN_GROUP || no.n < MIN_GROUP || !no.turns) return {chip: chip('wait', `⚠️ too few to compare · ${yes.n} with the map, ${no.n} without`, `Needs at least ${MIN_GROUP} runs in each group`), line: `${yes.n} runs used the map and ${no.n} did not: too few runs to compare (needs ${MIN_GROUP} in each group, with turns counted).`};
  const change = no.turns ? Math.round((yes.turns - no.turns) / no.turns * 100) : 0;
  const kind = change <= -10 ? ['good', `✅ ${-change}% fewer turns with the map`] : change >= 10 ? ['warn', `▲ ${change}% more turns with the map`] : ['plain', '≈ about the same turns'];
  return {chip: chip(...kind), line: `Runs that read the map took <b>${yes.turns}</b> turns on average, runs that did not <b>${no.turns}</b>. The runs are not matched, so this shows a link, not a cause.`};
}

export const USAGE_STYLE = '.hu-bar{display:inline-block;width:80px;height:8px;background:#262c33;border-radius:4px;overflow:hidden;vertical-align:middle}.hu-bar i{display:block;height:100%;background:#5ec47a}.ai-wrap .hu-tbl{min-width:0}@media(min-width:700px){.hu-bar{width:120px}}.hu-tools td:nth-child(2){white-space:nowrap}.hu-tbl td:not(:first-child),.hu-tbl th:not(:first-child){text-align:right}';

/** The card "Use by the CI fixer · does the map help?" from a stored fixer card (or null) and its stored day; "No data yet" when there is no card or it counted no run. */
export function fixerCard(stored) {
  const card = cleanFixer(stored), title = 'Use by the CI fixer · does the map help?';
  if (!card || !card.runs) return `<section class="card"><h2>${title}</h2><p class="muted" style="margin:0">No data yet: the daily harness stats upload fills it from the fixer's run records.</p></section>`;
  const {with_map: yes, without_map: no} = card.help, call = verdict(card.help), day = typeof stored.day === 'string' && DAY.test(stored.day) ? stored.day : '';
  const tools = TOOL_IDS.map(id => { const row = card.tools.find(tool => tool.id === id), runs = row ? row.runs : 0, [name, where] = TOOL_WORDS[id];
    return `<tr><td>${runs ? chip('good', '✅ used') : chip('wait', '⬜ not used')} <b>${esc(name)}</b> <span class="muted">${esc(where)}</span></td><td><b>${runs}</b> of ${card.runs} runs</td><td>${bar(pct(runs, card.runs))}</td></tr>`; }).join('');
  const ready = group => `<b>${group.ready}</b> of ${group.n}${group.n ? ` · ${pct(group.ready, group.n)}%` : ''}`;
  return `<section class="card"><h2>${title} <span class="muted">· last 30 days · ${card.runs} runs${day ? ` · as of ${esc(day)}` : ''}</span></h2>
<div class="ai-chips">${call.chip}</div><p style="margin:8px 0">${call.line}</p>
<div class="ai-wrap"><table class="hu-tbl hu-tools"><tr><th>Map page read</th><th>Runs</th><th>Share</th></tr>${tools}</table></div>
<details><summary>With the map vs without</summary><div class="ai-wrap"><table class="hu-tbl"><tr><th></th><th>With the map</th><th>Without</th></tr>
<tr><td>Runs</td><td><b>${yes.n}</b></td><td><b>${no.n}</b></td></tr><tr><td>Turns (average)</td><td><b>${yes.turns}</b></td><td><b>${no.turns}</b></td></tr>
<tr><td>Broker calls (average)</td><td><b>${yes.calls}</b></td><td><b>${no.calls}</b></td></tr><tr><td>Minutes (average)</td><td><b>${yes.minutes}</b></td><td><b>${no.minutes}</b></td></tr>
<tr><td>Reached READY</td><td>${ready(yes)}</td><td>${ready(no)}</td></tr></table></div>
<p class="muted" style="margin:6px 0 0">A run "used the map" when one of its steps read a page under docs/map/ (a search names a folder, not a page, so it does not count). Counts come from the fixer's run records, no AI; the groups differ in more than the map, so read this as a hint.</p></details></section>`;
}
