// The charts of /admin/growth/email and the AI-cost steps of /admin/growth/insights (owner, 5 Nov 2026: "transform [the tables] into a more visual representation. Preferably graphs";
// only plain tables of numbers, lookups and logs stay). Each returns the chart only; the page puts the table it replaces behind "Show table" with `figure`.
// Pure; guard: test/unit/admin/email-charts.test.js. Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md.
import {bars, stacks} from './viz.js';

const num = value => (Number(value) || 0).toLocaleString('en-US');
const rowsOf = (rows, value, label) => bars(rows.map(row => ({label: label(row), value: Number(value(row)) || 0, text: num(value(row))})));

/** Mail per template: one bar per template sized by its total, split into sent and not sent. rows = data.byTemplate [{template, sent, refused, last}]. */
export function templateChart(rows) {
  return stacks(rows.map(row => ({
    label: row.template, parts: [{value: Number(row.sent) || 0, tone: 's1'}, {value: Number(row.refused) || 0, tone: 's2'}],
    text: `${num(row.sent)} sent`, sub: `${num(row.refused)} not sent${row.last ? ` · last ${row.last.slice(0, 10)}` : ''}`,
    tip: `${row.template} · ${num(row.sent)} sent · ${num(row.refused)} not sent${row.last ? ` · last sent ${row.last.slice(0, 16).replace('T', ' ')}` : ''}`,
  })), [['s1', 'Sent'], ['s2', 'Not sent']], {scale: true});
}

/** Why mail was refused before sending: bars of mails per reason. rows = data.refused [{reason, n}]. */
export const refusedChart = rows => rowsOf(rows, row => row.n, row => row.reason);

/** Confirmed, unconfirmed and opted-in accounts as bars (opt-in overlaps the other two, so these are not parts of one whole). groups = [[name, count]]. */
export const addressChart = groups => rowsOf(groups, group => group[1], group => group[0]);

/** Addresses we stopped mailing, all time: one bar per reason and list. rows = data.offReasons [{reason, list, n}]. */
export const stoppedChart = rows => rowsOf(rows, row => row.n, row => `${row.reason} · ${row.list}`);

/** What each AI step costs us: bars of money per step, calls and cost per call under the name. steps = cost.steps [{action, calls, usd, perCall}]. */
export function stepCostChart(steps) {
  const usd = value => `$${(Number(value) || 0).toFixed(3)}`;
  return bars(steps.map(row => ({label: row.action, hint: `${num(row.calls)} calls · $${(Number(row.perCall) || 0).toFixed(4)} each`, value: Number(row.usd) || 0, text: usd(row.usd),
    tip: `${row.action} · ${num(row.calls)} calls · ${usd(row.usd)} · $${(Number(row.perCall) || 0).toFixed(4)} per call`})));
}
