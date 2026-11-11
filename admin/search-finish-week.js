// The week's card on the "Finish line" tab (owner, 11 Nov 2026: "each of the runs should provide new jobs"; sa's go for the picture): once a week the 18 people are pressed 5 times in one install (public search-personas.yml,
// stored by admin/search-week.js). This draws what each run added: new right jobs per run 1..5, who got at least one, and each person's right jobs after each run. Counts only. Pure: the newest stored week in, HTML out.
// "Runs to the line" is NOT drawn: the owner has not said when the line is reached (a chip says so). A missing week is an empty state, never a flat line; a count that was not whole is null and reads "not sent", never 0.
// Guard: test/unit/admin/search/search-finish-week.test.js.
import {esc} from '../shared/html.js';
import {chip} from './chip.js';
import {BLIND} from './search-finish.js';
import {countTicks} from './viz-time.js';
import {tipOf} from './viz-core.js';

const W = 720, H = 200, BOX = {l: 44, r: 8, t: 14, b: 26};
const who = (persona, label) => `<b>p${esc(persona)}</b> ${esc(String(label || '').replace(/^p\d+ /, ''))}`;
const cell = value => (value == null ? '<span class="chip off">not sent</span>' : `<b>${Number(value).toLocaleString('en-US')}</b>`);

/** New right jobs per run as columns on a run axis 1..n from a baseline of 0 (a 0 is a labelled column of no height, a run the week did not send is a hollow dashed column). byRun: [{run, measured, peopleNew, newRight}]. */
function runChart(byRun) {
  const top = Math.max(...byRun.map(item => item.newRight || 0)), ticks = countTicks(top), max = ticks[ticks.length - 1] || 1;
  const pw = W - BOX.l - BOX.r, ph = H - BOX.t - BOX.b, y = value => BOX.t + ph - (ph * value) / max, slot = pw / byRun.length, each = Math.min(64, slot * 0.6);
  const grid = ticks.map(tick => `<line x1="${BOX.l}" x2="${W - BOX.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" class="vz-grid"/><text x="${BOX.l - 6}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" class="vz-axis">${tick}</text>`).join('');
  const groups = byRun.map((item, index) => {
    const middle = BOX.l + slot * index + slot / 2, x = (middle - each / 2).toFixed(1), tip = `Run ${item.run} · ${item.newRight == null ? 'new right jobs not sent' : `${item.newRight} new right jobs`} · ${item.peopleNew ?? '?'} of ${item.measured ?? '?'} people got at least one`;
    const bar = item.newRight == null
      ? `<rect x="${x}" y="${BOX.t + ph - 14}" width="${each.toFixed(1)}" height="14" rx="2" fill="none" stroke="var(--s1)" stroke-dasharray="2 2"/>`
      : `<rect x="${x}" y="${y(item.newRight).toFixed(1)}" width="${each.toFixed(1)}" height="${(BOX.t + ph - y(item.newRight)).toFixed(1)}" rx="2" fill="var(--s1)"/><text x="${middle.toFixed(1)}" y="${(y(item.newRight) - 4).toFixed(1)}" text-anchor="middle" class="vz-axis">${item.newRight}</text>`;
    return `<g${tipOf(tip)}><rect x="${(middle - slot / 2).toFixed(1)}" y="${BOX.t}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent"/>${bar}<text x="${middle.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="vz-axis">Run ${item.run}</text></g>`;
  }).join('');
  return `<svg class="vz-cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="New right jobs per run">${grid}${groups}</svg>`;
}

function personTable(rows, n) {
  const head = Array.from({length: n}, (_, i) => `<th class="num">After run ${i + 1}</th>`).join('');
  const body = rows.map(row => `<tr><td>${who(row.persona, row.label)}</td>${Array.from({length: n}, (_, i) => `<td class="num">${BLIND.includes(row.kind) ? chip('not measured', 'off') : cell(row.runs?.[i]?.rightAfter ?? null)}</td>`).join('')}</tr>`).join('');
  return `<details><summary>Each person's right jobs after each run (a job counted once)</summary><div class="scroll"><table><tr><th>Person</th>${head}</tr>${body}</table></div></details>`;
}

/**
 * The week's card.
 * @param {object|null|undefined} week the newest stored week (admin/search-week.js weeks()[0]): {week, byHand, rows, byRun}; none = "no week yet"
 */
export function weekCard(week) {
  const title = '<h2>📆 The week: what each run adds</h2>';
  if (!week || !Array.isArray(week.byRun) || !week.byRun.length) {
    return `<section class="card vz" id="finish-week">${title}<p class="muted">${week ? `The week of ${esc(week.week)} was sent without its per-run counts.` : 'No week yet.'} Once a week the 18 people are pressed 5 times in one install and this shows what each run added: it first arrives with the next weekly run (Thursday 03:00 UTC, or by hand). ${chip('no week yet', 'off')}</p></section>`;
  }
  const byRun = week.byRun, table = byRun.map(item => `<tr><td>Run ${item.run}</td><td class="num">${cell(item.measured)}</td><td class="num">${cell(item.peopleNew)}</td><td class="num">${cell(item.newRight)}</td><td class="num">${cell(week.rows.filter(row => !BLIND.includes(row.kind)).reduce((sum, row) => (sum == null || row.runs?.[item.run - 1]?.rightAfter == null ? null : sum + row.runs[item.run - 1].rightAfter), 0))}</td></tr>`).join('');
  return `<section class="card vz" id="finish-week">${title}<div class="muted small">Week of ${esc(week.week)}${week.byHand ? ' · by hand' : ''} · 5 runs in one install, our own sources, EURES off · new right jobs = right jobs that run listed first · ${chip('runs to the line: not defined yet', 'off')}</div>
${runChart(byRun)}
<div class="scroll"><table><tr><th>Run</th><th class="num">People measured</th><th class="num">People with at least 1 new right job</th><th class="num">New right jobs</th><th class="num">Right jobs after the run (all people)</th></tr>${table}</table></div>
${personTable(week.rows, byRun.length)}</section>`;
}
