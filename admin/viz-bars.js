// The bar forms of the admin chart module (admin/viz.js): ranked bars, bars against a limit (meters), one stacked row per item, and a segmented split of a whole.
// Pure: items in, HTML out. Each mark carries its exact numbers in data-tip. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md. Guard: test/unit/admin/viz.test.js.
import {esc, tipOf} from './viz-core.js';
import {toneOf} from './ai-limits-card.js';

/**
 * Ranked horizontal bars, one hue, longest first as given. items: [{label, hint?, value, text, tip?}]; `value` sets the length, `text` is what is printed at the end,
 * `hint` a muted line under the label, `tip` the tooltip (default "label · text"). `max` fixes the scale (default: the largest value). '' for no items.
 */
export function bars(items, {max} = {}) {
  if (!items.length) return '';
  const top = max || Math.max(...items.map(item => item.value), 0) || 1;
  return `<div class="vz-bars">${items.map(item => `<div class="vz-row"${tipOf(item.tip || `${item.label} · ${item.text}`)}>`
    + `<span class="vz-label">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</span>`
    + `<span class="vz-track"><span class="vz-bar" style="width:${Math.min(100, 100 * Math.max(0, item.value) / top).toFixed(1)}%"></span></span>`
    + `<span class="vz-val">${esc(item.text)}</span></div>`).join('')}</div>`;
}

/** One thin bar filled to `pct` of its limit: blue, amber from 70%, red from 90% (the subscription rings' own thresholds, admin/ai-limits-card.js). */
export function meter(pct) {
  const value = Number(pct) || 0, tone = toneOf(value), colour = tone === 'good' ? 's1' : tone;   // a missing figure is 0, never "NaN%" drawn as plenty left
  return `<span class="vz-track thin"><span class="vz-bar" style="width:${Math.min(100, Math.max(0, value)).toFixed(1)}%;background:var(--${colour})"></span></span>`;
}

/** Rows of bars against a limit. items: [{label, text, sub?, meters: [{caption, pct}], tip}]; `text` is printed at the end, `sub` a muted line under it. */
export function meters(items) {
  if (!items.length) return '';
  return `<div class="vz-bars">${items.map(item => `<div class="vz-row"${tipOf(item.tip)}><span class="vz-label">${esc(item.label)}</span>`
    + `<span class="vz-two">${item.meters.map(m => `<span class="vz-cap">${esc(m.caption)}</span>${meter(m.pct)}`).join('')}</span>`
    + `<span class="vz-val">${esc(item.text)}${item.sub ? `<small>${esc(item.sub)}</small>` : ''}</span></div>`).join('')}</div>`;
}

/**
 * One stacked bar per row: each row splits into parts of one tone each. rows: [{label, text, sub?, parts: [{value, tone}], tip}], tone one of good|warn|bad|s1…s6.
 * `legend`: [[tone, words]…] printed once under the rows (a status always has an icon and a word, never colour alone).
 */
export function stacks(rows, legend = []) {
  if (!rows.length) return '';
  return `<div class="vz-bars">${rows.map(row => `<div class="vz-row"${tipOf(row.tip)}><span class="vz-label">${esc(row.label)}</span>`
    + (row.parts.some(part => part.value > 0)   // an engine with no call today: the empty track, not a blank that looks broken
      ? `<span class="vz-track stack">${row.parts.filter(part => part.value > 0).map(part => `<span class="vz-part" style="flex:${part.value};background:var(--${part.tone})"></span>`).join('')}</span>`
      : '<span class="vz-track"></span>')
    + `<span class="vz-val">${esc(row.text)}${row.sub ? `<small>${esc(row.sub)}</small>` : ''}</span></div>`).join('')}</div>`
    + (legend.length ? `<div class="vz-legend">${legend.map(([tone, words]) => `<span><i style="background:var(--${tone})"></i>${esc(words)}</span>`).join('')}</div>` : '');
}

/**
 * One whole split into parts: a segmented bar plus a legend of names. parts: [{label, value, text}] in the order given (colours s1…s6 in that fixed order; at most 6,
 * the caller folds a tail into "Other"). `tall`: a big bar with the name and amount on each segment wide enough to hold them; else a thin bar beside figures listed elsewhere.
 */
export function split(parts, {tall = true} = {}) {
  const shown = parts.filter(part => part.value > 0), sum = shown.reduce((total, part) => total + part.value, 0);
  if (!sum) return '';
  return `<div class="vz-split${tall ? ' tall' : ''}" role="img" aria-label="${esc(shown.map(part => `${part.label} ${part.text}`).join(', '))}">${shown.map((part, index) => {
    const share = Math.round(100 * part.value / sum), roomy = tall && part.value / sum > 0.14;
    return `<span class="vz-seg" style="flex:${part.value};background:var(--s${index + 1})"${tipOf(`${part.label} · ${part.text} · ${share}%`)}>${roomy ? `<b>${esc(part.label)}</b><i>${esc(part.text)}</i>` : ''}</span>`;
  }).join('')}</div>`
    + `<div class="vz-legend">${shown.map((part, index) => `<span><i style="background:var(--s${index + 1})"></i>${esc(part.label)} <b>${esc(part.text)}</b></span>`).join('')}</div>`;
}
