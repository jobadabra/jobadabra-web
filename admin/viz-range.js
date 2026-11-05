// The range form of the admin chart module (admin/viz.js): per item a whisker from a low to a high value, a dot at the middle, one shared tick for a limit.
// Pure: items in, HTML out. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md. Guard: test/unit/admin/viz.test.js.
import {esc, tipOf} from './viz-core.js';

/**
 * items: [{label, hint?, low, mid, high, text, tip}] on one scale from 0; `text` is printed at the end. `limit`: {value, words} draws a vertical tick on every row (the budget).
 * '' for no items. Why (owner, 5 Nov 2026, sketch: "range: p25-p95 whisker, median dot, budget tick"): a median alone hides how wide a suite's time swings.
 */
export function ranges(items, {limit} = {}) {
  if (!items.length) return '';
  const top = Math.max(...items.map(item => item.high), limit ? limit.value : 0, 1), at = value => `${Math.min(100, 100 * Math.max(0, value) / top).toFixed(1)}%`;
  return `<div class="vz-bars">${items.map(item => `<div class="vz-row"${tipOf(item.tip)}><span class="vz-label">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</span>`
    + `<span class="vz-track"><span class="vz-whisk" style="left:${at(item.low)};width:calc(${at(item.high)} - ${at(item.low)})"></span><span class="vz-dot" style="left:${at(item.mid)}"></span>${limit ? `<span class="vz-tick" style="left:${at(limit.value)}"></span>` : ''}</span>`
    + `<span class="vz-val">${esc(item.text)}</span></div>`).join('')}</div>`
    + `<div class="vz-legend"><span><i class="whisk"></i>p25 to p95</span><span><i class="dotkey"></i>median</span>${limit ? `<span><i class="tickkey"></i>${esc(limit.words)}</span>` : ''}</div>`;
}
