// Demo data for the Night search Scoreboard card (10 Nov 2026, [oe]): MADE-UP nights, fixed dates so the EURES break (11 Nov) falls inside them. 27 Oct-10 Nov with EURES (14 to 17 of 18 people with a right job, one blind
// night, one missing day), 11-18 Nov without it (7 climbing to 12), the AI named by the rows from 12 Nov, and two by-hand full runs (one beside a night, one on a day with none). Nothing here is a real person or a real count.
import {readFileSync} from 'node:fs';
import {writeState} from '../admin/ci-state.js';
import {STATE_KEY, clean} from '../admin/search-night.js';
import {HAND_KEY} from '../admin/search-night-hand.js';

const LABELS = JSON.parse(readFileSync(new URL('../test/fixtures/search-night/2026-11-06.json', import.meta.url), 'utf8')).rows.map(row => row.label)
  .concat(['p7 Registered Nurse, Lyon', 'p8 Electrician, Gdansk', 'p9 Data Analyst, Lisbon', 'p10 Accountant, Vienna', 'p11 Software Engineer, Berlin', 'p12 Chef, Madrid', 'p13 Teacher, Prague',
    'p14 Warehouse Operator, Rotterdam', 'p15 Sales Representative, Milan', 'p16 Mechanic, Brno', 'p17 Social Worker, Dublin', 'p18 Pharmacist, Athens']);
const NOW = new Date('2026-11-19T06:00:00Z');

// right = people with a right job, five = with five or more, blind = not measured; the rest were measured and found none right.
const rowsOf = ({right, five, blind, jobs, first}, engine) => LABELS.map((label, i) => {
  const measured = i < right, blindRow = i >= LABELS.length - blind;
  return {persona: i + 1, label, kind: measured ? 'measured' : blindRow ? 'unmeasured' : 'none-right', why: blindRow ? 'time ran out' : '', local: measured ? (i < five ? 5 + ((i + jobs) % 4) : 1 + ((i + jobs) % 4)) : 0, found: 10 + (i % 6), seconds: blindRow ? null : first + 6 * (i % 5), funnel_note: '', engine};
});

/** @param {{env: object}} context the seed context */
export async function searchScoreboard({env}) {
  const nights = [], eures = [[14, 8, 0, 70, 52], [15, 9, 0, 78, 55], [14, 8, 1, 72, 61], null, [16, 10, 0, 86, 50], [15, 9, 0, 80, 58], [8, 4, 9, 40, 74], [16, 11, 0, 90, 49], [17, 12, 0, 96, 47], [16, 10, 1, 88, 53], [15, 9, 0, 82, 56], [16, 11, 0, 92, 51], [17, 11, 0, 94, 50], [16, 10, 0, 90, 52], [17, 12, 0, 97, 48]];
  const off = [[7, 2, 0, 22, 95], [8, 2, 0, 27, 88], [6, 1, 6, 17, 120], [9, 3, 0, 33, 84], [10, 3, 1, 38, 80], [10, 4, 0, 41, 77], [11, 5, 0, 46, 72], [12, 5, 0, 52, 70]];
  const day = (from, plus) => new Date(Date.parse(`${from}T00:00:00Z`) + plus * 86400000).toISOString().slice(0, 10);
  eures.forEach((spec, i) => { if (spec) nights.push(clean({state: 'success', head: '', rows: rowsOf({right: spec[0], five: spec[1], blind: spec[2], jobs: spec[3], first: spec[4]})}, {night: day('2026-10-27', i)}, NOW)); });
  off.forEach((spec, i) => nights.push(clean({eures: 'off', state: 'success', head: '', rows: rowsOf({right: spec[0], five: spec[1], blind: spec[2], jobs: spec[3], first: spec[4]}, i >= 1 ? 'claude (claude-haiku-5-5)' : undefined)}, {night: day('2026-11-11', i)}, NOW)));
  await writeState(env, STATE_KEY, {nights: nights.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, NOW);
  const hand = (when, spec) => ({day: when.slice(0, 10), at: `${when}:00.000Z`, engine: 'claude-haiku-5-5', eures: 'off', rows: rowsOf({right: spec[0], five: spec[1], blind: spec[2], jobs: spec[3], first: spec[4]}, 'claude (claude-haiku-5-5)')});
  await writeState(env, HAND_KEY, {runs: [hand('2026-11-19T09:40', [13, 6, 0, 56, 66]), hand('2026-11-15T14:20', [11, 4, 0, 44, 79])]}, NOW);
}
