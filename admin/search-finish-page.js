// The "Finish line" tab of /admin/job-search/lab (owner, 10 Nov 2026, picture approved via AskUserQuestion: "Build it as shown"): how close Find jobs is to the finish line for the 18 fixed people, run by run.
// The line today (sa's default, owner may change it): every person has at least 95% of the right jobs a source shows for them in Jobadabra's list (in = out). Day one the only source with an `in` is EURES; every other
// block says "not sent yet" until sf's rows (inout, sources) arrive, and a source appears in the Sources table by itself when its words are in a row. Counts and fixed words only. Pure: runs in, HTML out.
// Guard: test/unit/admin/search/search-finish-page.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {LINE, peopleOf, sourcesOf, tally, weakest} from './search-finish.js';
import {stacked} from './viz-stack.js';
import {VIZ_STYLE, VIZ_TOOLTIP, figure} from './viz.js';

const SOURCE_NAMES = {eures: 'EURES', employer_sites: 'Employer sites', job_boards: 'Job boards', free_job_apis: 'Free job APIs', web_search: 'Web search', linkedin: 'LinkedIn Jobs', public_board: 'Public job boards'};
const STAGE_WORDS = {not_read: 'never listed by our read', never_asked: 'read, ran out of time before it was asked', ai_no: 'asked, the AI said no', placed_out: 'placed in another country', double: 'dropped as a double', after_kept: 'kept by every filter, not in the list', listed: 'in the list'};
const STAGE_TONE = {not_read: 'off', never_asked: 'warn', ai_no: 'warn', placed_out: 'warn', double: 'off', after_kept: 'bad'};   // after_kept is the unexplained loss: its own red (sa, 10 Nov 2026)
const COLORS = {out: 'var(--s3)', never_asked: 'var(--s4)', ai_no: 'var(--s2)', placed_out: 'var(--s5)', double: 'var(--s6)', after_kept: '#ff5a4f', not_read: 'var(--off)'};
const name = source => SOURCE_NAMES[source] || source;
const num = value => (value == null ? '<span class="chip off">not sent yet</span>' : Number(value).toLocaleString('en-US'));
const who = (persona, label) => `<b>p${esc(persona)}</b> ${esc(String(label || '').replace(/^p\d+ /, ''))}`;

/** The card styles: the chips, the per-person bars and the floor line. */
export const FINISH_STYLE = `${CHIP_STYLE}${VIZ_STYLE}
.fl-band{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.fl-big{font-size:34px;font-weight:700;line-height:1}.fl-big small{font-size:18px;color:var(--vz-muted,#8d949c);font-weight:500}
.fl-row{display:grid;grid-template-columns:190px 1fr 220px;gap:10px;align-items:center;padding:3px 0}
.fl-bar{position:relative;height:16px;background:#1b2027;border-radius:4px;display:flex}.fl-bar i{display:block;height:100%}.fl-bar i:first-child{border-radius:4px 0 0 4px}
.fl-floor{position:absolute;top:-3px;bottom:-3px;border-left:2px dashed #fff;opacity:.85}
.fl-blind{height:16px;border-radius:4px;background:repeating-linear-gradient(135deg,#1b2027 0 6px,#232a32 6px 12px)}
.fl-share{display:inline-block;height:8px;border-radius:4px;background:var(--s1);vertical-align:middle;margin-left:6px}`;

// A run in the chart's order: nights and by-hand runs together, newest first. A by-hand run is marked (hollow in the chart, "by hand" in its tip).
// Only the newest night's candidate set (a night of another set is another series, as the Scoreboard card).
const runsOf = (judged, hand) => [...(judged || []).map(night => ({...night, hand: false})), ...(hand || []).map(run => ({...run, night: run.day, hand: true}))].filter((run, _, all) => run.rows.length === (judged || [])[0]?.rows.length).sort((a, b) => b.night.localeCompare(a.night) || String(b.at || '').localeCompare(String(a.at || '')));

