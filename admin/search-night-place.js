// The Night search tab's "Jobs in the right place" card (owner, 10 Nov 2026: "How can I follow to understand if our search algoritm finds jobs out of the location"; a Dublin search listed 24 of 25 jobs in other countries
// and no screen said so): per candidate, how many of the listed jobs the blind judge called in the right place, worst first, and one line over the nights for all candidates added up. A job counts as right only on the judge's
// "yes": remote, unsure and not-judged jobs are named apart, never added to the right ones. Counts only (admin/search-night.js verdictCounts); a night without them is a gap in the line, never a 0.
// Wording: "listed jobs" are the jobs the night's search found and the judge rated (jobadabra tools/persona-search/gate.py). Pure. Guard: test/unit/admin/search/search-night-place.test.js.
import {esc} from '../shared/html.js';
import {CHIP_STYLE, chip} from './chip.js';
import {figure, line} from './viz.js';

/**
 * The place numbers of one candidate row: {yes, listed, share, other, remote, unsure, unjudged, wrongRole} or null when the row carries no verdict counts or none of its jobs was judged.
 * @param {object} row a stored night row (admin/search-night.js clean)
 */
export function placeOf(row) {
  const place = row?.place;
  if (!place) return null;
  const listed = place.yes + place.no + place.remote + place.unknown + place.unjudged, judged = listed - place.unjudged;
  if (!judged) return null;
  return {yes: place.yes, listed, share: place.yes / listed, other: place.no, remote: place.remote, unsure: place.unknown, unjudged: place.unjudged, wrongRole: row.role ? row.role.no : null};
}

/** The words of one candidate's chip, e.g. "3 of 25 listed jobs in the right place". */
export const placeWords = place => `${place.yes} of ${place.listed} listed jobs in the right place`;

const detail = place => [`${place.other} in another place`, ...(place.remote ? [`${place.remote} remote`] : []), ...(place.unsure ? [`${place.unsure} unsure`] : []), ...(place.unjudged ? [`${place.unjudged} not judged`] : []),
  ...(place.wrongRole == null ? [] : [`${place.wrongRole} wrong role`])].join(' · ');

// Worst share first; a candidate with more listed jobs first on a tie (a bigger miss); a candidate without counts is left out of the list and named in the note.
const worstFirst = (a, b) => a.place.share - b.place.share || b.place.listed - a.place.listed || a.row.persona - b.row.persona;

/** The candidates of one night that have place counts, worst first: [{row, place}]. */
export function ranked(night) {
  return (night?.rows || []).map(row => ({row, place: placeOf(row)})).filter(item => item.place).sort(worstFirst);
}

/** All candidates of a night added up: {yes, listed, share, people} or null when no candidate has counts. */
export function totalOf(night) {
  const list = ranked(night);
  if (!list.length) return null;
  const yes = list.reduce((sum, item) => sum + item.place.yes, 0), listed = list.reduce((sum, item) => sum + item.place.listed, 0);
  return {yes, listed, share: listed ? yes / listed : null, people: list.length};
}

const tone = share => (share >= 0.8 ? 'good' : share >= 0.5 ? 'warn' : 'bad');   // a colour for reading at a glance, never a verdict: the night's drop judgement does not read it

/**
 * The card; '' while no stored night carries place counts (the tab stays as it was: the nights from before the counts are not claimed to be anything).
 * @param {object[]|null} judged the judged nights, newest first (admin/search-night-judge.js judgeAll)
 */
export function placeSection(judged) {
  const nights = (judged || []).filter(night => totalOf(night));
  if (!nights.length) return '';
  const [last] = nights, list = ranked(last), without = last.rows.length - list.length, all = totalOf(last);
  const chips = list.map(({row, place}) => `<div class="why" style="margin:3px 0"><b>${esc(row.label)}</b> ${chip(esc(placeWords(place)), tone(place.share))} <span class="muted">${esc(detail(place))}</span></div>`).join('');
  const span = judged.slice(0, 14).reverse().map(night => {   // a stored night without counts is a gap in the line, never a 0
    const total = totalOf(night);
    return {day: night.night, value: total ? Math.round(100 * total.share) : null, tip: total ? `${night.night} · ${total.yes} of ${total.listed} listed jobs in the right place (${total.people} candidates)` : `${night.night} · no place counts on this night`};
  });
  return `<section class="card" id="night-place"><h2>📍 Jobs in the right place</h2>
<p class="muted small" style="margin:0">${esc(`Night ${last.night}: ${all.yes} of ${all.listed} listed jobs in the right place, the ${all.people} candidates with judged jobs added up. Worst candidates first. A job counts only when the blind judge says yes; remote, unsure and not-judged jobs are named apart.`)}</p>
<div style="margin:8px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:0 18px">${chips}</div>${without ? `<p class="muted small">${without} candidate${without === 1 ? ' has' : 's have'} no judged place counts on this night.</p>` : ''}
<p class="muted small" style="margin:8px 0 0">Share of listed jobs in the right place, night by night (%)</p>${figure({chart: line(span, {tone: 's1', percent: true, name: 'Listed jobs in the right place', labelEvery: Math.max(1, Math.ceil(span.length / 7))})})}</section>`;
}

/** The card's own style: the chips it draws (the guard test/unit/shared/admin-chips.test.js wants the style named in the file that draws chips). */
export const PLACE_STYLE = `${CHIP_STYLE}`;
