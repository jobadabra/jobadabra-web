// Testing → Overview: "Bugs found vs what they cost", one row per way we find bugs (owner, 7 Nov 2026: "can we measure the efficiency between these 2 testing methods? How many bugs each ones
// is catching. How many tokens/times each one is using compared to the bug caught, basically to the outcome?"). Nothing is counted here that a page does not already count:
//   real / false  = the self-healing snapshot's per-detector row (desktop/e2e/lib/selfheal-stats.mjs classify), the same rows as the Self-heal page and Report only;
//   tokens        = the AI broker's tally per workflow (admin/ai-workflow-tokens.js workflowRows);
//   CI minutes    = the schedules snapshot's weeklyMin per workflow (ops/jobs/schedules-snapshot.mjs).
// All three agree on 7 days, so the table is 7 days and the daily trend is the same 7-day count at each of the last 14 snapshot days (admin/report-only-finders.js realByDay).
// Pure: rows in, rows or HTML out. Guard: test/unit/admin/testing-methods-cost.test.js.
import {esc} from '../shared/html.js';
import {chip} from './chip.js';
import {columns, figure} from './viz.js';
import {realByDay} from './report-only-finders.js';
import {workflowRows} from './ai-workflow-tokens.js';

export const WINDOW_DAYS = 7;
const DAY = 86400000;

// Why (7 Nov 2026, owner): each method is read from ONE detector row (`detector` = the label in selfheal-stats DETECTORS; 'other' = an issue with no source label, which is what a person files)
// and costs ONE list of workflows (`wf`), written down here once so a number can be traced. `rides`: the method has no run of its own, it reads the results of this workflow, whose
// tokens and minutes are counted under the method that owns it (never twice): layout checks run inside ui-findings.yml next to the AI screenshot review; failed test steps are read
// from the e2e runs that also prove the journeys. `free`: no AI and no CI run to price (a person's report), so there is nothing to divide.
export const METHOD_COST = [
  {id: 'persona', icon: '🤖', title: 'AI persona', detector: 'AI user agent', wf: ['ai-user-agents.yml']},
  {id: 'code-review', icon: '🔍', title: 'AI code review', detector: 'AI code review', wf: ['code-review.yml']},
  {id: 'screenshots', icon: '🖼️', title: 'AI screenshot review', detector: 'AI screenshot review', wf: ['ui-findings.yml']},
  {id: 'layout', icon: '📐', title: 'Layout checks', detector: 'Layout and DOM checks', wf: [], rides: 'ui-findings.yml'},
  {id: 'steps', icon: '🧪', title: 'Failed test steps', detector: 'Failed test steps', wf: [], rides: 'e2e.yml'},
  {id: 'people', icon: '🧑', title: 'People', detector: 'other', wf: [], free: true},
];

const sum = (list, pick) => list.reduce((total, item) => total + (pick(item) || 0), 0);
const dayOf = date => date.toISOString().slice(0, 10);

/** The broker tally cut to the last `n` UTC days up to `now` (same shape), so tokens and minutes cover the same week. */
export function lastDays(tally, now, n = WINDOW_DAYS) {
  if (!tally) return null;
  const from = dayOf(new Date(now.getTime() - (n - 1) * DAY)), days = {};
  for (const [day, workflows] of Object.entries(tally.days || {})) if (day >= from && day <= dayOf(now)) days[day] = workflows;
  return {...tally, days};
}

/** A cost divided by real bugs: a number, '∞' (a cost and nothing found: Infinity), or null when the cost is unknown or zero with nothing found. */
const perBug = (cost, real) => (cost == null ? null : real > 0 ? cost / real : cost > 0 ? Infinity : null);

/**
 * One row per method of METHOD_COST: {id, icon, title, filed, real, falsePositive, precision (0..1 | null), tokens | null, minutes | null, tokensPerBug, minutesPerBug, rides, free, warn, why}.
 * `healing` = the newest self-healing snapshot, `tally` = the broker's tally (null: not readable: tokens null), `repo` = the repo the workflows are in ("owner/name"), `minutesOf(file)` = a workflow's minutes in 7 days or null when the schedules snapshot does not list it.
 * Real = fixed + queued; false = false positive + test or harness mistake (the precision's own definition); duplicates and not-yet-judged ones are in `filed` only.
 * `warn` = a method that found no real bug: shown as a warning with "∞ per bug" when it cost anything, never hidden.
 */
export function costRows({healing, tally, repo = '', minutesOf = () => null, now = new Date(), methods = METHOD_COST}) {
  const byDetector = healing?.periods?.last7?.byDetector;
  if (!Array.isArray(byDetector)) return [];
  const week = lastDays(tally, now), spent = week ? new Map(workflowRows(week, dayOf(now)).map(row => [row.name, row.tokens])) : null;
  const prefix = repo ? `${repo.split('/').pop()}/` : '';   // Why (7 Nov 2026, at): the broker names a workflow "<repo>/<file>" (test/unit/admin/ai/ai-workflow-tokens.test.js), not the bare file
  return methods.map(method => {
    const row = byDetector.find(item => item.detector === method.detector) || {};
    const real = (Number(row.fixed) || 0) + (Number(row.queued) || 0), falsePositive = (Number(row.falsePositive) || 0) + (Number(row.harness) || 0);
    const priced = !method.free && !method.rides && method.wf.length > 0;
    const tokens = priced && spent ? sum(method.wf, file => spent.get(`${prefix}${file}`) || 0) : null;
    const known = method.wf.map(minutesOf);
    const minutes = priced && known.every(value => value != null) ? sum(known, value => value) : null;
    return {id: method.id, icon: method.icon, title: method.title, filed: Number(row.filed) || 0, real, falsePositive, precision: real + falsePositive ? real / (real + falsePositive) : null,
      tokens, minutes, tokensPerBug: perBug(tokens, real), minutesPerBug: perBug(minutes, real), rides: method.rides || '', free: Boolean(method.free), warn: real === 0 && !method.free};
  });
}

