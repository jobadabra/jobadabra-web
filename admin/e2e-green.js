// The share of finished e2e runs that ended green, per day and run kind (owner, 31 Oct 2026: "Do we have such a graph that shows the trend of our e2e green/stability?"; the coordinator
// had to measure main's green share from GitHub by hand). Built only from the snapshot rows the page already keeps (snapshot.days: day, kind, greens, reds); cancelled runs are not
// finished runs, so they are in neither the numerator nor the denominator. The snapshot stores whole UTC days, never hours: "last 24 h" is read as today + yesterday.
// Drawn by admin/e2e-page.js (greenCard). Guard: test/unit/admin/e2e/e2e-green.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {legend} from './day-bars.js';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = day => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const dayKey = (now, back) => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10);

// One line per run kind that matters. Colours: categorical slots 1-4 of the dataviz palette, dark steps (validated on the admin surface).
export const GREEN_SERIES = [
  {id: 'after-merge', label: 'Main after merge', kinds: ['after-merge'], color: '#3987e5'},
  {id: 'beta', label: 'Beta', kinds: ['beta'], color: '#d95926'},
  {id: 'pr', label: 'PR', kinds: ['pr'], color: '#199e70'},
  {id: 'nightly', label: 'Nightly / scheduled', kinds: ['nightly', 'scheduled'], color: '#c98500'},
];
const FLAT_POINTS = 1;   // a move under one point is "flat"

/** The lines for a run-kind filter: 'all' = the four above; one kind = just that kind (its name from `kindName`). */
export function seriesFor(kind = 'all', kindName = id => id) {
  if (kind === 'all') return GREEN_SERIES;
  return [GREEN_SERIES.find(series => series.kinds.length === 1 && series.kinds[0] === kind) || {id: kind, label: kindName(kind), kinds: [kind], color: '#3987e5'}];
}

/** Finished runs and greens of `kinds` on the given days (a Set of YYYY-MM-DD). share is null when no run finished. */
export function shareOf(days, kinds, keys) {
  let runs = 0, greens = 0;
  for (const row of days || []) {
    if (!keys.has(row.day) || !kinds.includes(row.kind || 'beta')) continue;
    const green = Number(row.greens) || 0;
    greens += green; runs += green + (Number(row.reds) || 0);
  }
  return {runs, greens, share: runs ? greens / runs : null};
}

/** Per series, one point per day from the oldest to today: {day, runs, greens, share}. Days with no finished run have share null (a gap, never 0%). */
export function greenPerDay(snapshot, {kind = 'all', days = 7, now = new Date(), kindName, lines = null} = {}) {
  const keys = Array.from({length: days}, (_, i) => dayKey(now, days - 1 - i));
  const series = (lines || seriesFor(kind, kindName)).map(item => ({...item, points: keys.map(day => ({day, ...shareOf(snapshot?.days, item.kinds, new Set([day]))}))}));
  return {keys, series};
}

/** The last 2 days against the 7 days before them, for the filter's headline kind (main after merge for 'all'). delta is in whole points; trend up|down|flat, or null when either side has no run. */
export function greenTrend(snapshot, {kind = 'all', now = new Date(), kindName, headline = null} = {}) {
  const series = headline || (kind === 'all' ? GREEN_SERIES[0] : seriesFor(kind, kindName)[0]);
  const recent = shareOf(snapshot?.days, series.kinds, new Set([dayKey(now, 0), dayKey(now, 1)]));
  const before = shareOf(snapshot?.days, series.kinds, new Set(Array.from({length: 7}, (_, i) => dayKey(now, i + 2))));
  const delta = recent.share === null || before.share === null ? null : Math.round((recent.share - before.share) * 100);
  return {series, recent, before, delta, trend: delta === null ? null : delta >= FLAT_POINTS ? 'up' : delta <= -FLAT_POINTS ? 'down' : 'flat'};
}

const percent = share => (share === null ? '–' : `${Math.round(share * 100)}%`);
const runsOf = n => `${n} ${n === 1 ? 'run' : 'runs'}`;
const pointText = (series, point) => `${series.label} · ${dayWords(point.day)}: ${point.share === null ? 'no finished run' : `${percent(point.share)} green (${point.greens} of ${runsOf(point.runs)})`}`;

export const GREEN_CSS = `${CHIP_STYLE}.gtiles{margin-bottom:6px}.gtiles .tile b{display:flex;align-items:center;gap:10px}
.gchart{width:100%;height:auto;display:block;margin-top:6px}.gchart text{fill:var(--muted,#8d949c);font-size:11px}.gchart .grid{stroke:var(--line,#262c33);stroke-width:1}
.gchart polyline{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.gchart circle.dot{stroke:var(--card,#14181d);stroke-width:2}.gchart circle.hit{fill:transparent;stroke:none}.gchart circle.hit:hover{fill:rgba(255,255,255,.12)}
.gnum td{white-space:nowrap}.gkey .key{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}`;

