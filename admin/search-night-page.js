// The "Night search" tab of /admin/job-search/lab (owner, 6 Nov 2026: "the nightly search persona... I see nowhere in Admin... Where should I see it the search dropped?"): the newest night first, red with the
// reasons when it dropped (admin/search-night-judge.js, the same verdict the alert and the Report only chip read), the six fictional candidates as chips, what time ran out for, and the last 14 nights as a strip.
// Counts, seconds and the gate's fixed words only (admin/search-night.js); every value is escaped. Guard: test/unit/admin/search/search-night.test.js.
import {esc} from '../shared/html.js';
import {BAND_STYLE, verdictBand} from './verdict-band.js';
import {CHIP_STYLE, chip} from './chip.js';
import {EMPLOYER_SITES, HISTORY, MIN_MEASURED, OUT_MIN, SPREADS, reasonWords} from './search-night-judge.js';

export const NIGHT_CSS = `${CHIP_STYLE}${BAND_STYLE}
.nstrip{display:flex;align-items:flex-end;gap:3px;height:56px}.nstrip i{display:block;flex:1;background:#5fb3ff;opacity:.75;border-radius:2px 2px 0 0}.nstrip i.weak{background:#ff8a80;opacity:1}
.nwrap{display:flex;flex-direction:column;gap:6px}.nsteps{display:flex;gap:4px;flex-wrap:wrap}`;

// What the gate's row kind means for the owner: measured = at least one right job; the others say why the row is not a pass.
const KIND = {measured: ['✓ measured', 'good'], 'none-right': ['! scored, none right', 'warn'], nothing: ['✕ nothing scored', 'bad'], unmeasured: ['– not measured', 'off'], fault: ['✕ fault', 'bad'], unknown: ['– unknown', 'off']};
const kindChip = kind => chip(...KIND[kind] || KIND.unknown);
const num = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const seconds = value => (value == null ? '–' : `${value} s`);

const personaRow = row => `<tr><td><b>${esc(row.label)}</b></td><td>${kindChip(row.kind)}${row.why ? `<div class="why">${esc(row.why)}</div>` : ''}</td><td class="num">${num(row.local)} · ${num(row.found)}</td><td class="num">${seconds(row.seconds)}</td>`
  + `<td><div class="nsteps">${row.ranOut.length ? row.ranOut.map(step => chip(esc(step), step === EMPLOYER_SITES ? 'bad' : 'off')).join('') : '<span class="muted">nothing</span>'}</div></td></tr>`;

// Oldest left; a bar is the share of personas measured that night, red when the night dropped.
const strip = shown => `<div class="nwrap"><div class="nstrip" aria-label="personas measured per night">${[...shown].reverse().map(night => `<i class="${night.dropped ? 'weak' : ''}" style="height:${Math.max(4, Math.round(100 * night.measured / Math.max(1, night.total)))}%" title="${esc(`${night.night}: measured ${night.measured} of ${night.total}`)}"></i>`).join('')}</div>`
  + '<span class="muted">personas measured per night, last 14 (red = dropped)</span></div>';

const nightRow = night => `<tr><td>${esc(night.night)}${night.run ? ` <a class="muted" href="https://github.com/jobadabra/jobadabra/actions/runs/${esc(night.run)}">run ${esc(night.run)}</a>` : ''}</td><td class="num">${night.measured} of ${night.total}</td><td class="num">${num(night.local)}</td>`
  + `<td class="num">${seconds(night.seconds)}</td><td class="num">${night.out} of ${night.total}</td><td>${night.dropped ? chip('✕ dropped', 'bad') : chip('✓ fine', 'good')}${night.reasons.length ? `<div class="why">${reasonWords(night).map(esc).join('<br>')}</div>` : ''}</td></tr>`;

/**
 * The tab's body.
 * @param {object[]|null} judged the stored nights (null = the store could not be read), newest first, each judged (admin/search-night-judge.js judgeAll)
 * @returns {string} HTML; with no night, a card that says nothing was uploaded yet (never a row of zeros)
 */
export function nightSection(judged) {
  if (!judged) return '<section class="card"><h2>The nights could not be read</h2><p class="muted">The store of the nightly Search check did not answer, so this tab cannot say whether a night dropped. Reload in a minute; the Worker log names the cause.</p></section>';
  if (!judged.length) return '<section class="card"><h2>No night uploaded yet</h2><p class="muted">The nightly Search check (<code>search-personas.yml</code>, six fictional candidates) uploads its verdict here when it ends. Until it does, nothing is measured: no row below stands in for it.</p></section>';
  const [last] = judged, shown = judged.slice(0, 14);
  const band = verdictBand({icon: last.dropped ? '🔴' : '🟢', headline: `Night ${last.night}: measured ${last.measured} of ${last.total}`,
    chips: last.dropped ? reasonWords(last).map(label => ({label, tone: 'bad'})) : [{label: 'nothing dropped', tone: 'good'}],
    note: last.head.replace(/^[\p{Extended_Pictographic}‍️\s]+/u, '') || 'the check\'s own line was empty'});
  return `${band}
<section class="card"><h2>The six candidates, night ${esc(last.night)}</h2><div class="scroll"><table><tr><th>Candidate</th><th>Result</th><th class="num">Relevant local · found</th><th class="num">Press</th><th>Time ran out for</th></tr>${last.rows.map(personaRow).join('')}</table></div>
<p class="muted">${last.out ? `On this night time ran out for employer sites in ${last.out} of ${last.total} personas.` : 'On this night employer sites were read in every persona.'}</p></section>
<section class="card"><h2>Last ${shown.length} night${shown.length === 1 ? '' : 's'}</h2>${strip(shown)}<div class="scroll"><table><tr><th>Night</th><th class="num">Measured</th><th class="num">Relevant local jobs</th><th class="num">Press (median)</th><th class="num">Employer sites out of time</th><th>Result</th></tr>${shown.map(nightRow).join('')}</table></div></section>
<section class="card"><h2>How a night is judged</h2><p class="muted">A night <b>dropped</b> when any of three things holds: fewer than ${MIN_MEASURED} of the six candidates were measured (a candidate is measured when the check found at least one right job for them); the relevant local jobs of all six, added up, fell below the median of the last ${HISTORY} nights minus ${SPREADS} spreads (the same rule the PR gate uses, a spread being the standard deviation of those nights; silent until ${HISTORY} earlier nights are stored); or time ran out for employer sites in ${OUT_MIN} or more candidates. A dropped night tells you once a day (Operations → Notifications, "Night search dropped"). The last 30 nights are kept; counts and seconds only, no job or company text.</p></section>`;
}
