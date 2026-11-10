// The Scoreboard card of the Night search tab (owner, 10 Nov 2026, via [sa]: "Scoreboard first": no new Find jobs improvement until the nightly measures 18 of 18 on one fixed AI and Admin shows the weekly chart).
// One chart per question, night by night, from the nightly verdict rows only (admin/search-night.js): how many of the 18 people got a right job (role AND place, the blind judge's `kind` 'measured'), how many got five or
// more, how many right jobs in all, how fast the first one came, and for how many people the night did not measure at all (its own grey band, so a blind night never reads as a bad one).
// Why (10 Nov 2026, owner: "EURES should be just a backup"): the nights before 11 Nov ran with EURES, the nights from it without; the two are separate series with the reason on the chart, never one line falling.
// A by-hand full run (owner: "We should trigger manually, to understand right away the direction") is a hollow point beside the nights, never a night: it is stored apart (key 'search-byhand', admin/search-night-hand.js), so
// it neither replaces a night nor feeds the judge or the alert. Pure: nights in, HTML out; the tab's one tooltip script (VIZ_TOOLTIP) comes with the Day by day card. Guard: test/unit/admin/search/search-night-scoreboard.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {columns, figure, line} from './viz.js';
import {euresOf} from './search-night-judge.js';

export const FIVE = 5;   // "enough": a person with this many right jobs or more
const DAY = 86400000;
const isNum = value => typeof value === 'number' && Number.isFinite(value);
import {NOT_MEASURED as BLIND} from './search-night.js';   // rows the check could not measure (errored, refused, too slow, not run); 'none-right' and 'nothing' ARE measured results
const days = (from, to) => { const out = []; for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY) out.push(new Date(at).toISOString().slice(0, 10)); return out; };
const median = list => { const sorted = list.filter(isNum).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };

/**
 * One night (or one by-hand run) as the scoreboard's numbers: {day, total, right, five, blind, rightJobs, first, engine, eures}. `right` = people with at least one right job, `five` = with five or more,
 * `blind` = people not measured, `rightJobs` = right jobs added up, `first` = seconds to the first job in their places (the median of the rows' stored `counters.firstS`, the press's own seconds-to-first-job; NOT `seconds`, the press's whole wall time), `engine` = the AI word the night stored, 'unknown' before it did.
 * @param {object} night a stored night or by-hand run ({night | day, rows: [{kind, local, seconds}], engine?, eures?})
 */
export function scoreOf(night) {
  const rows = night.rows || [];
  return {day: night.night || night.day, total: rows.length, right: rows.filter(row => row.kind === 'measured').length, five: rows.filter(row => row.kind === 'measured' && isNum(row.local) && row.local >= FIVE).length,
    blind: rows.filter(row => BLIND.includes(row.kind)).length, rightJobs: rows.reduce((sum, row) => sum + (row.kind === 'measured' && isNum(row.local) ? row.local : 0), 0), first: median(rows.map(row => row.counters?.firstS)),
    engine: typeof night.engine === 'string' && night.engine ? night.engine : 'unknown', eures: euresOf(night), at: night.at || null};
}

const words = score => `${score.day} · ${score.right} of ${score.total} people with a right job · ${score.five} with ${FIVE} or more · ${score.blind ? `${score.blind} not measured` : 'all measured'} · ${score.rightJobs} right jobs · first job in their places ${score.first == null ? 'not counted' : `${score.first} s`} · AI ${score.engine}${score.eures === 'off' ? '' : ' · EURES on'}`;

/**
 * The card's data: the newest candidate count's nights oldest first as continuous days, each {day, night: score | null, hand: score[]}. A day with no night is a gap, never a zero; by-hand runs sit on their own day.
 * @param {object[]} judged the stored nights, newest first
 * @param {object[]} hand the by-hand runs (any order)
 */
export function series(judged, hand = []) {
  const total = judged[0]?.rows?.length, kept = judged.filter(night => night.rows.length === total && !night.notRun).map(scoreOf);
  if (!kept.length) return {total, span: []};
  const oldest = kept.map(score => score.day).sort()[0];   // Why (10 Nov 2026, review): a by-hand run older than the stored nights would stretch the span to years of empty days; it stays in the store, not on the chart
  const handed = hand.filter(run => run?.rows?.length === total && (run.day || '') >= oldest).map(scoreOf);
  const first = [...kept, ...handed].map(score => score.day).sort()[0], last = [...kept, ...handed].map(score => score.day).sort().at(-1);
  return {total, span: days(first, last).map(day => ({day, night: kept.find(score => score.day === day) || null, hand: handed.filter(score => score.day === day)}))};
}

/** The first day a stored night ran without EURES (its own `eures` flag), or null: the chart breaks there ([oe] 1/3, jobadabra #3678: from 11 Nov 2026). */
export const breakDay = span => span.find(item => item.night?.eures === 'off')?.day ?? null;
const markOf = ({day, hand}, brk) => {
  if (day === brk) return {label: 'EURES off', tip: `${day} · from this night EURES is off in CI: the nights before it are another series (they read the EURES list), never one line falling${hand.length ? `\nand a by-hand run:\n${hand.map(words).join('\n')}` : ''}`};
  if (hand.length) return {label: 'by hand', tip: `${day} · by-hand run${hand.length > 1 ? 's' : ''}:\n${hand.map(words).join('\n')}`};
  return undefined;
};

