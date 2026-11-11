// The Central Scout's card on the "Finish line" tab (owner, 11 Nov 2026, to sa: "How much the Central Scout is helping us? Do we measure this ?"; sa's go for the first figure): for each of the 18 people, the employers of the
// shared list in their places fall in four classes (jobadabra tools/persona-search/scout_list.py, agreed with the scout-kinds session, lab issue #87): no open job (empty feed), open jobs and no kind counted (THE GAP), the
// whole employer's mix only (read), counted per country. Gap share = no kind counted / (employers in places - empty feeds). Counts only: no employer name, no list-wide number (feeds served, publish id) is in a night.
// A record whose four classes do not add up to the employers in places claims nothing (null); a count that is not whole is "not sent", never 0; an undecided kind leaves K and fit / not theirs null.
// Guard: test/unit/admin/search/search-finish-scout.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {BLIND} from './search-finish.js';

export const SCOUT_STYLE = `${CHIP_STYLE}
.sc-row{display:grid;grid-template-columns:190px 1fr 330px;gap:10px;align-items:center;padding:3px 0}.sc-bar{height:16px;background:#1b2027;border-radius:4px;display:flex;overflow:hidden}.sc-bar i{display:block;height:100%}
@media(max-width:700px){.sc-row{grid-template-columns:1fr;gap:4px;padding:8px 0}}
.sc-key{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 10px}.sc-key span{display:inline-flex;gap:6px;align-items:center}.sc-key i{display:inline-block;width:10px;height:10px;border-radius:2px}`;

// The classes in the bar's order (left to right) with the colour each has on the tab: the gap is the tab's red, the empty feeds the muted "nothing to read".
const CLASSES = [['counted', 'counted per country', 'var(--s3)'], ['mixOnly', 'whole mix only (read)', 'var(--s1)'], ['noKind', 'no kind counted (the gap)', '#ff5a4f'], ['empty', 'no open job', 'var(--off)']];
const whole = value => (Number.isInteger(value) && value >= 0 && value <= 1e7 ? value : null);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const num = value => (value == null ? '<span class="chip off">not sent</span>' : Number(value).toLocaleString('en-US'));
const who = (persona, label) => `<b>p${esc(persona)}</b> ${esc(String(label || '').replace(/^p\d+ /, ''))}`;
const pct = share => `${Math.round(share * 100)}%`;

/**
 * A verdict row's `scout` -> {inPlaces, empty, noKind, mixOnly, counted, forRole, fits, notTheirs, kindsKnown, listed, right, employersRight}, whole numbers (forRole, fits, notTheirs null while the person's kind was not decided),
 * or null when the row sent none or its four classes do not add up to the employers in places (then it claims nothing).
 */
export function cleanScout(raw) {
  if (!plain(raw)) return null;
  const [inPlaces, empty, noKind, mixOnly, counted] = ['in_places', 'empty_feeds', 'no_kind_mix', 'mix_only', 'counted_per_country'].map(key => whole(raw[key]));
  if ([inPlaces, empty, noKind, mixOnly, counted].includes(null) || empty + noKind + mixOnly + counted !== inPlaces) return null;
  const known = raw.kinds_known === true, [forRole, fits, notTheirs] = ['for_role', 'fit_their_kind', 'kind_not_theirs'].map(key => (known ? whole(raw[key]) : null));
  return {inPlaces, empty, noKind, mixOnly, counted, forRole, fits, notTheirs, kindsKnown: known, listed: whole(raw.listed_from_list), right: whole(raw.right_from_list), employersRight: whole(raw.employers_right_from_list)};
}

/** The gap share of one person: employers with open jobs and no counted kind over all employers with open jobs; null without a record or without an employer with open jobs. */
export const gapOf = scout => (scout && scout.inPlaces > scout.empty ? scout.noKind / (scout.inPlaces - scout.empty) : null);

const median = values => {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b);
  return sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
};

/** The people of a run that sent a record, and the median gap over them: {people: [{persona, label, scout, blind}], measured, median, medianEmpty}. */
export function scoutOf(run) {
  const people = (run?.rows || []).map(row => ({persona: row.persona, label: row.label, scout: BLIND.includes(row.kind) ? null : row.scout ?? null, blind: BLIND.includes(row.kind)}));
  const sent = people.filter(person => person.scout);
  return {people, measured: sent.length, median: median(sent.map(person => gapOf(person.scout))), medianEmpty: median(sent.map(person => (person.scout.inPlaces ? person.scout.empty / person.scout.inPlaces : null)))};
}

function bar(scout) {
  const total = scout.inPlaces || 1;
  return `<div class="sc-bar">${CLASSES.map(([key, name, colour]) => (scout[key] ? `<i title="${esc(name)}: ${scout[key]}" style="width:${(100 * scout[key]) / total}%;background:${colour}"></i>` : '')).join('')}</div>`;
}

function rowOf(person) {
  const left = who(person.persona, person.label);
  if (person.blind) return `<div class="sc-row"><div>${left}</div><div class="fl-blind" style="height:16px;border-radius:4px"></div><div>${chip('not measured', 'off')}</div></div>`;
  const s = person.scout;
  if (!s) return `<div class="sc-row"><div>${left}</div><div class="sc-bar"></div><div>${chip('not sent', 'off')}</div></div>`;
  const gap = gapOf(s);
  const fit = s.fits == null ? 'kind not decided' : `${num(s.fits)} fit their kind · ${num(s.notTheirs)} do not`;
  return `<div class="sc-row"><div>${left}</div>${bar(s)}<div class="muted small">${num(s.inPlaces)} in places · gap ${gap == null ? '–' : pct(gap)} of ${num(s.inPlaces - s.empty)} with jobs · ${fit}${s.forRole == null ? '' : ` · read ${num(s.forRole)}`}</div></div>`;
}

/**
 * The Central Scout's card.
 * @param {object[]} runs the tab's runs, newest first (nights and by-hand runs); the newest one whose rows carry a `scout` is drawn
 */
export function scoutCard(runs) {
  const title = '<h2>🔎 The Central Scout: where its list is lost</h2>';
  const run = (runs || []).find(item => (item.rows || []).some(row => row.scout)), view = run ? scoutOf(run) : null;
  if (!view) {
    return `<section class="card vz" id="finish-scout">${title}<p class="muted">${chip('not sent yet', 'off')} No night has sent the list's counts yet: the first night after jobadabra #3809 does. For each person this will show how many of the list's employers in their places have no open job, no counted kind of jobs (the gap), only a whole-employer mix (read), or per-country counts.</p></section>`;
  }
  const head = view.median == null ? `<div class="fl-big">–</div>` : `<div class="fl-big">${pct(view.median)}</div>`;
  const key = CLASSES.map(([, name, colour]) => `<span><i style="background:${colour}"></i>${esc(name)}</span>`).join('');
  return `<section class="card vz" id="finish-scout">${title}<div class="fl-band"><div>${head}<div class="muted small">of the employers with open jobs in a person's places have no counted kind (the gap; median of ${view.measured} people)</div></div>
<div><div class="fl-big">${view.medianEmpty == null ? '–' : pct(view.medianEmpty)}</div><div class="muted small">of all the employers in their places list no open job: nothing to read, not a gap</div></div></div>
<div class="muted small">Night of ${esc(run.night)}${run.hand ? ' · by hand' : ''} · one bar per person: the employers of the shared list in their places · "read" = what Find jobs reads for their kind of role</div>
<div class="sc-key small">${key}</div>${view.people.map(rowOf).join('')}</section>`;
}
