// The "Night search" tab of /admin/job-search/lab (owner, 6 Nov 2026: "the nightly search persona... I see nowhere in Admin... Where should I see it the search dropped?"): the newest night first, red with the
// reasons when it dropped (admin/search-night-judge.js, the same verdict the alert and the Report only chip read), every fictional candidate as a row with its three yardsticks (the floor: measured, its own 7 nights: usual, the reference: a separate EURES total), what time ran out for, and the last 14 nights as a strip.
// Counts, seconds and the gate's fixed words only (admin/search-night.js); every value is escaped. Guard: test/unit/admin/search/search-night.test.js.
import {esc} from '../shared/html.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';
import {CHIP_STYLE, chip} from './chip.js';
import {COUNTERS} from './search-night-counters.js';
import {EMPLOYER_SITES, HISTORY, SPREADS, euresOf, reasonWords} from './search-night-judge.js';
import {stepYieldSection} from './search-night-yield.js';
import {PLACE_STYLE, placeSection} from './search-night-place.js';
import {TREND_STYLE, trendSection} from './search-night-trend.js';
import {VIZ_STYLE, VIZ_TOOLTIP} from './viz.js';

export const NIGHT_CSS = `${CHIP_STYLE}${BAND_STYLE}${VIZ_STYLE}${TREND_STYLE}${PLACE_STYLE}
.nstrip{display:flex;align-items:flex-end;gap:3px;height:56px}.nstrip i{display:block;flex:1;background:#5fb3ff;opacity:.75;border-radius:2px 2px 0 0}.nstrip i.weak{background:#ff8a80;opacity:1}
.nwrap{display:flex;flex-direction:column;gap:6px}.nsteps{display:flex;gap:4px;flex-wrap:wrap}`;

// What the gate's row kind means for the owner: measured = at least one right job; the others say why the row is not a pass.
const KIND = {measured: ['✓ measured', 'good'], 'none-right': ['! scored, none right', 'warn'], nothing: ['✕ nothing scored', 'bad'], unmeasured: ['– not measured', 'off'], fault: ['✕ fault', 'bad'], unknown: ['– unknown', 'off']};
const kindChip = kind => chip(...KIND[kind] || KIND.unknown);
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const seconds = value => (value == null ? '–' : `${value} s`);

// The three yardsticks of one persona (owner, 6 Nov 2026: "how to know if it's a good or bad result?"): the floor is the result chip (measured = a right job within the press limit); `usual` its own median of the last HISTORY nights
// (shown under it, a lower night is a muted note, never an alarm on its own); the reference `ref` = {total, reachable, eures, google?} counts of right local jobs EURES lists (google only in an older record) (admin/search-night.js reference()).
const sinceUsual = row => (row.usual == null ? '<span class="muted">usual: after 7 nights</span>' : `<span class="muted">usual ${num(row.usual)}</span>${isNum(row.local) && row.local < row.usual ? ` ${chip('↓ under its usual', 'warn')}` : ''}`);
const isNum = value => typeof value === 'number' && Number.isFinite(value);
// Why (10 Nov 2026, owner: "as good as EURES, without using EURES"): with EURES off our total holds none of EURES's jobs, so the two counts side by side read as ours against EURES (still not an overlap).
const ours = (row, ref, eures) => (eures === 'off' && ref?.total && isNum(row.local) ? `<div><b>Ours ${num(row.local)} of EURES ${num(ref.total)}</b></div>` : '');
const reference = (row, ref) => (!ref ? '<span class="muted">no reference yet</span>'
  : ref.total === 0 && ref.eures === 0 ? '<span class="muted">EURES lists none</span>'   // Why (6 Nov 2026, coordinator): a stored 0 with EURES's own count 0 is a real read (EURES lists no right job for that region and role), not a failed one; a 0 without it claims nothing
    : !ref.total ? '<span class="muted">no reference</span>'
    : ref.google == null ? `EURES reference: ${num(ref.total)}`   // Why (10 Nov 2026, owner): our total includes EURES; two totals do not measure overlap or coverage
      : `Reference: ${num(ref.total)}<div class="why">${num(ref.reachable)} reachable · EURES ${num(ref.eures)} · Google Jobs ${num(ref.google)}</div>`);