function band(runs) {
  const last = runs.find(run => tally(run).hasInout), t = last ? tally(last) : null, referenced = t ? t.atLine + t.some + t.none : 0;
  let streak = 0;
  for (const run of runs.filter(item => tally(item).hasInout)) { const x = tally(run); if (x.atLine === x.total) streak += 1; else break; }
  const head = t ? `<div><div class="fl-big">${t.atLine} <small>of ${referenced}</small></div><div class="muted small">people with a reference at the line (${Math.round(LINE * 100)}%+ of EURES's right jobs)</div></div>
<div><div class="fl-big">${Math.min(streak, 3)} <small>of 3</small></div><div class="muted small">runs in a row with all ${t.total} at the line = reached</div></div>`
    : '<div><div class="fl-big">–</div><div class="muted small">no run has sent in = out yet (it starts with the next run that does)</div></div>';
  return `<div class="card vz fl-band" id="finish-band">${head}<div style="flex:1;min-width:300px">${chip('market = EURES only (day one)', 'warn')} ${chip('LinkedIn not counted · coverage is without LinkedIn', 'off')} ${t && t.blind ? chip(`${t.blind} not measured`, 'off') : ''} ${t && t.noReference ? chip(`${t.noReference} without a reference`, 'off') : ''} ${last?.engine && last.engine !== 'unknown' ? chip(`AI ${esc(last.engine)}`, 'good') : ''}${last ? `<div class="muted small" style="margin-top:4px">last run: ${last.hand ? 'by hand' : 'night'} ${esc(last.night)}</div>` : ''}</div></div>`;
}

function weakCard(runs) {
  const {rows, night} = weakest(runs), body = rows.map(row => {
    const known = row.history.filter(value => value != null), trend = known.length >= 2 ? `${[...known, row.lost].join(' · ')}` : `${known.length + 1} run${known.length ? 's' : ''} (a trend needs 3)`;
    return `<tr><td>${who(row.persona, row.label)}</td><td>${esc(name(row.source))}</td><td>${chip(esc(row.stage), STAGE_TONE[row.stage] || 'off')} <span class="muted small">${esc(STAGE_WORDS[row.stage] || '')}</span></td><td class="num"><b>${row.lost}</b></td><td class="num">${row.in} → ${row.out}</td><td class="small">${trend}</td><td>${chip('nobody on it', 'off')}</td></tr>`;
  }).join('');
  return `<section class="card vz" id="finish-weakest"><h2>🔻 Weakest now</h2><div class="muted small">The 5 worst person × source × stage rows of the last run${night ? ` (${esc(night)})` : ''}, by right jobs lost · a trend needs 3 runs · a PR counts only with a <code>Moves: p&lt;n&gt; …</code> line in its body</div>
${rows.length ? `<table><tr><th>Person</th><th>Source</th><th>Lost at stage</th><th class="num">Lost</th><th class="num">In → out</th><th>Last runs</th><th>Who is on it</th></tr>${body}</table>` : '<p class="muted">Nothing lost, or no run has sent in = out yet.</p>'}</section>`;
}

function overTime(runs) {
  const shown = runs.filter(run => tally(run).hasInout).slice(0, 14).reverse();
  if (!shown.length) return '';
  const days = shown.map(run => { const t = tally(run); return {day: run.night, hand: run.hand, values: [t.atLine, t.some, t.none, t.blind], tip: `${run.night}${run.hand ? ' · by hand' : ''} · ${t.atLine} at the line · ${t.some} below it · ${t.none} found none · ${t.blind} not measured · ${t.noReference} without a reference`}; });
  return `<section class="card vz" id="finish-over"><h2>📈 People at the line, run by run</h2><div class="muted small">Of the ${shown[0] ? tally(shown[0]).total : 18} · grey = not measured, never a bad run · a hollow run was by hand · the top of the chart is the finish line</div>
${figure({chart: stacked(days, [{name: 'At the line', tone: 's3'}, {name: 'Found some, below the line', tone: 's1'}, {name: 'Found none', tone: 's2'}, {name: 'Not measured', tone: 'off'}], {top: tally(shown[0]).total})})}</section>`;
}

