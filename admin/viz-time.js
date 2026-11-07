// The "over time" forms of the admin chart module (admin/viz.js): grouped columns per day, one line per day. Pure: rows in, an SVG string out. Guard: test/unit/admin/viz.test.js.
import {esc, tipOf} from './viz-core.js';

/** Round tick values from 0 to a top at or above `max`: a step of 1, 2 or 5 times a power of ten, fractions allowed (daily cents), about `want` ticks.
 * Why (code review, 5 Nov 2026): admin/stats-chart.js niceTicks counts people and never steps below 1, so a $0.30 day drew an axis of $0 and $1. */
export function moneyTicks(max, want = 4) {
  const top = max > 0 ? max : 1, rough = top / want, power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(unit => unit * power).find(candidate => candidate >= rough), ticks = [];
  for (let at = 0, i = 0; i < 20; i++, at = +(i * step).toFixed(6)) { ticks.push(at); if (at >= top) break; }
  return ticks;
}

/** Whole-number ticks for a count axis (bugs, runs): 0 up to a top at or above `max` (at least 2), a step of 1, 2 or 5 times a power of ten, never a fraction.
 * Why (5 Nov 2026, [ri] product-quality Bugs chart): moneyTicks gave 0, 0.5, 1 for a day with one bug: half a bug. */
export function countTicks(max, want = 4) {
  const top = Math.max(2, Math.ceil(Number.isFinite(max) ? max : 0)), rough = top / want, power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map(unit => unit * power).find(candidate => candidate >= rough)), ticks = [];
  for (let at = 0; ; at += step) { ticks.push(at); if (at >= top) break; }
  return ticks;
}

const W = 720, H = 220, M = {l: 44, r: 6, t: 10, b: 24};

/**
 * Grouped columns over days, a Y axis from 0 with grid lines, a date every few days; the page's one tooltip gives each day's exact numbers.
 * days: [{day: 'YYYY-MM-DD', values: [number | null…], tip}] oldest first; `series`: [{name, tone}] (tone s1…s6), one column per value.
 * A null value is drawn as a dashed hollow column (a number that does not exist yet, never a zero). `unit` prefixes the axis numbers ('$'); `whole`: a count axis with whole-number ticks only; `gapLabel`: what the legend says a hollow column means (a day that will never have a value is not "not reported yet", Gitar on #488). '' for no days.
 * Why (owner, 1 Nov 2026, on the Website per-day chart: "doesn't show an Y axis, doesn't show tooltips"): the same three things here: a scale, the numbers, the tooltip.
 */
export function columns(days, series, {unit = '', labelEvery = 5, whole = false, gapLabel = 'not reported yet'} = {}) {
  if (!days.length) return '';
  const top = Math.max(...days.flatMap(day => day.values.map(value => value || 0)), 0), ticks = whole ? countTicks(top) : moneyTicks(top), max = ticks[ticks.length - 1] || 1;
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
    + `<div class="vz-legend">${series.map(s => `<span><i style="background:var(--${s.tone})"></i>${esc(s.name)}</span>`).join('')}${hollow ? `<span><i class="dash"></i>${esc(gapLabel)}</span>` : ''}</div>`;
}

/**
 * One series as a line with a dot per day; the page's one tooltip gives each day's numbers. points: [{day: 'YYYY-MM-DD', value: number | null, tip}] oldest first.
 * `percent`: the axis is fixed 0-100% (a share of something); else it is a money/count axis from 0; `whole`: whole-number ticks only (jobs, bugs: never half a job, as `columns`). A null value breaks the line: a day where nothing ran is a gap, never 0%.
 * Why (owner, 5 Nov 2026, sketch: "line: green % per kind"; no second axis): a share and a minutes count are two charts, so this draws one series on its own axis.
 */
export function line(points, {tone = 's1', percent = true, name = '', labelEvery = 5, whole = false} = {}) {
  if (!points.some(point => point.value != null)) return '';
  const ticks = percent ? [0, 25, 50, 75, 100] : (whole ? countTicks : moneyTicks)(Math.max(...points.map(point => point.value || 0))), max = ticks[ticks.length - 1] || 1, suffix = percent ? '%' : '';
  const pw = W - M.l - M.r, ph = H - M.t - M.b, y = value => M.t + ph - (ph * value) / max, slot = pw / points.length, x = index => M.l + slot * index + slot / 2;
  const grid = ticks.map(tick => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" class="vz-grid"/><text x="${M.l - 6}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${+tick.toFixed(2)}${suffix}</text>`).join('');
  const runs = [];   // consecutive days with a value; a gap starts a new run
  points.forEach((point, index) => { if (point.value == null) runs.push([]); else { if (!runs.length) runs.push([]); runs[runs.length - 1].push(`${x(index).toFixed(1)},${y(point.value).toFixed(1)}`); } });
  const strokes = runs.filter(run => run.length > 1).map(run => `<polyline points="${run.join(' ')}" fill="none" stroke="var(--${tone})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const dots = points.map((point, index) => `<g${tipOf(point.tip)}><rect x="${(x(index) - slot / 2).toFixed(1)}" y="${M.t}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent"/>`
    + (point.value == null ? '' : `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3.5" fill="var(--${tone})" stroke="var(--vz-card,#14181d)" stroke-width="2"/>`)
    + (index % labelEvery === 0 || index === points.length - 1 ? `<text x="${x(index).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="vz-axis">${points[index].day.slice(5).replace('-', '/')}</text>` : '') + '</g>').join('');
  return `<svg class="vz-cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} per day">${grid}${strokes}${dots}</svg>`;
}
