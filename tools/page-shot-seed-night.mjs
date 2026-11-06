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
