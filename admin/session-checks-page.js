// The "Session checks" tab of /admin/job-search/lab (owner, 24 Oct 2026): the local search checks sessions ran, so the next session starts from them (admin/session-checks.js).
// Why (owner, 12 Nov 2026: "not very intelligible… make them more meaningful just by looking at them"; sketch https://claude.ai/artifact/MDCxJXb1Kb9PKuF8CS6w8M, "Redesign (Recommended)"):
// a band that says how fresh the checks are, then one card per round (a session's checks of one day), one bar per place (repeats folded into "n runs"), and "found of target" bars
// when the round measured a target. The boards, what broke and the conclusions stay one click away per round. Guard: test/unit/admin/session-checks.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {verdictBand} from './verdict-band.js';
import {VIZ_TOOLTIP, bars, figure, stacks} from './viz.js';
import {labelOf} from './session-checks.js';

const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? '—' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
const DAY = 86400000, QUIET_DAYS = 3;
const titleOf = row => labelOf(row.label) || row.case_id;

/** Checks (newest first) → rounds: one per session and UTC day, newest first; inside, one entry per place with its runs (newest first). */
export function rounds(rows) {
  const out = new Map();
  for (const row of rows) {
    const key = `${row.run_at.slice(0, 10)} ${row.session}`;
    if (!out.has(key)) out.set(key, {day: row.run_at.slice(0, 10), session: row.session, checks: [], places: new Map()});
    const round = out.get(key), name = titleOf(row);
    round.checks.push(row);
    if (!round.places.has(name)) round.places.set(name, []);
    round.places.get(name).push(row);
  }
  return [...out.values()];
}

function boardsTable(boards) {
  if (!boards.length) return '';
  return `<div class="scroll"><table><tr><th>Board</th><th class="num">Listed</th><th class="num">Relevant</th><th>Note</th></tr>${boards.map(board =>
    `<tr><td>${esc(board.name)}</td><td class="num">${num(board.listed)}</td><td class="num">${board.relevant === 0 && board.listed > 0 ? `<span class="down">${num(board.relevant)}</span>` : num(board.relevant)}</td><td class="muted">${esc(board.note || '')}</td></tr>`).join('')}</table></div>`;
}

/** One check's detail (in the round's toggle): its line, its boards, what broke and the conclusion. */
const detail = row => `<div class="sc-one"><p><b>${esc(titleOf(row))}</b> <span class="state ${row.state === 'ok' ? 'good' : 'bad'}">${row.state === 'ok' ? 'Ran' : 'FAILED'}</span> <span class="muted">${esc(row.country)}${row.role ? ` · ${esc(row.role)}` : ''} · ${esc(row.run_at.slice(0, 16).replace('T', ' '))} UTC · build ${esc(row.build || 'unknown')}${row.prs ? ` · ${esc(row.prs)}` : ''}</span></p>
${boardsTable(row.boards)}${row.broke ? `<p><b>What broke:</b> ${esc(row.broke)}</p>` : ''}${row.conclusion ? `<p><b>Conclusion:</b> ${esc(row.conclusion)}</p>` : ''}</div>`;

const runsWord = runs => (runs.length > 1 ? ` · ${runs.length} runs` : '');
const lineOf = row => `scored ${num(row.scored)} · 70+ ${num(row.fit70)} · 1st job ${clock(row.first_s)} · run ${clock(row.seconds)}`;

function roundCard(round) {
  const places = [...round.places.entries()], measured = places.filter(([, runs]) => runs[0].target != null && runs[0].target > 0);
  const modes = [...new Set(round.checks.map(row => row.mode))].map(mode => `<span class="chip">${esc(mode)}</span>`).join(' ');
  const failed = round.checks.filter(row => row.state !== 'ok').length;
  let chart, summary = '';
  if (measured.length) {
    const pass = measured.filter(([, runs]) => (runs[0].local_jobs ?? 0) >= runs[0].target).length;
    summary = ` ${chip(`${pass} pass · ${measured.length - pass} below`, pass === measured.length ? 'good' : 'bad')}`;
    const sorted = [...places].sort(([, a], [, b]) => ((b[0].target ?? -1) - (b[0].local_jobs ?? 0)) - ((a[0].target ?? -1) - (a[0].local_jobs ?? 0)));
    chart = stacks(sorted.map(([name, runs]) => {
      const row = runs[0], found = row.local_jobs ?? 0, target = row.target;
      if (target == null || target <= 0) return {label: name, text: `${num(found)} found`, sub: 'no target', parts: [{value: found, tone: 's1'}], tip: `${name}: ${num(found)} local jobs, target not measured${runsWord(runs)}`};
      const met = found >= target;
      return {label: name, text: `${num(found)} of ${num(target)}`, sub: row.broke || '', parts: [{value: Math.min(found, target), tone: met ? 'good' : 'bad'}, {value: Math.max(0, target - found), tone: 'off'}],
        tip: `${name}: found ${num(found)} of ${num(target)} relevant local jobs · ${lineOf(row)}${runsWord(runs)}`};
    }), [['good', 'found, meets the target'], ['bad', 'found, below the target'], ['off', 'still missing to the target']], {scale: true});
  } else {
    chart = bars(places.map(([name, runs]) => ({label: name, hint: `${lineOf(runs[0])}${runsWord(runs)}`, value: runs[0].local_jobs ?? 0, text: `${num(runs[0].local_jobs)} local jobs`,
      tip: `${name}: ${runs.map(row => num(row.local_jobs)).join(', ')} local jobs (newest first) · ${lineOf(runs[0])}`})));
  }
  return `<section class="card"><h2>${esc(round.day)} · session ${esc(round.session)} · ${round.checks.length} check${round.checks.length === 1 ? '' : 's'} in ${places.length} place${places.length === 1 ? '' : 's'} ${modes}${summary}${failed ? ` ${chip(`${failed} failed`, 'bad')}` : ''}</h2>
${figure({chart, table: round.checks.map(detail).join(''), label: 'Boards, what broke and the conclusion of each check'})}</section>`;
}

/** The whole tab: the freshness band, then one card per round, newest first. `now` decides "days ago". */
export function checksSection(rows, now = new Date()) {
  if (!rows.length) return '<section class="card"><h2>No session check yet</h2><p class="muted">After a local check, a session uploads it with <code>tools/persona-search/publish-session-check.py</code> (see the skill check-job-search-locally).</p></section>';
  const all = rounds(rows), sessions = new Set(rows.map(row => row.session)).size, days = Math.floor((now - Date.parse(rows[0].run_at)) / DAY);
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const band = verdictBand({icon: days > QUIET_DAYS ? '🟠' : '🟢', headline: `${rows.length} checks by ${sessions} session${sessions === 1 ? '' : 's'}, the last ${ago}`,
    chips: [{label: days > QUIET_DAYS ? `quiet since ${rows[0].run_at.slice(0, 10)}` : `last ${rows[0].run_at.slice(0, 10)}`, tone: days > QUIET_DAYS ? 'warn' : 'good'}, {label: `${all.length} rounds`, tone: 'off'}],
    note: 'Local jobs are jobs placed in the person\'s city or country, never worldwide remote. Read a round before running the same check again.'});
  return `${band}${all.map(roundCard).join('')}${VIZ_TOOLTIP}`;
}

export const CHECKS_CSS = `${CHIP_STYLE}.sc-one{border-top:1px solid #2a2f37;padding-top:8px;margin-top:8px}`;
