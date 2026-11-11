// The "Finish line" tab of /admin/job-search/lab (owner, 10 Nov 2026, picture approved via AskUserQuestion: "Build it as shown"): how close Find jobs is to the finish line for the 18 fixed people, run by run.
// The line today (sa's default, owner may change it): every person has at least 95% of the right jobs a source shows for them in Jobadabra's list (in = out). Day one the only source with an `in` is EURES; every other
// block says "not sent yet" until sf's rows (inout, sources) arrive, and a source appears in the Sources table by itself when its words are in a row. Counts and fixed words only. Pure: runs in, HTML out.
// Guard: test/unit/admin/search/search-finish.test.js (the card: search-floors.test.js, the market card: search-market.test.js).
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {coverage} from './search-market.js';
import {BLIND, LINE, OWN, lostTotals, ownOf, peopleOf, sideOf, sourcesOf, tally, weakest} from './search-finish.js';
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
.fl-lost .fl-row{grid-template-columns:110px 1fr 340px}.fl-share{display:inline-block;height:8px;border-radius:4px;background:var(--s1);vertical-align:middle;margin-left:6px}`;

// A run in the chart's order: nights and by-hand runs together, newest first. A by-hand run is marked (hollow in the chart, "by hand" in its tip).
// Only the newest night's candidate set (a night of another set is another series, as the Scoreboard card).
const runsOf = (judged, hand) => [...(judged || []).map(night => ({...night, hand: false})), ...(hand || []).map(run => ({...run, night: run.day, hand: true}))].filter((run, _, all) => run.rows.length === (judged || [])[0]?.rows.length).sort((a, b) => b.night.localeCompare(a.night) || String(b.at || '').localeCompare(String(a.at || '')));

// The headline (owner, 11 Nov 2026, picture approved via AskUserQuestion: "Yes, build it"): right jobs from OUR OWN sources; EURES and other 3rd parties are bonuses, never in this number (they sit in the Side check card).
function band(runs) {
  const last = runs.find(run => ownOf(run)), own = last ? ownOf(last) : null;
  if (!own) return `<div class="card vz fl-band" id="finish-band"><div><div class="fl-big">–</div><div class="muted small">${chip('not sent yet', 'off')} no night has run with EURES off yet: the headline is our own result, each job once (a run with EURES on goes only to the Side check)</div></div></div>`;
  const split = own.split == null ? '' : `<div class="muted small" style="flex-basis:100%">split by source: ${own.split} right jobs in all · a job two sources found counts for both${own.shared ? ` · ${own.shared} found by more than one source` : ''}${own.holes ? ` · <b>${own.holes}</b> ${own.holes === 1 ? 'person has' : 'people have'} right jobs no source row claims (a data hole)` : ''}</div>`;
  return `<div class="card vz fl-band" id="finish-band"><div><div class="fl-big">${own.right} <small>right jobs</small></div><div class="muted small">in our list from our own sources, each job once, for <b>${own.sent} of ${own.total}</b> people (right role AND place, by the blind judge)</div></div>
<div><div class="fl-big">${own.people} <small>of ${own.total}</small></div><div class="muted small">people with at least one right job</div></div>
<div style="flex:1;min-width:300px">${chip('EURES off: our own sources only', 'good')} ${last.engine && last.engine !== 'unknown' ? chip(`AI ${esc(last.engine)}`, 'good') : ''} ${own.blind ? chip(`${own.blind} not measured`, 'off') : ''} ${chip('LinkedIn by hand', 'off')}<div class="muted small" style="margin-top:4px">last EURES-off run: ${last.hand ? 'by hand' : 'night'} ${esc(last.night)} · EURES and other 3rd parties are bonuses, never in this number</div></div>${split}</div>`;
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
  return `<div id="finish-over"><h3>📈 People at the line, run by run</h3><div class="muted small">Of the ${shown[0] ? tally(shown[0]).total : 18} · grey = not measured, never a bad run · a hollow run was by hand · the top of the chart is the finish line</div>
${figure({chart: stacked(days, [{name: 'At the line', tone: 's3'}, {name: 'Found some, below the line', tone: 's1'}, {name: 'Found none', tone: 's2'}, {name: 'Not measured', tone: 'off'}], {top: tally(shown[0]).total})})}</div>`;
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
  return `<div id="finish-inout"><h3>⇄ In = out, per person (EURES)</h3><div class="muted small">In = right jobs EURES shows for the person · out = how many are in our list after one search · every missing job is counted at the stage that lost it · dashed = the floor (${Math.round(LINE * 100)}% of in) · run of ${esc(last.night)}${last.hand ? ' (by hand)' : ''}</div>${rows}
