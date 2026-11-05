// The charts of /admin/ai/costs (owner, 5 Nov 2026: By job, By workspace, By API key, By group, By day and the Free AI / Pro AI tables "into a more visual representation. Preferably graphs").
// Each takes the page's figures and the table it drew before, and returns one figure: the chart with that table behind "Show table". Drawn with admin/viz.js only.
// Pure; guard: test/unit/admin/jobcost-charts.test.js. The numbers in the tooltips are exactly the table's.
import {bars, columns, figure, meters, split} from './viz.js';

const money = n => `$${(Number(n) || 0).toFixed(2)}`;

/** The share of each provider (Claude, OpenAI) as one thin segmented bar. `s` is summarize()'s answer, `names` PROVIDERS (id → label). */
export function providerFigure(s, names, table) {
  const parts = s.providers.map(p => ({label: names[p.id] || p.id, value: p.usd, text: `${money(p.usd)} · ${s.total ? Math.round(100 * p.usd / s.total) : 0}%`}));
  return figure({chart: s.total ? split(parts, {tall: false}) : '', table});
}

/** The groups of jobs as one tall segmented bar, biggest first; the tail past 5 groups folds into "Other" (a part-to-whole carries at most 6 colours). `groups` is {name: usd}. */
export function groupFigure(groups, table) {
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]), head = sorted.slice(0, 5), tail = sorted.slice(5).reduce((sum, [, usd]) => sum + usd, 0);
  const parts = [...head, ...(tail > 0 ? [['Other', tail]] : [])].map(([label, usd]) => ({label, value: usd, text: money(usd)}));
  const top = sorted[0], sum = sorted.reduce((total, [, usd]) => total + usd, 0);
  return figure({lead: top && sum ? [[`${top[0]} is ${Math.round(100 * top[1] / sum)}% of the spend`]] : [], chart: split(parts), table});
}

/** Jobs and Billed per day as paired columns, oldest first; a day with no bill yet is a hollow column. `s.days` is newest first. */
export function dayFigure(s, table) {
  const days = s.days.slice(0, 30).reverse().map(d => ({day: d.day, values: [d.tracked, d.billed],
    tip: `${d.day} · Jobs ${money(d.tracked)} · Billed ${d.billed === null ? 'not reported yet' : money(d.billed)}`}));
  const lead = [];
  // Why (Gitar on #384): s.covered follows the selected range, but this chart always draws the last 30 days, so the chip is worked out from the days drawn, both sides present.
  const both = s.days.slice(0, 30).filter(d => d.billed !== null && d.tracked > 0), billedSum = both.reduce((n, d) => n + d.billed, 0);
  const covered = billedSum > 0 ? Math.round(100 * both.reduce((n, d) => n + d.tracked, 0) / billedSum) : null;
  if (covered !== null) lead.push([`over 30 days the jobs explain ${covered}% of the bill`, covered >= 80 ? 'good' : 'warn']);
  const waiting = days.filter(d => d.values[1] === null).length;
  if (waiting) lead.push([`${waiting} day${waiting === 1 ? '' : 's'} with no bill yet`, 'off']);
  return figure({lead, chart: columns(days, [{name: 'Jobs (reported by the jobs)', tone: 's1'}, {name: "Billed (Anthropic's report)", tone: 's2'}], {unit: '$'}), table});
}

/** API keys or workspaces (`noun`) as ranked bars of their range cost; today and last use in the tooltip. `rows` is byKey()'s answer. */
export function keyFigure(rows, noun, table) {
  const share = rows.reduce((sum, row) => sum + row.range, 0), top = rows[0];
  return figure({
    lead: top && share ? [[`${rows.length} ${noun}`], [`${top.key} is ${Math.round(100 * top.range / share)}%`]] : [],
    chart: bars(rows.map(row => ({label: row.key, hint: `today ${money(row.today)}`, value: row.range, text: money(row.range), tip: `${row.key} · ${money(row.range)} in the range · today ${money(row.today)} · last used ${row.last}`}))), table,
  });
}

