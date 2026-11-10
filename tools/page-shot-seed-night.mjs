// Demo data for the nightly Search check on tools/page-shot.mjs (6 Nov 2026, [gi]): the two REAL verdicts of the owner's report (5 Nov: 0 of 6 measured, 6 Nov: 2 of 6, employer sites out of time
// in all six; test/fixtures/search-night/) as the last two nights, over nine MADE-UP healthy nights before them (5 of 6 measured, 3 to 5 right local jobs a persona). The real verdicts hold only
// fictional personas and counts. Laid over the product-quality seed, so Report only shows the Search area beside the other areas.
import {readFileSync} from 'node:fs';
import {writeState} from '../admin/ci-state.js';
import {STATE_KEY, clean, nights} from '../admin/search-night.js';

// Why (6 Nov 2026, #461 and #466 red): the admin walks run EVERY seed on ONE database, and the quality seed's fill cards have fixed ids, so a second run of it died on UNIQUE fill_cards.id.
// Every seed here that lays over it goes through this one helper, so a third night seed cannot repeat it.
const withQuality = async (env, seeds) => { if (!await env.STATS.prepare("SELECT 1 AS x FROM fill_cards WHERE id = 'demo-0-0'").first()) await seeds['product-quality']({env}); };
const DAY = 86400000, real = name => JSON.parse(readFileSync(new URL(`../test/fixtures/search-night/${name}.json`, import.meta.url), 'utf8'));

/** @param {{env: object}} context the seed context; `seeds` the seed table (for the product-quality seed this one lays itself over) */
export async function searchNight({env}, seeds) {
  await withQuality(env, seeds);
  const now = new Date(), night = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), kept = [];
  const healthy = real('2026-11-06');
  for (let back = 11; back >= 2; back--) {   // nine healthy nights: five of six press measured, a few right local jobs each
    const rows = healthy.rows.map((row, index) => ({...row, kind: index < 5 ? 'measured' : 'unmeasured', local: 3 + ((back + index) % 3), seconds: 70 + 10 * ((back + index) % 4), funnel_note: ''}));
    kept.push(clean({...healthy, rows}, {night: night(back), run: String(41000000000 + back)}));
  }
  const newest = real('2026-11-06');   // p2 pressed twice (3/6, 10 Nov 2026): a MADE-UP first-try reason, so the table shows "measured on the 2nd try"
  newest.rows = newest.rows.map((row, index) => (index === 1 ? {...row, kind: 'measured', again: 1, first_try: 'AI slow (a call took 25 s on average)'} : row));
  kept.push(clean(real('2026-11-05'), {night: night(1), run: '41938128120'}), clean(newest, {night: night(0), run: '42133678718'}));
  await writeState(env, STATE_KEY, {nights: kept.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, now);
}

// 18 fixed personas (6 Nov 2026, owner: "6 personas is too narrow"): the real six, then twelve MADE-UP ones (role x country), seven healthy nights and a newest night that dropped (8 of 18 measured, employer sites out of time in 13),
// and a weekly reference record (counts only) for four of them, so the tab shows its three yardsticks. Nothing here is a real person or a real count.
const LABELS = ['p7 Registered Nurse, Lyon', 'p8 Electrician, Gdansk', 'p9 Data Analyst, Lisbon', 'p10 Accountant, Vienna', 'p11 Software Engineer, Berlin', 'p12 Chef, Madrid', 'p13 Teacher, Prague',
  'p14 Warehouse Operator, Rotterdam', 'p15 Sales Representative, Milan', 'p16 Mechanic, Brno', 'p17 Social Worker, Dublin', 'p18 Pharmacist, Athens'];

// MADE-UP blind-judge verdicts per found job (10 Nov 2026, [oe]): most candidates list jobs mostly in their place; p17 "Social Worker, Dublin" lists 25 jobs and the judge calls 1 in the right place on the newest night
// (the owner's Dublin story, with made-up numbers). Each count set adds up to the jobs listed. Nothing here is a real person or a real count.
const listed = i => (i === 16 ? 25 : 8 + (i % 5));
const verdicts = (back, i) => {
  const found = listed(i), remote = i % 4 === 0 ? 1 : 0, unknown = i % 5 === 1 ? 1 : 0, unjudged = back === 0 && i === 3 ? 2 : 0, rest = found - remote - unknown - unjudged;
  const yes = Math.min(rest, i === 16 ? (back === 0 ? 1 : 10 + (back % 3)) : Math.round(found * (0.9 - ((i * 7 + back) % 5) * 0.08))), roleNo = i % 3;
  return {place: {yes, no: rest - yes, remote, unknown, unjudged}, role: {yes: found - roleNo - unjudged, no: roleNo, unjudged}};
};

