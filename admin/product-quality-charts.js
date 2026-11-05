// The chart in each product-quality card (owner, 5 Nov 2026, the approved sketch: "a trend line over 14-30 days" per area). Draws with the admin's one chart module (admin/viz.js): a line per day for
// the four rate areas (a day with no data is a gap, never a 0), grouped columns for Bugs (caught by tests | reached a user). Every chart keeps its numbers behind "Show table" and a tooltip on every day.
// Only draws what admin/product-quality-areas.js built: no reader, no judging. Guard: test/unit/admin/report/product-quality.test.js.
import {esc} from '../shared/html.js';
import {columns, figure, line} from './viz.js';
import {round} from './product-quality.js';

const shown = value => (value == null ? null : round(value, 1));
const text = (value, area) => `${value}${area.unit.trim() === '%' ? '%' : area.unit}`;

// The days behind the chart as a table: exact numbers, the day with no data says so.
const tableOf = (head, rows) => `<div class="tw"><table><tr>${head.map(name => `<th>${esc(name)}</th>`).join('')}</tr>${rows.map(cells => `<tr>${cells.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</table></div>`;

/**
 * The chart of one area, in its figure frame ('' when the area has no series: not measured, or too few installs).
 * @param {object} area an area of admin/product-quality-areas.js (kind 'line' | 'columns', series per day)
 * @returns {string} HTML, trusted (every value inside is escaped by the chart helpers)
 */
export function chartOf(area) {
  if (!area.series?.length) return '';
  if (area.kind === 'columns') {
    const days = area.series.map(point => ({day: point.day, values: [point.found, point.escaped], tip: `${point.day}: ${point.found} caught by tests, ${point.escaped} reached a user`}));
    return figure({chart: columns(days, [{name: 'Caught by tests', tone: 's1'}, {name: 'Reached a user', tone: 's2'}], {whole: true}),
      table: tableOf(['Day', 'Caught by tests', 'Reached a user'], area.series.map(point => [point.day, point.found, point.escaped]))});
  }
  if (!area.series.some(point => point.value != null)) return '';   // every day empty: no frame around a table of "no data"
  const points = area.series.map(point => { const value = shown(point.value); return {day: point.day, value, tip: value == null ? `${point.day}: no data` : `${point.day}: ${text(value, area)}`}; });
  const notes = [area.bar == null ? '' : `Bar: ${area.bar}${area.unit.trim()}`, area.unit.trim() === 's' ? 'Axis in seconds, lower is better' : ''].filter(Boolean);   // the axis labels carry no unit
  const bar = notes.length ? `<div class="vz-sub">${esc(notes.join(' · '))}</div>` : '';
  return figure({chart: line(points, {tone: 's1', percent: area.unit.trim() === '%', name: area.area}) + bar,
    table: tableOf(['Day', area.area], points.map(point => [point.day, point.value == null ? 'no data' : text(point.value, area)]))});
}