/** Every job as ranked bars of its cost; runs, calls, cost per run and the last run in the tooltip. `names` is JOBS (id → [label, group]). */
export function jobFigure(s, names, table) {
  const items = s.jobs.map(job => {
    const [label, group] = names[job.job] || [job.job, 'Other'];
    return {label, hint: group, value: job.usd, text: money(job.usd),
      tip: `${label} (${group}) · ${money(job.usd)} · ${job.runs} runs · ${job.calls} calls · $${(job.runs ? job.usd / job.runs : 0).toFixed(3)} per run · last ${job.last.slice(0, 16).replace('T', ' ')} UTC`};
  });
  return figure({lead: items.length ? [[`${money(s.total)} · ${items.length} jobs · top: ${items[0].label} ${Math.round(100 * items[0].value / (s.total || 1))}%`]] : [], chart: bars(items), table});
}

const millions = n => `${(n / 1e6).toFixed(n < 1e6 ? 2 : 1)}M`;
const dollars = n => `$${(Number(n) || 0).toFixed(n && n < 0.1 ? 4 : 2)}`;

/**
 * Free AI per install: each install's day money, day tokens and month money as bars against their lines (blue, amber from 70%, red from 90%).
 * `installs` is freeSummary().perInstall (top 30 shown, as the table), `lines` the limits in force ({installDayUsd, tokensPerDay, installMonthUsd}).
 * An install's day ends at whichever of its two day lines it reaches first: that is why both day bars are there.
 */
export function installsFigure(installs, lines, table) {
  const pct = (value, line) => (line ? Math.round(100 * value / line) : 0);
  const rows = installs.slice(0, 30).map(row => ({
    label: row.who, text: `${dollars(row.day)} today`, sub: `${dollars(row.month)} this month`,
    meters: [{caption: 'Day $', pct: pct(row.day, lines.installDayUsd)}, {caption: 'Day tokens', pct: pct(row.tokens || 0, lines.tokensPerDay)}, {caption: 'Month', pct: pct(row.month, lines.installMonthUsd)}],
    tip: `${row.who} · today ${dollars(row.day)} (${pct(row.day, lines.installDayUsd)}% of $${lines.installDayUsd}) · ${millions(row.tokens || 0)} tokens (${pct(row.tokens || 0, lines.tokensPerDay)}% of ${millions(lines.tokensPerDay)}) · this month ${dollars(row.month)} (${pct(row.month, lines.installMonthUsd)}% of $${lines.installMonthUsd})`}));
  const near = installs.filter(row => Math.max(pct(row.day, lines.installDayUsd), pct(row.tokens || 0, lines.tokensPerDay), pct(row.month, lines.installMonthUsd)) >= 70).length;
  return figure({lead: rows.length ? [[`${installs.length} installs`], [`${near} near a line`, near ? 'warn' : 'good']] : [], chart: meters(rows), table});
}

/** Free AI steps as ranked bars of their cost; calls, tokens and cost per call in the tooltip. `steps` is freeSummary().steps. */
export function freeStepsFigure(steps, table) {
  return figure({chart: bars(steps.map(step => ({label: step.action, hint: `${step.calls.toLocaleString('en-US')} calls`, value: step.usd, text: dollars(step.usd),
    tip: `${step.action} · ${dollars(step.usd)} · ${step.calls.toLocaleString('en-US')} calls · ${(step.tokensIn + step.tokensOut).toLocaleString('en-US')} tokens · ${dollars(step.calls ? step.usd / step.calls : 0)} per call`}))), table});
}

/** Pro AI steps as ranked bars of the credit used; calls and the raw-cost estimate in the tooltip. `steps` is readProCosts().steps. */
export function proFigure(steps, table) {
  const credit = n => `€${(Number(n) || 0).toFixed(2)}`;
  return figure({chart: bars(steps.map(step => ({label: step.action, hint: `${step.calls} calls`, value: step.creditEur, text: credit(step.creditEur),
    tip: `${step.action} · credit ${credit(step.creditEur)} · ${step.calls} calls · estimated raw cost ${money(step.estimatedUsd)} · $${(step.calls ? step.estimatedUsd / step.calls : 0).toFixed(4)} per call`}))), table});
}