/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchNight18({env}, seeds) {
  await withQuality(env, seeds);
  const now = new Date(), night = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), base = real('2026-11-06').rows.map(row => row.label).concat(LABELS), kept = [];
  // Made-up step counters (6 Nov 2026): a healthy night wobbles around 140 EU jobs, 12 employer sites, 30 titles, 8 AI calls, 60 s to the first job; on the newest night (back 0, out 13) p1 and p10 read no EU jobs at all, p9's first job is late.
  const counters = (back, i, out) => ({eu: back === 0 && (i === 0 || i === 9) ? 0 : 140 + ((back + i) % 3) * 5, sites: back === 0 && i < out ? 0 : 12 + ((back + i) % 2), titles: 30 + ((back + i) % 3), ai: 8 + ((back + i) % 2), firstS: back === 0 && i === 8 ? 170 : 60 + ((back + i) % 4) * 3});
  const build = (back, measured, out) => clean({state: 'success', head: `measured ${measured} of 18 · every press ≤ 180 s`, rows: base.map((label, i) => ({persona: i + 1, label, kind: i < measured ? 'measured' : 'unmeasured', why: i < measured ? '' : 'time ran out',
    relevant_sources: i < measured ? {eures: 1, other: 1 + ((back + i) % 4), unknown: 0} : null, local: i < measured ? 2 + ((back + i) % 4) : 0, found: listed(i), ...verdicts(back, i), seconds: 90 + 5 * ((back + i) % 6), funnel_note: `places worked out at 17 s; time ran out for: ${i < out ? 'employer sites, ' : ''}job boards`, counters: counters(back, i, out)}))}, {night: night(back), run: String(41000000000 + back)});
  for (let back = 7; back >= 1; back--) kept.push(build(back, 15 + (back % 2), 0));
  kept.push(build(0, 8, 13));
  await writeState(env, STATE_KEY, {nights: kept.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, now);
  await writeState(env, 'search-reference', {week: night(2), personas: {1: {total: 14, reachable: 14, eures: 14}, 2: {total: 0, reachable: 0, eures: 0}, 3: {total: 22, reachable: 22, eures: 22}, 5: {total: 10, reachable: 10, eures: 10}}}, now);
}

// The Night search tab's day-by-day chart (7 Nov 2026, [at]): MADE-UP nights, 7 of 6 candidates (an earlier set), then 12 of 18 (the current set) with one day missing and two dropped nights (back 6: employer sites out of
// time in 13; back 0: 8 of 18 measured). Nothing here is a real person or a real count.
/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchTrend({env}, seeds) {
  await withQuality(env, seeds);
  const now = new Date(), night = back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10), labels = real('2026-11-06').rows.map(row => row.label).concat(LABELS), kept = [];
  const build = (back, total, measured, out) => clean({state: 'success', head: `measured ${measured} of ${total} · every press ≤ 180 s`, rows: labels.slice(0, total).map((label, i) => ({persona: i + 1, label, kind: i < measured ? 'measured' : 'unmeasured', why: i < measured ? '' : 'time ran out',
    local: i < measured ? 2 + ((back + i) % 4) : 0, found: 8 + (i % 5), seconds: 80 + 5 * ((back + i) % 6), funnel_note: `places worked out at 17 s; time ran out for: ${i < out ? 'employer sites, ' : ''}job boards`}))}, {night: night(back), run: String(41000000000 + back)});
  for (let back = 19; back >= 13; back--) kept.push(build(back, 6, 5 - (back % 2), 0));
  for (let back = 12; back >= 0; back--) if (back !== 9) kept.push(build(back, 18, back === 0 ? 8 : 15 + (back % 3), back === 6 ? 13 : back % 4 === 1 ? 2 : 0));
  await writeState(env, STATE_KEY, {nights: kept.reverse().map(item => ({...item, at: `${item.night}T04:00:00.000Z`}))}, now);
}

