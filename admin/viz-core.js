// The core of the admin's one chart module (admin/viz.js re-exports it): the colours, the style, the "Show table" wrapper every chart sits in, the one tooltip.
// Why (owner, 5 Nov 2026: "find all the sections/tables like this in the entire Admin UI and transform them into a more visual representation. Preferably graphs…
// Nobody reads tables and raw data"; his exception: "Lookup tables stay"): one helper draws every summary, so a page never draws its own SVG and all of them look and read alike.
// Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md. Every chart keeps the original table behind a "Show table" toggle and a tooltip on every mark (exact numbers, twice).
// Colours: the dataviz skill's validated categorical order, stepped for the admin's dark card (#14181d, run through its validator: all checks pass); a light set is defined too
// (it passes with the "labels or a table view" relief), ready for the day the admin has a light theme: not part of this work. Guard: test/unit/admin/viz.test.js.
import {esc} from '../shared/html.js';
import {TOOLTIP, TIP_STYLE} from '../shared/scoutingcharts.js';
import {chip, CHIP_STYLE} from './chip.js';

export {esc};
/** The page's one floating tooltip (markup and script): add it once per page, near the end of the body. Marks carry data-tip. */
export const VIZ_TOOLTIP = TOOLTIP;

/** Attributes that make a mark hoverable and keyboard-focusable: its exact numbers in one line. */
export const tipOf = text => ` tabindex="0" data-tip="${esc(text)}"`;

/** A number as a short word: 1,234 → "1,234"; 12,938,526 → "12.9M". */
export const count = value => Number(value || 0).toLocaleString('en-US');

/**
 * One chart's frame: a line of chips that says the verdict, the chart, and the original table behind "Show table" (closed).
 * `lead`: [[text, tone?]…], `chart`: HTML ('' when there is nothing to draw), `table`: the table the page drew before (kept: exact numbers, sort and search).
 * With no chart the table is shown as it is, never an empty frame.
 */
export function figure({lead = [], chart = '', table = '', label = 'Show table'}) {
  if (!chart) return table;
  return `<div class="vz">${lead.length ? `<p class="vz-lead">${lead.map(([text, tone]) => chip(esc(text), tone)).join(' ')}</p>` : ''}${chart}`
    + (table ? `<details class="vz-more"><summary>${esc(label)}</summary>${table}</details>` : '') + '</div>';
}

/** The CSS of every chart form, once per page (the page's own style block holds it). Colours are variables on .vz; a light set sits under [data-theme=light]. */
export const VIZ_STYLE = `${CHIP_STYLE}${TIP_STYLE}
.vz{--vz-track:#262c33;--vz-line:#262c33;--vz-text:#f4efe3;--vz-muted:#8d949c;--vz-ink:#0b0d10;--vz-link:#f5b54a;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#9085e9;--off:#6b7580;--good:#3fcf82;--warn:#f0b429;--bad:#ff6b6b;container-type:inline-size;margin-top:10px}
:root[data-theme=light] .vz{--vz-track:#e7e5df;--vz-line:#dedcd6;--vz-text:#0b0b0b;--vz-muted:#52514e;--vz-ink:#fff;--vz-link:#8a5a00;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#6250d6;--off:#9a9a94;--good:#0c8a4a;--warn:#b7791f;--bad:#d03b3b}
.vz-lead{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}
/* Why (5 Nov 2026, Speed range shot: the budget tick sat 4 px apart on rows with longer values): the rows share ONE set of columns (subgrid), so every track has the same length and bars compare. */
.vz-bars{display:grid;grid-template-columns:minmax(110px,200px) 1fr auto;column-gap:12px;row-gap:2px}.vz-row{display:grid;grid-template-columns:subgrid;grid-column:1 / -1;align-items:center;padding:5px 4px;border-radius:8px;min-height:36px}
.vz-row:hover,.vz-row:focus{background:rgba(128,128,128,.1);outline:none}
.vz-label{font-size:13.5px;display:flex;flex-direction:column;line-height:1.25;overflow-wrap:anywhere}.vz-label small{font-size:11.5px;color:var(--vz-muted)}
.vz-track{position:relative;display:block;height:12px;background:var(--vz-track);border-radius:6px}.vz-track.thin{height:7px;border-radius:4px}
.vz-bar{position:absolute;left:0;top:0;bottom:0;min-width:2px;border-radius:0 4px 4px 0;background:var(--s1)}
.vz-val{font-variant-numeric:tabular-nums;font-size:13.5px;text-align:right;white-space:nowrap;display:flex;flex-direction:column}.vz-val small{font-size:11px;color:var(--vz-muted)}
.vz-two{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:center}.vz-cap{font-size:10.5px;color:var(--vz-muted)}
.vz-track.stack{display:flex;gap:2px;background:none;height:14px}.vz-part{height:100%;min-width:4px;border-radius:3px}
.vz-split{display:flex;gap:2px;border-radius:8px;overflow:hidden}.vz-split.tall{height:64px}.vz-split:not(.tall){height:14px}
.vz-seg{display:flex;flex-direction:column;justify-content:center;padding:0 8px;min-width:6px;overflow:hidden;color:var(--vz-ink);font-size:12px;line-height:1.25;border-radius:4px}.vz-seg i{font-style:normal;font-variant-numeric:tabular-nums}.vz-seg:focus{outline:2px solid var(--vz-text)}
.vz-legend{display:flex;gap:6px 16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--vz-muted)}.vz-legend span{display:inline-flex;align-items:center;gap:6px}.vz-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}.vz-legend i.dash{background:none;border:1.5px dashed var(--s2)}.vz-legend b{color:var(--vz-text);font-weight:600}
.vz-cap2{margin:14px 0 2px;font-size:12.5px}.vz-whisk{position:absolute;top:3px;bottom:3px;background:color-mix(in srgb,var(--s1) 45%,transparent);border-radius:3px;min-width:3px}.vz-dot{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--s1);box-shadow:0 0 0 2px var(--vz-card,#14181d)}.vz-tick{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:var(--warn)}
.vz-legend i.whisk{width:16px;height:6px;background:color-mix(in srgb,var(--s1) 45%,transparent)}.vz-legend i.dotkey{border-radius:50%;background:var(--s1)}.vz-legend i.tickkey{width:2px;height:12px;background:var(--warn);border-radius:0}
.vz-cols{width:100%;height:auto;display:block}.vz-grid{stroke:var(--vz-line);stroke-width:1}.vz-axis{fill:var(--vz-muted);font-size:10px}.vz-cols g:hover rect:first-child,.vz-cols g:focus rect:first-child{fill:rgba(128,128,128,.14)}.vz-cols g:focus{outline:none}
.vz-more{margin-top:10px;border-top:1px solid var(--vz-line);padding-top:6px}.vz-more>summary{cursor:pointer;color:var(--vz-link);font-size:13px;min-height:40px;display:flex;align-items:center}
.vz-sub{font-size:12.5px;color:var(--vz-muted);margin:12px 0 4px}
@container (max-width:430px){.vz-bars{grid-template-columns:1fr auto;column-gap:10px}.vz-row{row-gap:4px}.vz-row>.vz-track,.vz-row>.vz-two{grid-column:1 / -1;grid-row:2}.vz-row>.vz-val{grid-row:1;grid-column:2}.vz-row>.vz-label{grid-row:1;grid-column:1}.vz-split.tall .vz-seg b{display:none}}`;