function inout(runs) {
  const last = runs.find(run => tally(run).hasInout);
  if (!last) return '';
  const people = peopleOf(last), max = Math.max(1, ...people.map(person => person.in || 0)), seg = (value, key, inn) => (value > 0 ? `<i title="${esc(key)} ${value}" style="width:${Math.min(100, (value / inn) * 100)}%;background:${COLORS[key]}"></i>` : '');
  const rows = people.map(person => {
    if (person.blind) return `<div class="fl-row"><div class="small">${who(person.persona, person.label)}</div><div class="fl-blind"></div><div>${chip('not measured', 'off')}</div></div>`;
    if (!(person.in > 0)) return `<div class="fl-row"><div class="small">${who(person.persona, person.label)}</div><div class="fl-bar"></div><div>${chip(person.in === 0 ? 'EURES lists none · no reference' : 'no in = out sent', 'off')}</div></div>`;
    const unexplained = person.lost.after_kept || 0;
    return `<div class="fl-row"><div class="small">${who(person.persona, person.label)}</div><div class="fl-bar" style="width:${(person.in / max) * 100}%">${seg(person.out, 'out', person.in)}${['never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'not_read'].map(stage => seg(person.lost[stage] || 0, stage, person.in)).join('')}<span class="fl-floor" style="left:${LINE * 100}%"></span></div>`
      + `<div>${chip(`${person.out} of ${person.in} · ${person.atLine ? 'at the line' : 'under the floor'}`, person.atLine ? 'good' : 'bad')}${unexplained ? chip(`${unexplained} unexplained`, 'bad') : ''}</div></div>`;
  }).join('');
  return `<section class="card vz" id="finish-inout"><h2>⇄ In = out, per person (EURES)</h2><div class="muted small">In = right jobs EURES shows for the person · out = how many are in our list after one search · every missing job is counted at the stage that lost it · dashed = the floor (${Math.round(LINE * 100)}% of in) · run of ${esc(last.night)}${last.hand ? ' (by hand)' : ''}</div>${rows}
<div class="vz-legend">${['out', 'never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'not_read'].map(key => `<span><i style="background:${COLORS[key]}"></i>${esc(key)}${key === 'after_kept' ? ' (unexplained)' : ''}</span>`).join('')}</div></section>`;
}

function sourcesCard(runs) {
  const {rows, night} = sourcesOf(runs);
  const body = rows.map(row => `<tr><td><b>${esc(name(row.source))}</b></td><td class="num">${num(row.right)}</td><td class="num">${row.share == null ? '–' : `<b>${Math.round(row.share * 100)}%</b><span class="fl-share" style="width:${Math.max(2, Math.round(row.share * 90))}px"></span>`}</td><td class="num">${num(row.only)}</td><td class="num">${num(row.fit70)}</td><td class="num">${row.seconds == null ? '–' : `${row.seconds} s`}</td><td class="num">${row.people} of ${row.measured}</td><td class="num">${row.average == null ? '–' : `${row.average} <span class="muted small">(${row.runs} run${row.runs === 1 ? '' : 's'})</span>`}</td></tr>`).join('');
  return `<section class="card vz" id="finish-sources"><h2>🧩 Sources · what each one is worth</h2><div class="muted small">Right jobs = role AND place, by the blind judge · the last run${night ? ` (${esc(night)})` : ''} and the average of up to 7 runs · a new source appears here by itself when its words are in a row · "not sent yet" is never a 0 · the 18 people never read LinkedIn (its share will come from real installs only, k of 3)</div>
${rows.length ? `<table><tr><th>Source</th><th class="num">Right jobs</th><th class="num">Share</th><th class="num">Only it brought</th><th class="num">Fit 70+</th><th class="num">Seconds</th><th class="num">People served</th><th class="num">Average</th></tr>${body}</table>` : '<p class="muted">No run has sent per-source counts yet.</p>'}</section>`;
}

const NUMBER_WORDS = {right: 'right jobs', eures_inout: 'EURES in = out share', first_s: 'seconds to first job'};
const CEILING = {first_s: true};   // lower is better: its "floor" is a ceiling
const whoIn = (persona, labels) => who(persona, labels[persona]);
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th')}`;
const value = (item, number) => (item == null ? '–' : number === 'eures_inout' ? `${Math.round(item * 100)}%` : String(item));   // eures_inout is a fraction 0-1 (cr): shown as a percent

