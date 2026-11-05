// The "Per day" chart of the website admin page (/admin/growth/website): visitors and downloaders per day as grouped columns.
// Why (owner, 1 Nov 2026: "doesn't show an Y axis, doesn't show tooltips. I cannot really see how many visitors per day"): the old columns were
// CSS heights scaled to the busiest day, with no scale, no numbers and only a native `title` (about one second of hover, never on touch). Now: a drawn
// Y axis from 0 with grid lines, the count above every column while there is room, and the page's one floating [data-tip] tooltip for each day.
// Plain SVG string on the admin's dark surface (like shared/scoutingcharts.js); tests: test/unit/admin/stats-chart.test.js.
import {esc} from '../shared/html.js';

const W = 720, H = 230, M = {l: 40, r: 8, t: 14, b: 26};
const COLORS = {visitors: '#f5b54a', downloaders: '#5ec4b6', grid: '#262c33', muted: '#8d949c'};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const count = value => Number(value || 0).toLocaleString('en-US');

/** Round tick values from 0 to a top at or above `max`: a step of 1, 2 or 5 times a power of ten, at most about `want` ticks. */
export function niceTicks(max, want = 4) {
  const top = Math.max(1, Math.ceil(max));
  const rough = Math.max(1, top / want), power = 10 ** Math.floor(Math.log10(rough));   // counts: a whole step, never 0.5
  const step = [1, 2, 5, 10].map(unit => unit * power).find(candidate => candidate >= rough);
  const ticks = [];
  for (let value = 0; value < top + step; value += step) { ticks.push(value); if (value >= top) break; }
  return ticks;
}

/** "Sat 1 Nov" for a YYYY-MM-DD day. */
export function dayWords(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const tipOf = day => `${dayWords(day.day)} · ${count(day.visitors)} ${day.visitors === 1 ? 'visitor' : 'visitors'} · ${count(day.downloads)} ${day.downloads === 1 ? 'downloader' : 'downloaders'}`;

/** Every day from `from` to `to` (YYYY-MM-DD, UTC), a day the query has no row for as zeros.
 * Why (#252, Gitar): report() groups by day, so a quiet day has no row and the columns would sit side by side as if it never happened. */
export function fillDays(perDay, from, to) {
  const byDay = new Map(perDay.map(day => [day.day, day]));
  const days = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.push(byDay.get(day) || {day, visitors: 0, downloads: 0});
  }
  return days;
}

/** perDay = [{day: 'YYYY-MM-DD', visitors, downloads}] oldest first -> the SVG, or '' when there is no day. */
export function perDayChart(perDay) {
  if (!perDay.length) return '';
  const ticks = niceTicks(Math.max(...perDay.map(day => Math.max(day.visitors, day.downloads))));
  const top = ticks[ticks.length - 1];
  const pw = W - M.l - M.r, ph = H - M.t - M.b, slot = pw / perDay.length;
  const y = value => M.t + ph - (value * ph) / top;
  const barW = Math.max(2, Math.min(34, slot * 0.4));
  const labelled = slot >= 38;                                     // a count above each column only while it fits
  const every = Math.ceil(perDay.length / 14);                      // at most ~14 day labels under the axis
  const grid = ticks.map(value => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" stroke="${COLORS.grid}"/>`
    + `<text x="${M.l - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" fill="${COLORS.muted}" font-size="11">${count(value)}</text>`).join('');
  const columns = perDay.map((day, i) => {
    const cx = M.l + slot * i + slot / 2;
    const bar = (value, x, color) => {
      const height = value ? Math.max(2, (value * ph) / top) : 0;
      return (height ? `<rect x="${x.toFixed(1)}" y="${(M.t + ph - height).toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="3" fill="${color}"/>` : '')
        + (labelled ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(M.t + ph - height - 4).toFixed(1)}" text-anchor="middle" fill="${COLORS.muted}" font-size="11">${count(value)}</text>` : '');
    };
    const label = i % every === 0 || i === perDay.length - 1 && (perDay.length - 1) % every >= every / 2
      ? `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${COLORS.muted}" font-size="11">${esc(Number(day.day.slice(8)) === 1 || i === 0 ? dayWords(day.day).slice(4) : String(Number(day.day.slice(8))))}</text>` : '';
    return `<g>${bar(day.visitors, cx - barW - 1, COLORS.visitors)}${bar(day.downloads, cx + 1, COLORS.downloaders)}${label}`
      + `<rect class="hit" x="${(M.l + slot * i).toFixed(1)}" y="${M.t}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent" tabindex="0" data-tip="${esc(tipOf(day))}" aria-label="${esc(tipOf(day))}"/></g>`;
  }).join('');
  const total = perDay.reduce((sum, day) => sum + day.visitors, 0);
  return `<svg class="perday" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitors and downloaders per day, ${perDay.length} days, ${count(total)} visitors in all">${grid}${columns}</svg>`;
}

export const PERDAY_STYLE = `.perday{display:block;width:100%;height:auto;margin-top:8px}.perday .hit:hover,.perday .hit:focus{fill:rgba(255,255,255,.06);outline:none}
#tip{position:fixed;z-index:9;pointer-events:none;background:#f4efe3;color:#0b0d10;font-size:12px;padding:5px 8px;border-radius:6px;max-width:320px;box-shadow:0 4px 14px #0008}`;
