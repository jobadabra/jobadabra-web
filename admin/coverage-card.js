// The "Test coverage" section of /admin/testing/integrations (owner via a8, 1 Nov 2026: "A card on Integrations"): line % per test layer, per folder, and which GTM journeys have a test at
// which layer. Draws admin/coverage-intel.js's part of the snapshot only. REPORT ONLY: no target, no red/green on a number; "not measured" (a source was missing that night) is never 0%.
// Built from the page's own pieces: .tiles/.card.tile, chip(), the table inside .scroll, <details>. Guard: test/unit/admin/coverage-card.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';

export const COVERAGE_CSS = `${CHIP_STYLE}` + '.covcell{display:flex;align-items:center;gap:8px;min-width:110px}.covcell>span:first-child{min-width:46px}.covbar{flex:1 1 48px;max-width:84px;height:6px;border-radius:3px;background:#2a2f37;overflow:hidden}'
  + '.covbar i{display:block;height:100%;background:#3987e5}.covh{margin:20px 0 8px;font-size:15px}.covlist summary{cursor:pointer;margin:10px 0 6px}.covlist .num{text-align:right}';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const LAYER_WORDS = {'e2e': 'e2e', integration: 'integration', unit: 'unit', 'nightly report': 'nightly report'};
const shown = cell => (cell.state === 'measured' ? `${cell.pct}%` : cell.state);

/** The change of a layer's total against the night before, in points: "+1.2 pts", or '' when either night was not measured. */
export function trend(coverage, id) {
  const rows = coverage.history.filter(row => row.pct[id] != null);
  const last = rows.at(-1), before = rows.at(-2);
  if (!last || !before || last.day !== coverage.at) return '';
  const delta = Math.round((last.pct[id] - before.pct[id]) * 10) / 10;
  return delta === 0 ? 'same as ' + dayWords(before.day) : `${delta > 0 ? '+' : ''}${delta} pts vs ${dayWords(before.day)}`;
}

function tiles(coverage) {
  return `<div class="tiles">${coverage.layers.map(layer => `<section class="card tile"><span class="muted">${esc(layer.label)}</span><b>${esc(shown(layer.total))}</b>`
    + `${chip(layer.total.state === 'measured' ? `${num(layer.total.covered)} of ${num(layer.total.total)} lines` : layer.total.state === 'n/a' ? 'n/a' : 'not measured tonight', layer.total.state === 'measured' ? 'none' : 'off')}`
    + `${trend(coverage, layer.id) ? ` <span class="muted">${esc(trend(coverage, layer.id))}</span>` : ''}</section>`).join('')}</div>`;
}

function foldersTable(coverage) {
  const head = coverage.layers.map(layer => `<th>${esc(layer.label)}</th>`).join('');
  const rows = coverage.folders.map(row => `<tr><td><code>${esc(row.folder)}</code></td>${coverage.layers.map(layer => {
    const cell = row.cells[layer.id] || {state: 'not measured'};
    return `<td>${cell.state === 'measured' ? `<div class="covcell"><span>${esc(shown(cell))}</span><span class="covbar"><i style="width:${cell.pct}%"></i></span></div>` : chip(esc(cell.state), 'off')}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="scroll"><table><tr><th>Folder</th>${head}</tr>${rows}</table></div>`;
}

function journeysBlock(coverage) {
  const {total, withTest, byLayer, list} = coverage.journeys;
  const words = Object.entries(byLayer).map(([layer, n]) => `${esc(LAYER_WORDS[layer] || layer)} ${num(n)}`).join(' · ');
  const rows = list.slice().sort((a, b) => Number(a.tested) - Number(b.tested) || a.n - b.n).map(item => `<tr><td class="num">${item.n}</td><td>${esc(item.name)}</td><td>${esc(item.priority)}</td>`
    + `<td>${item.tested ? item.layers.map(layer => chip(esc(layer), 'none')).join(' ') : chip('no test', 'warn')}</td></tr>`).join('');
  return `<p class="verdict"><b>${num(withTest)} of ${num(total)} GTM journeys have a test</b> <span class="muted">${words ? `(${words})` : ''}</span></p>`
    + `<details class="covlist"><summary>All ${num(total)} journeys and the layers that test each, untested first</summary><div class="scroll"><table><tr><th class="num">#</th><th>Journey</th><th>Priority</th><th>Tested at</th></tr>${rows}</table></div></details>`;
}

/**
 * The coverage section as HTML. No coverage stored yet -> a short "no data yet" card that says where the numbers come from.
 * @param {object|null} coverage the snapshot's validated `coverage` (admin/coverage-intel.js cleanCoverage)
 * @returns {string} one or more <section class="card"> blocks
 */
export function coverageCard(coverage) {
  if (!coverage) return '<section class="card"><h2>Test coverage</h2><p class="muted">No coverage report read yet. The nightly <code>CI · Coverage report</code> of the public repo makes it; this page picks it up hourly.</p></section>';
  return `<section class="card"><h2>Test coverage · line % per layer</h2><p class="muted">Report only: nothing here fails or blocks a run. Measured nightly on <code>${esc(coverage.sha.slice(0, 7) || 'main')}</code>, ${esc(dayWords(coverage.at))}. “not measured” means that source was missing that night, never 0%.</p>${tiles(coverage)}`
    + `<h3 class="covh">By folder</h3>${foldersTable(coverage)}<h3 class="covh">GTM journeys</h3>${journeysBlock(coverage)}</section>`;
}