// The press's step counters beside the separate EURES reference (brief step 2, 6 Nov 2026: "EURES lists 19, our read listed A, we scored B"): a muted line, a counter that fell beyond its own spread is a warn chip with its usual; none for a row without counters.
const counterLine = row => (!row.counters ? '' : `<div class="why">${COUNTERS.map(item => {
  const value = row.counters[item.key], words = `${item.cell} ${value == null ? 'none' : `${num(value)}${item.unit || ''}`}`;
  return (row.drops || []).includes(item.key) ? chip(esc(`${words} · usual ${num(row.counterUsual[item.key])}${item.unit || ''}`), 'warn') : esc(words);
}).join(' · ')}</div>`);
const sourceLine = row => row.relevantSources ? `<div class="why">From EURES: ${num(row.relevantSources.eures)} · From other sources: ${num(row.relevantSources.other)} · Unknown source: ${num(row.relevantSources.unknown)}</div>` : '<div class="why">Source breakdown not recorded</div>';
const personaRow = (row, refs = {}, eures = 'on') => `<tr><td><b>${esc(row.label)}</b></td><td>${kindChip(row.kind)}${row.why ? `<div class="why">${esc(row.why)}</div>` : ''}</td><td class="num">${num(row.local)} · ${num(row.found)}${sourceLine(row)}<div>${sinceUsual(row)}</div></td>`
  + `<td class="num">${ours(row, refs[row.persona], eures)}${reference(row, refs[row.persona])}${counterLine(row)}</td><td class="num">${seconds(row.seconds)}</td>`
  + `<td><div class="nsteps">${row.ranOut.length ? row.ranOut.map(step => chip(esc(step), step === EMPLOYER_SITES ? 'bad' : 'off')).join('') : '<span class="muted">nothing</span>'}</div></td></tr>`;

// Oldest left; a bar is the share of personas measured that night, red when the night dropped.
const strip = shown => `<div class="nwrap"><div class="nstrip" aria-label="personas measured per night">${[...shown].reverse().map(night => `<i class="${night.dropped ? 'weak' : ''}" style="height:${Math.max(4, Math.round(100 * night.measured / Math.max(1, night.total)))}%" title="${esc(`${night.night}: measured ${night.measured} of ${night.total}`)}"></i>`).join('')}</div>`
  + '<span class="muted">personas measured per night, last 14 (red = dropped)</span></div>';

const nightRow = night => `<tr><td>${esc(night.night)}${night.run ? ` <a class="muted" href="https://github.com/jobadabra/jobadabra/actions/runs/${esc(night.run)}">run ${esc(night.run)}</a>` : ''}</td><td class="num">${night.measured} of ${night.total}</td><td class="num">${num(night.local)}</td>`
  + `<td class="num">${seconds(night.seconds)}</td><td class="num">${night.out} of ${night.total}</td><td>${night.dropped ? chip('✕ dropped', 'bad') : chip('✓ fine', 'good')}${night.reasons.length ? `<div class="why">${reasonWords(night).map(esc).join('<br>')}</div>` : ''}</td></tr>`;

/**
 * The tab's body.
 * @param {object[]|null} judged the stored nights (null = the store could not be read), newest first, each judged (admin/search-night-judge.js judgeAll)
 * @param {object} [refs] the latest weekly reference per persona id, {<persona>: {total, reachable, eures, google}}; {} until the weekly job has run
 * @returns {string} HTML; with no night, a card that says nothing was uploaded yet (never a row of zeros)
 */