<div class="vz-legend">${['out', 'never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'not_read'].map(key => `<span><i style="background:${COLORS[key]}"></i>${esc(key)}${key === 'after_kept' ? ' (unexplained)' : ''}</span>`).join('')}</div></div>`;
}

// ---- Right jobs per person and source (2/5, owner's picture 11 Nov 2026): what each own source brought for each person; an empty cell says why, never 0 ----
const RAN_OUT_STEP = {employer_sites: 'employer sites', job_boards: 'job boards', free_job_apis: 'free job apis', web_search: 'web search'};   // the gate's words in `ranOut` (admin/search-night.js ranOutOf)
function sourceCell(row, source) {
  const item = row.sources?.[source];
  if (item && item.right != null) return `<b>${item.right}</b>`;
  if (BLIND.includes(row.kind)) return chip('not measured', 'off');
  // Why (Gitar on #549, 11 Nov 2026): the gate also lists "scoring the job boards' jobs"; a substring match flagged job boards for it, so the whole step is compared
  if ((row.ranOut || []).some(step => String(step).trim().toLowerCase() === RAN_OUT_STEP[source])) return chip('time was up before its turn', 'warn');
  return chip('not sent yet', 'off');
}
function perSource(runs) {
  const last = runs.find(run => ownOf(run));
  if (!last) return '';
  const body = last.rows.map(row => `<tr><td>${who(row.persona, row.label)}</td>${OWN.map(source => `<td class="num">${sourceCell(row, source)}</td>`).join('')}<td class="num">${chip('by hand', 'off')}</td><td class="num">${chip('not sent yet', 'off')}</td><td class="num">${chip('not sent yet', 'off')}</td></tr>`).join('');
  return `<section class="card vz" id="finish-per-person"><h2>🧩 Right jobs per person and source (our own sources)</h2><div class="muted small">A source that read nothing says why · a source's number is what it brought, so a job two sources found shows in both · LinkedIn is typed by hand, not read · Run 1 / Run 2 = new right jobs each run of the night found, not sent yet · ${last.hand ? 'by-hand run' : 'night'} ${esc(last.night)}</div>
<div class="scroll"><table><tr><th>Person</th>${OWN.map(source => `<th class="num">${esc(name(source))}</th>`).join('')}<th class="num">LinkedIn</th><th class="num">Run 1</th><th class="num">Run 2</th></tr>${body}</table></div></section>`;
}

// ---- Right jobs per night, by source group (3/5, owner's picture 11 Nov 2026): the nights that ran with EURES off, our own sources stacked; the split, a job two sources found shows in both ----
function overNights(runs) {
  const shown = runs.filter(run => ownOf(run) && run.rows.some(row => row.sources)).slice(0, 14).reverse();
  if (!shown.length) return '';
  const tones = ['s1', 's3', 's2', 's4'], days = shown.map(run => {
    const values = OWN.map(source => run.rows.reduce((sum, row) => sum + (row.sources?.[source]?.right ?? 0), 0));
    return {day: run.night, hand: run.hand, values, tip: `${run.night}${run.hand ? ' · by hand' : ''} · ${OWN.map((source, i) => `${name(source)} ${values[i]}`).join(' · ')} · each job counted once per source that found it`};
  }), top = Math.max(3, ...days.map(day => day.values.reduce((a, b) => a + b, 0)));
  return `<section class="card vz" id="finish-nights"><h2>📈 Right jobs per night, by source group</h2><div class="muted small">Our own sources only, nights with EURES off · a job two sources found shows in both groups · a hollow night was by hand · 2 runs a night (Run 1 / Run 2) arrive with the two-run night</div>
${figure({chart: stacked(days, OWN.map((source, i) => ({name: name(source), tone: tones[i]})), {top})})}</section>`;
}

// "Where the missing jobs were lost, all people" (owner, 11 Nov 2026): one bar per stage, summed over the people with a reference; the bar is the share of in, the numbers are right jobs.
function lostBlock(run) {
  const t = lostTotals(run);
  if (!t) return '';
  const stages = ['never_asked', 'ai_no', 'placed_out', 'double', 'after_kept', 'not_read'].filter(stage => t.lost[stage] > 0), bar = (key, n) => `<div class="fl-row"><div class="small">${chip(esc(key), STAGE_TONE[key] || 'good')}</div><div class="fl-bar" style="width:${Math.max(1, (n / t.in) * 100)}%"><i style="width:100%;background:${COLORS[key]}"></i></div><div class="small"><b>${n}</b> of ${t.in}${STAGE_WORDS[key] ? ` · ${esc(STAGE_WORDS[key])}` : ''}</div></div>`;
  return `<div id="finish-lost" class="fl-lost"><div class="muted small" style="margin-top:8px">Where the missing jobs were lost, all people together</div>${bar('out', t.out)}${stages.map(stage => bar(stage, t.lost[stage])).join('')}</div>`;
}

// The Side check (owner, 11 Nov 2026): what the old band, In = out and the chart said about EURES, now one small labelled card; nothing of them is dropped (the per-person bars and the run-by-run chart open under it).
function sideCheck(runs) {
  const last = runs.find(run => sideOf(run)), side = last ? sideOf(last) : null;   // Why (11 Nov 2026, review of 1/5): the newest run WITH a reference; a newer run where every `in` is 0 must not mask it
  const head = '<h2>🔍 Side check · with EURES on</h2><div class="muted small">Not in the headline: a check that our list keeps what a public database lists</div>';
  if (!side) return `<section class="card vz" id="finish-side">${head}<p>${chip('SIDE CHECK', 'warn')} <span class="muted small">no run has sent in = out yet (it starts with the next run that does)</span></p></section>`;
  const pct = side.in > 0 ? Math.round((side.out / side.in) * 100) : null;
  return `<section class="card vz" id="finish-side">${head}<p>${chip('SIDE CHECK', 'warn')} with EURES on, our list keeps <b>${side.out} of ${side.in}</b> of EURES's right jobs${pct == null ? '' : ` (${pct}%)`} · ${side.atLine} of ${side.referenced} people with a reference at the line (${Math.round(LINE * 100)}%+) · run of ${esc(last.night)}${last.hand ? ' (by hand)' : ''}</p>
${lostBlock(last)}
<details class="vz-more"><summary>Per person, and run by run</summary>${overTime(runs)}${inout(runs)}</details></section>`;
}

function sourcesCard(runs) {
  const {rows, night} = sourcesOf(runs);
  const body = rows.map(row => `<tr><td><b>${esc(name(row.source))}</b>${OWN.includes(row.source) ? '' : ` ${chip('SIDE CHECK', 'warn')}`}</td><td class="num">${num(row.right)}</td><td class="num">${row.share == null ? '–' : `<b>${Math.round(row.share * 100)}%</b><span class="fl-share" style="width:${Math.max(2, Math.round(row.share * 90))}px"></span>`}</td><td class="num">${num(row.only)}</td><td class="num">${num(row.fit70)}</td><td class="num">${row.seconds == null ? '–' : `${row.seconds} s`}</td><td class="num">${row.people} of ${row.measured}</td><td class="num">${row.average == null ? '–' : `${row.average} <span class="muted small">(${row.runs} run${row.runs === 1 ? '' : 's'})</span>`}</td></tr>`).join('');
  return `<section class="card vz" id="finish-sources"><h2>🧩 Sources · what each one is worth</h2><div class="muted small">Right jobs = role AND place, by the blind judge · the last run${night ? ` (${esc(night)})` : ''} and the average of up to 7 runs · the share is over our own sources only (EURES is a side check) · a new source appears here by itself when its words are in a row · "not sent yet" is never a 0 · the 18 people never read LinkedIn (its share will come from real installs only, k of 3)</div>
${rows.length ? `<table><tr><th>Source</th><th class="num">Right jobs</th><th class="num">Share</th><th class="num">Only it brought</th><th class="num">Fit 70+</th><th class="num">Seconds</th><th class="num">People served</th><th class="num">Average</th></tr>${body}</table>` : '<p class="muted">No run has sent per-source counts yet.</p>'}</section>`;
}

const NUMBER_WORDS = {right: 'right jobs', eures_inout: 'EURES in = out share', first_s: 'seconds to first job'};
const CEILING = {first_s: true};   // lower is better: its "floor" is a ceiling
const whoIn = (persona, labels) => who(persona, labels[persona]);
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th')}`;
const percent = (item, places) => `${Math.round(item * 10 ** (places + 2)) / 10 ** places}%`;
// eures_inout is a fraction 0-1 (cr): shown as a percent; `other` is the figure it is read against (now vs floor): when both would print the same, one more decimal tells them apart (Gitar on #527, 10 Nov 2026: 0.9996 against a floor of 1 read "100%" twice on a red row)
const value = (item, number, other) => {
  if (item == null) return '–';
  if (number !== 'eures_inout') return String(item);
  return other != null && item !== other && percent(item, 1) === percent(other, 1) ? percent(item, 2) : percent(item, 1);
};

// ---- Floors card (cr's G2, 10 Nov 2026; admin/search-floors.js keeps the fields, this draws them as sent and computes nothing) ----
/** One red row in cr's words: "p3 · right jobs 0, floor 4 · 2nd night under" (the merges since the last green come once under the list). */
function redRow(item, labels) {
  const word = CEILING[item.number] ? 'ceiling' : 'floor';
  return `<li>${whoIn(item.persona, labels)} · ${esc(NUMBER_WORDS[item.number])} ${value(item.now, item.number, item.floor)}, ${word} ${value(item.floor, item.number, item.now)} · ${item.below == null ? 'nights under not sent' : `${ordinal(item.below)} night under`}</li>`;
}

/**
 * The card.
 * @param {object[]} runs nights and by-hand runs, newest first (each may carry `floors` and `measure`)
 */
export function floorsCard(runs) {
  const run = runs.find(item => item.floors && !item.hand) || runs.find(item => item.floors), floors = run?.floors,   // Why (code review of #527, 10 Nov 2026): the last NIGHT decides; a by-hand run (never judged, never alerted) must not hide its red rows with "not checked"
   labels = Object.fromEntries((run?.rows || []).map(row => [row.persona, row.label]));
  const head = '<h2>🧱 Floors that only rise</h2>';
  const note = `<div class="muted small">A floor is the best a person's number held for 3 measured nights; red = under it beyond the spread two nights in a row, on a scheduled night on the locked chain · for seconds to first job the line is a ceiling · the alert is the check's, not this card's</div>`;
  if (!floors) return `<section class="card vz" id="finish-floors">${head}${note}<p>${chip('not sent yet', 'off')} <span class="muted small">no run has sent floors yet</span></p></section>`;
  const where = `<span class="muted small">${run.hand ? 'by-hand run' : 'night'} ${esc(run.night)}${run.measure ? ` · measure ${esc(run.measure)}` : ''}</span>`;
  if (!floors.checked) return `<section class="card vz" id="finish-floors">${head}${note}<p>${chip(`floors: not checked${floors.why ? ` (${esc(floors.why)})` : ''}`, 'off')} ${where}</p></section>`;
  const persons = Object.keys(floors.levels).sort((a, b) => a - b), set = persons.reduce((total, key) => total + Object.values(floors.levels[key]).filter(item => item.floor != null).length, 0);
  const verdict = floors.red.length || floors.unreadable ? chip(`${floors.red.length + floors.unreadable} under the floor${floors.unreadable ? ` (${floors.unreadable} not readable here)` : ''}`, 'bad') : set ? chip('all above their floors', 'good') : chip('no floor to hold yet', 'off');
  const green = floors.last_green ? `last green run ${esc(floors.last_green.run)}${floors.last_green.sha ? ` (${esc(floors.last_green.sha.slice(0, 7))})` : ''}` : 'no green run known';
  const table = persons.length ? `<details class="vz-more"><summary>All floors (${set} set)</summary><div class="scroll"><table><tr><th>Person</th>${Object.values(NUMBER_WORDS).map(word => `<th class="num">${esc(word)} · now / floor</th>`).join('')}</tr>${persons.map(key => `<tr><td>${whoIn(key, labels)}</td>${Object.keys(NUMBER_WORDS).map(number => { const item = floors.levels[key][number]; return `<td class="num">${item ? `${value(item.now, number, item.floor)} / ${item.floor == null ? '<span class="muted">no floor yet</span>' : value(item.floor, number, item.now)}` : '–'}</td>`; }).join('')}</tr>`).join('')}</table></div></details>` : '';
  return `<section class="card vz" id="finish-floors">${head}${note}<p>${verdict} ${set ? chip(`${set} floors set`, 'off') : chip('no floor yet: it needs 3 measured nights', 'off')} ${where} <span class="muted small">· ${green}</span></p>
${floors.red.length ? `<ul>${floors.red.map(item => redRow(item, labels)).join('')}</ul>${floors.merges.length ? `<div class="small">Merges since the last green: ${floors.merges.map(esc).join('; ')}</div>` : ''}` : ''}${table}</section>`;
}

// ---- Market coverage (mc's 5/5, 10 Nov 2026): the weekly reference's market count against the newest run, and what each source read there ----
const KIND_TONE = {counted: 'good', partial: 'warn', 'not-counted': 'off', none: 'off', 'by-hand': 'off'};
const KIND_WORDS = {counted: 'counted', partial: 'partial', 'not-counted': 'not counted', none: 'none', 'by-hand': 'by hand'};
const cell = value => (value == null ? '<span class="muted">–</span>' : Number(value).toLocaleString('en-US'));   // a source nobody counted has no number: a dash, never 0
function marketCard(runs, ref) {
  const run = runs.find(item => item.eures === 'off') || runs[0] || null, c = coverage(ref, run);   // Why (11 Nov 2026, sa): our own result, the EURES-off nights, is the default
  const head = '<h2>🌍 Market coverage</h2><div class="muted small">Right jobs that exist for the people, counted once (the weekly reference), against our list after the newest run · per source: what it read and found there · "not counted" is never a 0 · LinkedIn is typed by hand (not yet)</div>';
  if (!c.people || !c.sources.length) return `<section class="card vz" id="finish-market">${head}<p>${chip('not sent yet', 'off')} <span class="muted small">the weekly reference has sent no per-source rows yet</span></p></section>`;
  const pct = c.ours != null && c.oursOf > 0 ? Math.round((c.ours / c.oursOf) * 100) : null;
  const body = c.sources.map(row => `<tr><td><b>${esc(name(row.source))}</b>${OWN.includes(row.source) ? '' : ` ${chip('SIDE CHECK', 'warn')}`}</td><td>${Object.entries(row.kinds).map(([kind, n]) => chip(`${n} ${KIND_WORDS[kind]}`, KIND_TONE[kind])).join(' ')}</td><td class="num">${cell(row.read)}</td><td class="num">${cell(row.right)}</td><td class="num">${cell(row.only)}</td></tr>`).join('');
  return `<section class="card vz" id="finish-market">${head}<p>${chip(`market ${c.market == null ? 'not counted' : Number(c.market).toLocaleString('en-US')} right jobs · ${c.counted} of ${c.people} people`, 'good')} ${pct == null ? chip('our share: no measured person in the reference', 'off') : chip(`our list holds ${c.ours} of ${c.oursOf} (${pct}%) · ${c.measured} measured ${c.measured === 1 ? 'person' : 'people'}`, pct >= 95 ? 'good' : 'warn')} ${c.countedOn ? `<span class="muted small">counted ${esc(c.countedOn)}</span>` : ''}${run && run.eures !== 'off' ? ` ${chip('this run had EURES on: our list includes its jobs', 'off')}` : ''}</p>
<table><tr><th>Source</th><th>People</th><th class="num">Read</th><th class="num">Right</th><th class="num">Only it found</th></tr>${body}</table></section>`;
}

// Reached stays blank until the owner decides what counts (owner, 11 Nov 2026, via sa): not drawn as a number, so nothing reads as reached or not reached.
const reachedCard = () => '<section class="card vz" id="finish-reached" style="border:2px dashed #5b6670"><h2>🏁 Reached</h2><p class="muted">Blank, to be decided by the owner: what counts as "reached" (all people? only people with a reference? with how many not measured?). Not drawn until then.</p></section>';

/**
 * The tab's body.
 * @param {object[]|null} judged the stored nights, newest first (admin/search-night-judge.js judgeAll); null = unreadable
 * @param {object[]} [hand] the by-hand full runs (admin/search-night-hand.js)
 * @param {object} [ref] the weekly reference (reference() in admin/search-night.js)
 */
export function finishSection(judged, hand = [], ref = {}) {
  if (!judged) return '<section class="card"><h2>The nights could not be read</h2><p class="muted">The store of the nightly Search check did not answer, so this tab cannot draw the finish line.</p></section>';
  const runs = runsOf(judged, hand);
  return `${band(runs)}${perSource(runs)}${overNights(runs)}${floorsCard(runs)}${weakCard(runs)}${sideCheck(runs)}${sourcesCard(runs)}${marketCard(runs, ref)}${reachedCard()}${VIZ_TOOLTIP}`;
}