/** The chart styles: only the chips and the legend swatches the card draws. */
export const SCOREBOARD_STYLE = `${CHIP_STYLE}
.sb-head{display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center;margin:8px 0 2px}
.sb-note{margin:10px 0 0;padding:8px 10px;border-radius:8px;border:1px solid var(--vz-line,#262c33);font-size:12.5px}
.sb-hollow{display:inline-block;width:9px;height:9px;border-radius:50%;border:2.5px solid var(--s2);vertical-align:-1px}`;

/** The by-hand rows under the charts: one line per run, so a hand run's numbers can be read, not only hovered. */
const handTable = hand => (hand.length ? `<details class="vz-more"><summary>By-hand runs (${hand.length})</summary><div class="scroll"><table><tr><th>When</th><th class="num">With a right job</th><th class="num">With ${FIVE}+</th><th class="num">Not measured</th><th class="num">Right jobs</th><th class="num">First job in their places</th><th>AI</th></tr>${hand.map(score => `<tr><td>${esc(score.at ? score.at.replace('T', ' ').slice(0, 16) : score.day)}</td><td class="num">${score.right} of ${score.total}</td><td class="num">${score.five}</td><td class="num">${score.blind}</td><td class="num">${score.rightJobs}</td><td class="num">${score.first == null ? '–' : `${score.first} s`}</td><td>${esc(score.engine)}</td></tr>`).join('')}</table></div></details>` : '');

/** The AI chips: one per run of nights on the same AI word, so a change of AI reads as a change of series. */
const engineStrip = span => {
  const runs = [];
  for (const {day, night} of span) { if (!night) continue; const last = runs.at(-1); if (last && last.engine === night.engine) last.to = day; else runs.push({engine: night.engine, from: day, to: day}); }
  return runs.map(run => chip(`AI ${esc(run.engine)} · ${esc(run.from.slice(5).replace('-', '/'))}${run.to === run.from ? '' : `–${esc(run.to.slice(5).replace('-', '/'))}`}`, run.engine === 'unknown' ? 'off' : 'good')).join(' ');
};

// A chart under its caption; no chart (no value at all, e.g. no night stored seconds) leaves no caption either.
const captioned = (caption, chart) => (chart ? `<p class="muted small" style="margin:8px 0 0">${caption}</p>${figure({chart})}` : '');

/**
 * The card: '' when no night is stored (the tab already says so).
 * @param {object[]} judged the stored nights, newest first (admin/search-night-judge.js judgeAll)
 * @param {object[]} [hand] by-hand full runs ({day, at, engine, rows}), stored apart from the nights
 */
export function scoreboardSection(judged, hand = []) {
  const {total, span} = series(judged || [], hand);
  if (!span.length) return '';
  const label = Math.max(1, Math.ceil(span.length / 7)), newest = [...span].reverse().find(item => item.night)?.night, brk = breakDay(span);
  const people = span.map(item => ({day: item.day, values: item.night ? [item.night.right, item.night.five, item.night.blind] : [null, null, null], tip: item.night ? words(item.night) : `${item.day} · no night stored`, mark: markOf(item, brk)}));
  // A line carries the night's value (grey while EURES was on) and, on a day with only a by-hand run, that run as a hollow point; a by-hand run beside a night is in the table and the mark's tip.
  const point = pick => span.map(item => {
    const score = item.night || item.hand[0];
    return {day: item.day, value: score ? pick(score) : null, muted: !!score && score.eures === 'on', hand: !item.night && !!item.hand[0], tip: score ? words(score) : `${item.day} · no night stored`, mark: markOf(item, brk)};
  });
  const rightJobs = point(score => score.rightJobs), first = point(score => score.first);
  const head = newest ? `${chip(`${newest.right} of ${newest.total} with a right job`, newest.right === newest.total ? 'good' : 'warn')} ${chip(`${newest.five} with ${FIVE}+`, 'off')} ${newest.blind ? chip(`${newest.blind} not measured`, 'off') : ''} ${chip(`AI ${esc(newest.engine)}`, newest.engine === 'unknown' ? 'off' : 'good')}` : '';
  return `<section class="card" id="night-scoreboard"><h2>🎯 Scoreboard: the ${total} people, night by night</h2>
<p class="muted small" style="margin:0">Right job = right role AND right place, by the blind judge · one point a night · a day with no night is a gap · grey = the check could not measure that person (not a bad result)</p>
<div class="sb-head">${head}</div>
<p class="muted small" style="margin:8px 0 0">People with a right job, with ${FIVE} or more, and people not measured (of ${total})</p>${figure({chart: columns(people, [{name: 'With a right job', tone: 's1'}, {name: `With ${FIVE} or more`, tone: 's3'}, {name: 'Not measured', tone: 'off'}], {whole: true, gapLabel: 'no night stored', labelEvery: label})})}
${captioned(`Right jobs found, all ${total} added up`, line(rightJobs, {tone: 's2', percent: false, whole: true, name: 'Right jobs', labelEvery: label}))}
${captioned(`Seconds to the first job in their places (median of the ${total})`, line(first, {tone: 's4', percent: false, whole: true, name: 'First job in their places', labelEvery: label}))}
<p class="small" style="margin:8px 0 0">${engineStrip(span)}</p>
<p class="sb-note">${brk ? `<b>EURES off from ${esc(brk.slice(5).replace('-', '/'))}.</b> The grey line and dots before it are nights that read the EURES list; from it our own sources stand alone.` : '<b>No night without EURES yet.</b> Every night here still read the EURES list; the first night without it breaks the lines and starts a new series.'} ${span.some(item => item.hand.length) ? '<span class="sb-hollow"></span> a hollow point is a by-hand full run, not a night.' : ''}</p>
${handTable(span.flatMap(item => item.hand))}</section>`;
}