export function nightSection(judged, refs = {}) {
  if (!judged) return '<section class="card"><h2>The nights could not be read</h2><p class="muted">The store of the nightly Search check did not answer, so this tab cannot say whether a night dropped. Reload in a minute; the Worker log names the cause.</p></section>';
  if (!judged.length) return '<section class="card"><h2>No night uploaded yet</h2><p class="muted">The nightly Search check (<code>search-personas.yml</code>, the fixed set of fictional candidates) uploads its verdict here when it ends. Until it does, nothing is measured: no row below stands in for it.</p></section>';
  const [last] = judged, shown = judged.slice(0, 14);
  const band = verdictBand({icon: last.dropped ? '🔴' : '🟢', headline: `Night ${last.night}: measured ${last.measured} of ${last.total}`,
    chips: [...(euresOf(last) === 'off' ? [{label: 'EURES off: our own sources only', tone: 'off', title: 'this night ran without EURES; it is compared with EURES-off nights only'}] : []), ...(last.dropped ? reasonWords(last).map(label => ({label, tone: 'bad'})) : [{label: 'nothing dropped', tone: 'good'}]), ...last.notes.map(label => ({label, tone: 'warn', title: 'a step counter fell beyond its own spread: report only, the night is not dropped for it'}))],
    note: last.head.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, '') || 'the check\'s own line was empty'});
  return `${band}
<section class="card"><h2>The ${last.total} candidates, night ${esc(last.night)}</h2><div class="scroll"><table><tr><th>Candidate</th><th>Result</th><th class="num">Relevant local · found</th><th class="num">Separate reference</th><th class="num">Press</th><th>Time ran out for</th></tr>${last.rows.map(row => personaRow(row, refs, euresOf(last))).join('')}</table></div>
<p class="muted">${last.out ? `On this night time ran out for employer sites in ${last.out} of ${last.total} personas.` : 'On this night employer sites were read in every persona.'}</p></section>
${placeSection(judged)}${stepYieldSection(last.rows, last.night)}${trendSection(judged)}
<section class="card"><h2>Last ${shown.length} night${shown.length === 1 ? '' : 's'}</h2>${strip(shown)}<div class="scroll"><table><tr><th>Night</th><th class="num">Measured</th><th class="num">Relevant local jobs</th><th class="num">Press (median)</th><th class="num">Employer sites out of time</th><th>Result</th></tr>${shown.map(nightRow).join('')}</table></div></section>
<section class="card"><h2>How a night is judged</h2><p class="muted">A night <b>dropped</b> when any of three things holds: fewer than two thirds of the candidates were measured (a candidate is measured when the check found at least one right job for them, within the press limit); the relevant local jobs of all candidates, added up, fell below the median of the last ${HISTORY} nights with the same candidates minus ${SPREADS} spreads (the same rule the PR gate uses, a spread being the standard deviation of those nights; silent until ${HISTORY} earlier nights are stored); or time ran out for employer sites in two thirds or more of the candidates. Each candidate also shows its own usual (its median of those nights) and, once the weekly reference has run, a separate count of right local jobs EURES lists (read outside the app). Our total includes EURES, except on a night marked <b>EURES off: our own sources only</b>: there the reference reads <b>Ours N of EURES X</b>, and the night is compared only with other nights without EURES. The source breakdown counts judged relevant results from each source category; jobs from other sources may also exist on EURES. These totals do not measure overlap or coverage. Paired comparisons with the EURES reader disabled are reported separately in Search check run summaries when requested. A candidate under its own usual is shown, never alarmed on its own. Under each reference the step counters of that candidate's press are listed (<b>EU portal jobs our read listed</b>, <b>employer sites read</b>, <b>titles asked</b>, <b>AI calls</b>, <b>seconds to the first job</b>); one that fell beyond the spread of its own last ${HISTORY} nights is marked with its usual and named in the head above (report only: it never drops a night by itself). A dropped night tells you once a day (Operations → Notifications, "Night search dropped"). The last 30 nights are kept; counts and seconds only, no job or company text.</p></section>`;
}
