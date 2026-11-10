// Stacked columns over runs (the Finish line's "people at the line, run by run"): each run is one column of states that add up to at most `top`, the top of the chart is the finish line. Pure: rows in, an SVG string out.
// Why (10 Nov 2026, owner's Finish line picture): `columns` groups values side by side, which cannot show "18 people split into four states"; a hollow (dashed) column is a by-hand run. Guard: test/unit/admin/viz-stack.test.js.
import {esc, tipOf} from './viz-core.js';

const W = 720, H = 220, BOX = {l: 44, r: 6, t: 10, b: 24};

/**
 * @param {{day: string, hand?: boolean, values: number[], tip: string}[]} runs oldest first, `values` one count per series (null counts as 0)
 * @param {{name: string, tone: string}[]} series bottom to top; tone s1..s6 or 'off'
 * @param {{top: number, labelEvery?: number}} options `top`: the count the chart tops out at (the finish line, drawn dashed)
 */
export function stacked(runs, series, {top, labelEvery = Math.max(1, Math.ceil(runs.length / 7))}) {
  if (!runs.length) return '';
  const pw = W - BOX.l - BOX.r, ph = H - BOX.t - BOX.b, y = value => BOX.t + ph - (ph * value) / top, slot = pw / runs.length, ticks = [0, Math.round(top / 3), Math.round((2 * top) / 3), top];
  const grid = ticks.map(tick => `<line x1="${BOX.l}" x2="${W - BOX.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" class="vz-grid"/><text x="${BOX.l - 6}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${tick}</text>`).join('');
  const line = `<line x1="${BOX.l}" x2="${W - BOX.r}" y1="${y(top)}" y2="${y(top)}" stroke="var(--vz-text)" stroke-dasharray="5 4" opacity=".8"/>`;
  const cols = runs.map((run, index) => {
    const x = BOX.l + slot * index + slot * 0.18, width = slot * 0.64;
    let at = 0;
    const parts = run.values.map((value, i) => {
      if (!value) return '';
      const top2 = y(at + value), height = y(at) - top2, tone = `var(--${series[i].tone})`;
      at += value;
      return run.hand ? `<rect x="${x.toFixed(1)}" y="${top2.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="none" stroke="${tone}" stroke-width="2" stroke-dasharray="3 2"/>`
        : `<rect x="${x.toFixed(1)}" y="${top2.toFixed(1)}" width="${width.toFixed(1)}" height="${Math.max(0, height - 1).toFixed(1)}" rx="2" fill="${tone}"/>`;
    }).join('');
    const label = index % labelEvery === 0 || index === runs.length - 1 ? `<text x="${(x + width / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="vz-axis">${esc(run.day.slice(5).replace('-', '/'))}</text>` : '';
    return `<g${tipOf(run.tip)}><rect x="${(BOX.l + slot * index).toFixed(1)}" y="${BOX.t}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent"/>${parts}${label}</g>`;
  }).join('');
  return `<svg class="vz-cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(item => item.name).join(', '))} per run">${grid}${line}${cols}</svg><div class="vz-legend">${series.map(item => `<span><i style="background:var(--${item.tone})"></i>${esc(item.name)}</span>`).join('')}</div>`;
}
