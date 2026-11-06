// Demo data for the nightly Search check on tools/page-shot.mjs (6 Nov 2026, [gi]): the two REAL verdicts of the owner's report (5 Nov: 0 of 6 measured, 6 Nov: 2 of 6, employer sites out of time
// in all six; test/fixtures/search-night/) as the last two nights, over nine MADE-UP healthy nights before them (5 of 6 measured, 3 to 5 right local jobs a persona). The real verdicts hold only
// fictional personas and counts. Laid over the product-quality seed, so Report only shows the Search area beside the other areas.
import {readFileSync} from 'node:fs';
import {writeState} from '../admin/ci-state.js';
import {STATE_KEY, clean} from '../admin/search-night.js';

const DAY = 86400000, real = name => JSON.parse(readFileSync(new URL(`../test/fixtures/search-night/${name}.json`, import.meta.url), 'utf8'));

/** @param {{env: object}} context the seed context; `seeds` the seed table (for the product-quality seed this one lays itself over) */
export async function searchNight({env}, seeds) {
  // Why (6 Nov 2026, #461 red): the admin walks run every seed on ONE database, and the quality seed's fill cards have fixed ids, so a second run died on UNIQUE fill_cards.id.
  if (!await env.STATS.prepare("SELECT 1 AS x FROM fill_cards WHERE id = 'demo-0-0'").first()) await seeds['product-quality']({env});
  const now = new Date(), night = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), kept = [];
  const healthy = real('2026-11-06');
  for (let back = 11; back >= 2; back--) {   // nine healthy nights: five of six press measured, a few right local jobs each
    const rows = healthy.rows.map((row, index) => ({...row, kind: index < 5 ? 'measured' : 'unmeasured', local: 3 + ((back + index) % 3), seconds: 70 + 10 * ((back + index) % 4), funnel_note: ''}));
    kept.push(clean({...healthy, rows}, {night: night(back), run: String(41000000000 + back)}));
  }
  kept.push(clean(real('2026-11-05'), {night: night(1), run: '41938128120'}), clean(real('2026-11-06'), {night: night(0), run: '42133678718'}));
  await writeState(env, STATE_KEY, {nights: kept.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, now);
}

// 18 fixed personas (6 Nov 2026, owner: "6 personas is too narrow"): the real six, then twelve MADE-UP ones (role x country), seven healthy nights and a newest night that dropped (8 of 18 measured, employer sites out of time in 13),
// and a weekly reference record (counts only) for four of them, so the tab shows its three yardsticks. Nothing here is a real person or a real count.
const LABELS = ['p7 Registered Nurse, Lyon', 'p8 Electrician, Gdansk', 'p9 Data Analyst, Lisbon', 'p10 Accountant, Vienna', 'p11 Software Engineer, Berlin', 'p12 Chef, Madrid', 'p13 Teacher, Prague',
  'p14 Warehouse Operator, Rotterdam', 'p15 Sales Representative, Milan', 'p16 Mechanic, Brno', 'p17 Social Worker, Dublin', 'p18 Pharmacist, Athens'];

/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchNight18({env}, seeds) {
  await seeds['product-quality']({env});
  const now = new Date(), night = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), base = real('2026-11-06').rows.map(row => row.label).concat(LABELS), kept = [];
  const build = (back, measured, out) => clean({state: 'success', head: `measured ${measured} of 18 · every press ≤ 180 s`, rows: base.map((label, i) => ({persona: i + 1, label, kind: i < measured ? 'measured' : 'unmeasured', why: i < measured ? '' : 'time ran out',
    local: i < measured ? 2 + ((back + i) % 4) : 0, found: 8 + (i % 5), seconds: 90 + 5 * ((back + i) % 6), funnel_note: `places worked out at 17 s; time ran out for: ${i < out ? 'employer sites, ' : ''}job boards`}))}, {night: night(back), run: String(41000000000 + back)});
  for (let back = 7; back >= 1; back--) kept.push(build(back, 15 + (back % 2), 0));
  kept.push(build(0, 8, 13));
  await writeState(env, STATE_KEY, {nights: kept.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, now);
  await writeState(env, 'search-reference', {week: night(2), personas: {1: {total: 14, reachable: 9, eures: 6, google: 8}, 2: {total: 0, reachable: 0, eures: 0, google: 0}, 3: {total: 22, reachable: 11, eures: 9, google: 13}, 5: {total: 10, reachable: 7, eures: 4, google: 6}}}, now);
}
