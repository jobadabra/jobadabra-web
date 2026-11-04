// The "Time bombs" section of /admin/testing/integrations (a8, 2 Nov 2026, mac-07's Testing Overview ask): tests that pass today and fail when the clock moves (the public repo's nightly
// clock-moved.yml), and how many files were already red on today's clock. Draws admin/clock-moved-intel.js's part of the snapshot only. REPORT ONLY: no target, no red/green on a number;
// an area whose report is missing that night is "not measured", never 0. Built from the page's own pieces: .tiles/.card.tile, chip(), <details>. Guard: test/unit/admin/clock-moved-card.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {CLOCK_AREAS} from './clock-moved-intel.js';

export const CLOCK_CSS = `${CHIP_STYLE}` + '.clockdetails summary{cursor:pointer;margin:10px 0 6px}.clockdetails .num{text-align:right}';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});

/** The change of the time-bomb total against the night before: "+2 vs 1 Nov", "same as 1 Nov", or '' when there is no earlier night. */
export function bombTrend(clock) {
  const rows = clock.history.filter(row => row.day < clock.at);
  const before = rows.at(-1);
  if (!before) return '';
  const delta = clock.bombs - before.bombs;
  return delta === 0 ? `same as ${dayWords(before.day)}` : `${delta > 0 ? '+' : ''}${delta} vs ${dayWords(before.day)}`;
}

/**
 * The clock-moved section as HTML. Nothing stored yet -> a short "no data yet" card that says where the numbers come from.
 * @param {object|null} clock the snapshot's validated `clockMoved` (admin/clock-moved-intel.js cleanClockMoved)
 * @returns {string} one <section class="card"> block
 */
export function clockMovedCard(clock) {
  if (!clock) return '<section class="card"><h2>Time bombs</h2><p class="muted">No clock-moved report read yet. The nightly <code>CI · Clock moved</code> of the public repo makes it; this page picks it up hourly.</p></section>';
  const trend = bombTrend(clock);
  const areaChips = CLOCK_AREAS.map(area => { const found = clock.areas[area]; return found ? chip(`${esc(area)} ${num(found.bombCount)}`, found.bombCount ? 'warn' : 'good') : chip(`${esc(area)} not measured`, 'off'); }).join(' ');
  const bombs = CLOCK_AREAS.flatMap(area => clock.areas[area]?.bombs || []);
  const rows = bombs.map(item => `<tr><td>${esc(item.area)}</td><td><code>${esc(item.file)}</code></td><td class="num">${num(item.days)}</td><td>${esc(item.why)}</td></tr>`).join('');
  return `<section class="card"><h2>Time bombs · tests that fail when the clock moves</h2><p class="muted">Report only: nothing here fails or blocks a run. Measured nightly on <code>${esc(clock.sha.slice(0, 7) || 'main')}</code>, ${esc(dayWords(clock.at))}.</p>`
    + `<div class="tiles"><section class="card tile"><span class="muted">Time bombs</span><b>${num(clock.bombs)}</b>${chip(clock.bombs ? 'to fix' : 'none found', clock.bombs ? 'warn' : 'good')}${trend ? ` <span class="muted">${esc(trend)}</span>` : ''}</section>`
    + `<section class="card tile"><span class="muted">Red on today's clock</span><b>${num(clock.redToday)}</b>${chip('left out of the count', 'off')}</section></div>`
    + `<p>${areaChips}</p>${bombs.length ? `<details class="clockdetails"><summary>${num(bombs.length)} time bomb${bombs.length === 1 ? '' : 's'}: the file, the days until it fails, the first failure line</summary><div class="scroll"><table><tr><th>Area</th><th>File</th><th class="num">Days</th><th>First failure</th></tr>${rows}</table></div></details>` : ''}</section>`;
}