function trendTile(trend, kindLabel) {
  const {recent, before, delta} = trend;
  const verdict = trend.trend === 'up' ? chip(`▲ +${delta} pts`, 'good') : trend.trend === 'down' ? chip(`▼ ${delta} pts`, 'bad') : trend.trend === 'flat' ? chip('► flat', 'off') : chip('no comparison', 'off');
  return `<section class="card tile"><span class="muted">${esc(kindLabel)} · last 2 days green</span><b>${percent(recent.share)}${verdict}</b><span class="muted">${recent.greens} of ${runsOf(recent.runs)} finished (today + yesterday, UTC)</span></section>
<section class="card tile"><span class="muted">${esc(kindLabel)} · the 7 days before</span><b>${percent(before.share)}</b><span class="muted">${before.greens} of ${runsOf(before.runs)} finished</span></section>`;
}

const W = 720, H = 190, LEFT = 38, RIGHT = 12, TOP = 10, BOTTOM = 26;
function chart(data, what = 'e2e') {
  const n = data.keys.length, x = i => LEFT + (n === 1 ? 0 : (i * (W - LEFT - RIGHT)) / (n - 1)), y = share => TOP + (1 - share) * (H - TOP - BOTTOM);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(g => `<line class="grid" x1="${LEFT}" x2="${W - RIGHT}" y1="${y(g)}" y2="${y(g)}"/><text x="${LEFT - 6}" y="${y(g) + 4}" text-anchor="end">${g * 100}%</text>`).join('');
  const step = n > 10 ? 5 : 1, ticks = data.keys.map((day, i) => ((n - 1 - i) % step === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${dayWords(day)}</text>` : '')).join('');
  const lines = data.series.map(series => {
    const runs = [];   // a day with no finished run breaks the line: no 0% where nothing ran
    series.points.forEach((point, i) => { if (point.share === null) runs.push([]); else { if (!runs.length) runs.push([]); runs[runs.length - 1].push(`${x(i).toFixed(1)},${y(point.share).toFixed(1)}`); } });
    const segments = runs.filter(run => run.length > 1).map(run => `<polyline points="${run.join(' ')}" stroke="${esc(series.color)}"/>`).join('');
    const dots = series.points.map((point, i) => (point.share === null ? '' : `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(point.share).toFixed(1)}" r="4" fill="${esc(series.color)}"><title>${esc(pointText(series, point))}</title></circle>`
      + `<circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(point.share).toFixed(1)}" r="10"><title>${esc(pointText(series, point))}</title></circle>`)).join('');
    return `${segments}${dots}`;
  }).join('');
  return `<svg class="gchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of finished ${what} runs that ended green, per day, from ${esc(dayWords(data.keys[0]))} to ${esc(dayWords(data.keys[n - 1]))}">${grid}${ticks}${lines}</svg>`;
}

function numbers(data) {
  const head = data.series.map(series => `<th class="num">${esc(series.label)}</th>`).join('');
  const rows = data.keys.slice().reverse().map((day, k) => `<tr><td>${esc(dayWords(day))}</td>${data.series.map(series => { const point = series.points[data.keys.length - 1 - k];
    return `<td class="num">${point.share === null ? '<span class="muted">–</span>' : `${percent(point.share)} <span class="muted">${point.greens}/${point.runs}</span>`}</td>`; }).join('')}</tr>`).join('');
  return `<details class="gnum"><summary class="muted">Numbers per day (green / finished runs)</summary><div class="scroll"><table><tr><th>Day</th>${head}</tr>${rows}</table></div></details>`;
}

/** The "Green runs per day" card: the 2-days-vs-7-days tiles, one line per run kind, a legend and the numbers. `days` = the page's range in days.
 *  `lines` / `headline` (series: {id, label, kinds, color}) let /admin/testing/integrations draw one line per test layer with the same chart; `what` names the runs. */
export function greenCard(snapshot, {kind = 'all', days = 7, now = new Date(), kindName = id => id, scopeName = '', lines = null, headline = null, what = 'e2e'} = {}) {
  const data = greenPerDay(snapshot, {kind, days, now, kindName, lines}), trend = greenTrend(snapshot, {kind, now, kindName, headline});
  const any = data.series.some(series => series.points.some(point => point.share !== null));
  return `<section class="card"><h2>Green runs per day · ${esc(scopeName)}</h2>
<div class="tiles gtiles">${trendTile(trend, trend.series.label)}</div>
${any ? `${data.series.length > 1 ? `<div class="gkey">${legend(data.series)}</div>` : ''}${chart(data, what)}${numbers(data)}` : '<p class="muted">No finished run in this range.</p>'}
<p class="muted">Share of finished runs that ended green; cancelled runs are left out. Hover a dot for the day's run count. The snapshot keeps whole days, so "last 2 days" is today and yesterday (UTC).</p></section>`;
}