// The Night search tab with the step yield (8 Nov 2026, [pl]): the 18-candidate seed, and on its newest night MADE-UP step yields (scoring, job boards, employer sites, free job APIs) for the candidates that were measured; job
// boards and employer sites carry no seconds, as the first jobadabra build that reports them. Nothing here is a real person or a real count.
/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchNightYield({env}, seeds) {
  await searchNight18({env}, seeds);
  const kept = await nights(env), [last] = kept;
  const row = (step, seconds, jobs, local, localFit70) => ({step, seconds, jobs, local, scored: local, fit70: localFit70 + 1, localFit70});
  last.rows = last.rows.map((item, i) => (item.kind !== 'measured' ? item : {...item, stepYield: [row('scoring', 20 + (i % 5) * 9, 18 + i, 4 + (i % 4), 1 + (i % 3)), row('job_boards', null, 10 + (i % 6), 2 + (i % 3), i % 2),
    row('employer_sites', null, 30 + i * 3, 5 + (i % 5), 1 + (i % 2)), row('free_job_apis', 6 + (i % 4) * 5, 9 + (i % 7), 1 + (i % 3), i % 2)]}));
  await writeState(env, STATE_KEY, {nights: kept}, new Date());
}

// The Night search tab on a night without EURES (10 Nov 2026, [oe]; owner: "as good as EURES, without using EURES"): the 18-candidate seed, its newest night marked EURES off and its EURES rows moved to other sources,
// so the tab shows the "EURES off" chip and "Ours N of EURES X" beside the reference. Nothing here is a real person or a real count.
/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchNightEuresOff({env}, seeds) {
  await searchNight18({env}, seeds);
  const kept = await nights(env), [last] = kept;
  last.eures = 'off';
  last.rows = last.rows.map(item => (item.relevantSources ? {...item, relevantSources: {...item.relevantSources, eures: 0, other: item.relevantSources.other + item.relevantSources.eures}} : item));
  await writeState(env, STATE_KEY, {nights: kept}, new Date());
}

// The Night search chart with the merged search PRs as marks (10 Nov 2026, [pm]): the day-by-day seed, and on seven of its 18-candidate nights MADE-UP PR numbers and titles (1 to 20 PRs, one night with the
// stored cap and "and more", one real "no PR" night, the first night "nothing to compare"). Nothing here is a real PR.
/** @param {{env: object}} context the seed context; `seeds` the seed table */
export async function searchTrendPrs({env}, seeds) {
  await searchTrend({env}, seeds);
  const kept = await nights(env), titles = ['Read job boards in the order they pay off', 'The title sort asks in batches of 30', 'Places are worked out before the first board', 'Employer sites get 20 s more on a long night', 'Drop a duplicate EURES read',
    'Score only the jobs in the candidate\'s places', 'Skip boards that returned nothing for three nights', 'Judge: a job in the wrong country is wrong', 'Free job APIs run beside the boards', 'A tighter first-job clock'];
  const prsOf = (count, seed) => Array.from({length: Math.min(count, 15)}, (_, i) => ({n: 3700 - seed * 17 - i, title: titles[(seed + i) % titles.length]}));
  const plan = {0: 3, 1: 1, 2: 0, 3: 6, 5: 20, 6: 2, 8: 4, 10: 1};   // days back -> PRs merged since the night before; 4, 7, 9 and 11 have none; 12 is the oldest 18-candidate night
  const day = back => new Date(Date.now() - back * DAY).toISOString().slice(0, 10);
  const oldest = kept.filter(item => item.rows.length === 18).at(-1).night;
  await writeState(env, STATE_KEY, {nights: kept.map(item => {
    if (item.night === oldest || item.rows.length !== 18) return {...item, prs: null};
    const back = Math.round((Date.parse(`${day(0)}T00:00:00Z`) - Date.parse(`${item.night}T00:00:00Z`)) / DAY), count = plan[back] ?? 0;
    return {...item, prs: prsOf(count, back), ...(count > 15 ? {prsMore: count - 15} : {})};
  })}, new Date());
}