// ---- Floors card (cr's G2, 10 Nov 2026; admin/search-floors.js keeps the fields, this draws them as sent and computes nothing) ----
/** One red row in cr's words: "p3 · right jobs 0, floor 4 · 2nd night under" (the merges since the last green come once under the list). */
function redRow(item, labels) {
  const word = CEILING[item.number] ? 'ceiling' : 'floor';
  return `<li>${whoIn(item.persona, labels)} · ${esc(NUMBER_WORDS[item.number])} ${value(item.now, item.number)}, ${word} ${value(item.floor, item.number)} · ${item.below == null ? 'nights under not sent' : `${ordinal(item.below)} night under`}</li>`;
}

/**
 * The card.
 * @param {object[]} runs nights and by-hand runs, newest first (each may carry `floors` and `measure`)
 */
export function floorsCard(runs) {
  const run = runs.find(item => item.floors), floors = run?.floors, labels = Object.fromEntries((run?.rows || []).map(row => [row.persona, row.label]));
  const head = '<h2>🧱 Floors that only rise</h2>';
  const note = `<div class="muted small">A floor is the best a person's number held for 3 measured nights; red = under it beyond the spread two nights in a row, on a scheduled night on the locked chain · for seconds to first job the line is a ceiling · the alert is the check's, not this card's</div>`;
  if (!floors) return `<section class="card vz" id="finish-floors">${head}${note}<p>${chip('not sent yet', 'off')} <span class="muted small">no run has sent floors yet</span></p></section>`;
  const where = `<span class="muted small">${run.hand ? 'by-hand run' : 'night'} ${esc(run.night)}${run.measure ? ` · measure ${esc(run.measure)}` : ''}</span>`;
  if (!floors.checked) return `<section class="card vz" id="finish-floors">${head}${note}<p>${chip(`floors: not checked${floors.why ? ` (${esc(floors.why)})` : ''}`, 'off')} ${where}</p></section>`;
  const persons = Object.keys(floors.levels).sort((a, b) => a - b), set = persons.reduce((total, key) => total + Object.values(floors.levels[key]).filter(item => item.floor != null).length, 0);
  const verdict = floors.red.length ? chip(`${floors.red.length} under the floor`, 'bad') : chip('all above their floors', 'good');
  const green = floors.last_green ? `last green run ${esc(floors.last_green.run)}${floors.last_green.sha ? ` (${esc(floors.last_green.sha.slice(0, 7))})` : ''}` : 'no green run known';
  const table = persons.length ? `<details class="vz-more"><summary>All floors (${set} set)</summary><div class="scroll"><table><tr><th>Person</th>${Object.values(NUMBER_WORDS).map(word => `<th class="num">${esc(word)} · now / floor</th>`).join('')}</tr>${persons.map(key => `<tr><td>${whoIn(key, labels)}</td>${Object.keys(NUMBER_WORDS).map(number => { const item = floors.levels[key][number]; return `<td class="num">${item ? `${value(item.now, number)} / ${item.floor == null ? '<span class="muted">no floor yet</span>' : value(item.floor, number)}` : '–'}</td>`; }).join('')}</tr>`).join('')}</table></div></details>` : '';
  return `<section class="card vz" id="finish-floors">${head}${note}<p>${verdict} ${set ? chip(`${set} floors set`, 'off') : chip('no floor yet: it needs 3 measured nights', 'off')} ${where} <span class="muted small">· ${green}</span></p>
${floors.red.length ? `<ul>${floors.red.map(item => redRow(item, labels)).join('')}</ul>${floors.merges.length ? `<div class="small">Merges since the last green: ${floors.merges.map(esc).join('; ')}</div>` : ''}` : ''}${table}</section>`;
}

/**
 * The tab's body.
 * @param {object[]|null} judged the stored nights, newest first (admin/search-night-judge.js judgeAll); null = unreadable
 * @param {object[]} [hand] the by-hand full runs (admin/search-night-hand.js)
 */
export function finishSection(judged, hand = []) {
  if (!judged) return '<section class="card"><h2>The nights could not be read</h2><p class="muted">The store of the nightly Search check did not answer, so this tab cannot draw the finish line.</p></section>';
  const runs = runsOf(judged, hand);
  return `${band(runs)}${floorsCard(runs)}${weakCard(runs)}${overTime(runs)}${inout(runs)}${sourcesCard(runs)}${VIZ_TOOLTIP}`;
}