/** The trend: `days` (oldest first) -> [{day, values: [real bugs in the 7 days up to that day, per method | null], tip}] for the methods' columns; null = no snapshot that day. */
export function trendDays(snapshots, days, methods = METHOD_COST) {
  const series = methods.map(method => realByDay(snapshots, days, method.detector).series);
  return days.map((day, i) => ({day, values: series.map(one => one[i].value),
    tip: `${day} · real bugs in the 7 days up to it: ${methods.map((method, at) => `${method.title} ${series[at][i].value ?? 'no snapshot'}`).join(' · ')}`}));
}

const tokensWord = value => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(Math.round(value)));
const minutesWord = value => (value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
const cell = (value, word) => (value == null ? '<td class="n muted">—</td>' : `<td class="n">${esc(word(value))}</td>`);
/** "∞" (warn chip) when a method cost something and found nothing; a number; '—' when unknown. */
const perBugCell = (value, word) => (value === Infinity ? `<td class="n">${chip('∞ per bug', 'bad')}</td>` : cell(value, word));
const precisionCell = row => (row.precision == null ? '<td class="n muted">—</td>'
  : `<td class="n"><span class="mc-bar" title="${row.real} real of ${row.real + row.falsePositive} judged"><i style="width:${Math.round(row.precision * 100)}%"></i></span> ${Math.round(row.precision * 100)}%</td>`);

const rowHtml = row => `<tr><td style="white-space:nowrap">${row.icon} ${esc(row.title)}${row.warn ? ` ${chip('▲ no real bug', 'warn')}` : ''}${row.rides ? ` <span class="muted small" title="no run of its own">rides ${esc(row.rides)}</span>` : ''}</td>
<td class="n"><b>${row.real}</b></td><td class="n">${row.falsePositive}</td>${precisionCell(row)}${cell(row.tokens, tokensWord)}${cell(row.minutes, minutesWord)}${perBugCell(row.tokensPerBug, tokensWord)}${perBugCell(row.minutesPerBug, minutesWord)}</tr>`;

export const COST_STYLE = `.mcost{background:#14181d;border:1px solid #262c33;border-radius:14px;padding:12px 16px;margin:12px 0}.mcost h2{margin:0 0 2px;font-size:17px}.mcost table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.mcost th{text-align:right;font-weight:600;color:#8d949c;font-size:12px;padding:4px 8px}.mcost th:first-child,.mcost td:first-child{text-align:left}.mcost td{padding:6px 8px;border-top:1px solid #262c33}.mcost td.n{text-align:right;white-space:nowrap}
.mc-bar{display:inline-block;width:46px;height:8px;border-radius:4px;background:#262c33;vertical-align:middle;overflow:hidden}.mc-bar i{display:block;height:8px;background:#199e70}.mcost .small{font-size:12px}`;

/**
 * The card. `rows` = costRows(...) ([] draws a one-line "no data"), `trend` = trendDays(...). The table is the verdict (a row that found nothing is a warning chip, "∞ per bug" when it cost something);
 * the chart under it is the daily trend, a whole-number axis from 0.
 */
export function costCard(rows, trend = []) {
  const head = '<h2>⚖️ Bugs found vs what they cost</h2>';
  if (!rows.length) return `<section class="mcost" id="methods-cost">${head}<p class="muted small" style="margin:6px 0 0">No self-healing snapshot with a 7-day view is stored yet, so there is nothing to count.</p></section>`;
  const chart = trend.some(day => day.values.some(value => value != null))
    ? `<p class="muted small" style="margin:12px 0 0">Real bugs in the 7 days up to each day</p>${figure({chart: columns(trend, METHOD_COST.map((method, i) => ({name: method.title, tone: `s${i + 1}`})), {whole: true, labelEvery: 3})})}` : '';   // figure: the .vz wrapper holds the series colours
  return `<section class="mcost" id="methods-cost">${head}<p class="muted small" style="margin:0">Last 7 days · real = fixed or confirmed, false = false alarm or test mistake · tokens: the AI broker's count per workflow · minutes: that workflow's run time · a method that reads another's run shows what it rides on, its cost is counted there</p>
<table><tr><th>Method</th><th>Real</th><th>False</th><th>Precision</th><th>Tokens</th><th>CI min</th><th>Tokens / real bug</th><th>Min / real bug</th></tr>
${rows.map(rowHtml).join('\n')}</table>${chart}</section>`;
}
