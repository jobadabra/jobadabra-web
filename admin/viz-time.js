// The "over time" forms of the admin chart module (admin/viz.js). Today: grouped columns per day. Pure: rows in, an SVG string out. Guard: test/unit/admin/viz.test.js.
import {esc, tipOf} from './viz-core.js';

/** Round tick values from 0 to a top at or above `max`: a step of 1, 2 or 5 times a power of ten, fractions allowed (daily cents), about `want` ticks.
 * Why (code review, 5 Nov 2026): admin/stats-chart.js niceTicks counts people and never steps below 1, so a $0.30 day drew an axis of $0 and $1. */
export function moneyTicks(max, want = 4) {
  const top = max > 0 ? max : 1, rough = top / want, power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(unit => unit * power).find(candidate => candidate >= rough), ticks = [];
  for (let at = 0, i = 0; i < 20; i++, at = +(i * step).toFixed(6)) { ticks.push(at); if (at >= top) break; }
  return ticks;
}

const W = 720, H = 220, M = {l: 44, r: 6, t: 10, b: 24};

/**
 * Grouped columns over days, a Y axis from 0 with grid lines, a date every few days; the page's one tooltip gives each day's exact numbers.
 * days: [{day: 'YYYY-MM-DD', values: [number | null…], tip}] oldest first; `series`: [{name, tone}] (tone s1…s6), one column per value.
 * A null value is drawn as a dashed hollow column (a number that does not exist yet, never a zero). `unit` prefixes the axis numbers ('$'). '' for no days.
 * Why (owner, 1 Nov 2026, on the Website per-day chart: "doesn't show an Y axis, doesn't show tooltips"): the same three things here: a scale, the numbers, the tooltip.
 */
export function columns(days, series, {unit = '', labelEvery = 5} = {}) {
  if (!days.length) return '';
  const top = Math.max(...days.flatMap(day => day.values.map(value => value || 0)), 0), ticks = moneyTicks(top), max = ticks[ticks.length - 1] || 1;
  const pw = W - M.l - M.r, ph = H - M.t - M.b, y = value => M.t + ph - (ph * value) / max, slot = pw / days.length, each = Math.max(3, (slot * 0.7) / series.length);
  const grid = ticks.map(tick => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" class="vz-grid"/><text x="${M.l - 6}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${esc(unit)}${+tick.toFixed(2)}</text>`).join('');
  const groups = days.map((day, index) => {
    const middle = M.l + slot * index + slot / 2, left = middle - (each * series.length) / 2;
    const columnsOf = day.values.map((value, i) => {
      const x = (left + each * i + 0.5).toFixed(1), width = (each - 1).toFixed(1);
      if (value == null) return `<rect x="${x}" y="${M.t + ph - 14}" width="${width}" height="14" rx="2" fill="none" stroke="var(--${series[i].tone})" stroke-dasharray="2 2"/>`;
      return `<rect x="${x}" y="${y(value).toFixed(1)}" width="${width}" height="${(M.t + ph - y(value)).toFixed(1)}" rx="2" fill="var(--${series[i].tone})"/>`;
    }).join('');
    const label = index % labelEvery === 0 || index === days.length - 1 ? `<text x="${middle.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="vz-axis">${day.day.slice(5).replace('-', '/')}</text>` : '';
    return `<g${tipOf(day.tip)}><rect x="${(middle - slot / 2).toFixed(1)}" y="${M.t}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent"/>${columnsOf}${label}</g>`;
  }).join('');
  const hollow = days.some(day => day.values.includes(null));
  return `<svg class="vz-cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(' and '))} per day">${grid}${groups}</svg>`
    + `<div class="vz-legend">${series.map(s => `<span><i style="background:var(--${s.tone})"></i>${esc(s.name)}</span>`).join('')}${hollow ? '<span><i class="dash"></i>not reported yet</span>' : ''}</div>`;
}
