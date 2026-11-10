// The nightly Search check at 18 fixed personas (owner, 6 Nov 2026: "6 personas is too narrow"; "how to know if it's a good or bad result?"): every threshold is a share of the night's own personas (6 -> 4, 18 -> 12), a night is only
// compared with earlier nights of the same persona count, each persona has its own 7-night "usual", the tab shows N of the weekly reference X, and a night that never arrives alerts once at 06:30 UTC on the Worker's five-minute tick.
// The 6-persona rules of 5 and 6 Nov stay in search-night.test.js. Guard for admin/search-night-judge.js, search-night-page.js, search-night-missing.js and reference() in search-night.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {connect} from '../../../../shared/notify.js';
import {MAX_BYTES, REFERENCE_KEY, STATE_KEY, ingest, nights, reference} from '../../../../admin/search-night.js';
import {writeState} from '../../../../admin/ci-state.js';
import {CHECK_AT, MISSING_TEXT, checkMissing, isCheckTick} from '../../../../admin/search-night-missing.js';
import {judgeAll, judgeNight, reasonWords, twoThirds} from '../../../../admin/search-night-judge.js';
import {nightSection} from '../../../../admin/search-night-page.js';
import worker from '../../../../workers/www/index.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
// A stored night (admin/search-night.js clean()) of `total` personas: the first `measured` found right jobs; `local` right local jobs each; the first `out` ran out of time for employer sites.
const night = (day, {total = 18, measured = total, local = 3, out = 0, locals} = {}) => ({night: day, run: null, state: 'success', head: `measured ${measured} of ${total}`, rows: Array.from({length: total}, (_, i) => ({persona: i + 1,
  label: `p${i + 1} Role ${i + 1}, City ${i + 1}`, kind: i < measured ? 'measured' : 'unmeasured', why: '', local: locals ? locals[i] : local, found: 9, seconds: 120, ranOut: i < out ? ['employer sites', 'job boards'] : ['job boards']}))});
const day = back => new Date(Date.UTC(2026, 10, 20 - back)).toISOString().slice(0, 10);
const earlier = (count, spec) => Array.from({length: count}, (_, i) => night(day(i + 1), spec));   // newest first

test('twoThirds: a share of the night\'s personas, rounded up (6 -> 4 as before, 9 -> 6, 18 -> 12)', () => {
  assert.deepEqual([6, 9, 12, 18].map(twoThirds), [4, 6, 8, 12]);
});

test('the judge at 18: 11 of 18 measured drops a night, 12 does not; at 6 the old line (4) is the same line', () => {
  const dropped = measured => judgeNight(night(day(0), {total: 18, measured}), []).reasons.includes('measured');
  assert.deepEqual([dropped(11), dropped(12), dropped(0)], [true, false, true]);
  const six = measured => judgeNight(night(day(0), {total: 6, measured}), []).reasons.includes('measured');
  assert.deepEqual([six(3), six(4)], [true, false]);
  assert.match(reasonWords(judgeNight(night(day(0), {total: 18, measured: 7}), []))[0], /only 7 of 18 measured \(under 12\)/);
});

test('the judge at 18: employer sites out of time in 11 of 18 is fine, in 12 drops; the words carry the night\'s own line', () => {
  const verdict = out => judgeNight(night(day(0), {out}), []);
  assert.deepEqual([verdict(11).reasons, verdict(12).reasons], [[], ['employer-sites']]);
  assert.match(reasonWords(verdict(12))[0], /employer sites in 12 of 18 \(12\+\)/);
});

test('a night is only compared with earlier nights of the same persona count: 6-persona history is no baseline for 18; the changed set starts its own silent first week', () => {
  const history6 = earlier(7, {total: 6, local: 4});   // pooled 24 a night
  const low18 = judgeNight(night(day(0), {total: 18, local: 0}), history6);
  assert.deepEqual([low18.usual, low18.floor, low18.reasons], [null, null, []], 'nothing to compare an 18-persona night with yet');
  const history18 = earlier(7, {total: 18, locals: Array.from({length: 18}, (_, i) => 3 + (i % 3))});   // pooled 72 a night
  const low = judgeNight(night(day(0), {total: 18, local: 1}), history18);
  assert.deepEqual([low.usual, low.reasons], [72, ['local']], '18 right local jobs against a usual 72: dropped');
  assert.equal(judgeNight(night(day(0), {total: 18, local: 4}), history18).reasons.length, 0, 'at 72 it is the usual night');
  assert.equal(judgeNight(night(day(0), {total: 6, local: 4}), [...history6, ...history18]).usual, 24, 'a 6-persona night still finds its 6-persona history among 18-persona nights');
});

test('each persona has its own usual: the median of its right local jobs over the last 7 nights of that set, null in the first week', () => {
  const history = Array.from({length: 7}, (_, k) => night(day(k + 1), {total: 18, locals: Array.from({length: 18}, (_, i) => (i === 2 ? 10 : k % 2 ? 4 : 2))}));   // pooled 44 or 78: a spread, so a small dip is not a drop
  const judged = judgeNight(night(day(0), {total: 18, locals: Array.from({length: 18}, (_, i) => (i === 2 ? 4 : 2))}), history);
  assert.deepEqual([judged.rows[2].usual, judged.rows[0].usual], [10, 2]);
  assert.equal(judgeNight(night(day(0)), earlier(6, {total: 18})).rows[0].usual, null, 'six nights are not a baseline');
  assert.equal(judged.reasons.includes('local'), false, 'one persona under its own usual does not drop the night on its own');
});

test('the tab shows all 18 candidates with their usual, the under-usual note and a separate weekly reference; no reference says so, a stored X of 0 says "EURES lists none"', () => {
  const history = earlier(7, {total: 18, locals: Array.from({length: 18}, (_, i) => (i === 2 ? 10 : 2))});
  const judged = judgeAll([night(day(0), {total: 18, locals: Array.from({length: 18}, (_, i) => (i === 2 ? 4 : 2))}), ...history]);
  const refs = {1: {total: 20, reachable: 14, eures: 12, google: 8}, 2: {total: 0, reachable: 0, eures: 0}};
  const html = nightSection(judged, refs);
  assert.match(html, /The 18 candidates, night 2026-11-20/);
  assert.equal((html.match(/<td><b>p\d+ Role/g) || []).length, 18);
  assert.match(html, /usual 10<\/span> <span[^>]*>↓ under its usual/);
  assert.equal((html.match(/↓ under its usual/g) || []).length, 1, 'only the persona under its own usual');
  assert.match(html, /Reference: 20<div class="why">14 reachable · EURES 12 · Google Jobs 8/);
  assert.match(html, /EURES lists none<\/span>/);
  assert.match(html, /no reference yet/);
  assert.match(nightSection(judgeAll(earlier(2, {total: 18}))), /usual: after 7 nights/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

const d1 = () => {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
};
const telegram = () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const [, , method] = /bot([^/]+)\/(\w+)$/.exec(url), body = JSON.parse(init.body || '{}');
    calls.push({method, body});
    const reply = (result, ok = true) => new Response(JSON.stringify({ok, result}), {status: ok ? 200 : 400});
    return method === 'getMe' ? reply({username: 'jobadabra_ci_bot'}) : method === 'getChat' ? reply({title: 'Jobadabra CI', id: body.chat_id}) : method === 'getUpdates' ? reply([{message: {chat: {id: 777}}}]) : reply({message_id: 9});
  };
  return {fetcher, sends: () => calls.filter(call => call.method === 'sendMessage')};
};
const store = async (list, env, now) => writeState(env, STATE_KEY, {nights: list}, now);

test('an 18-persona verdict from the real gate is taken by the route: stored as 18 rows, well under the size cap (before: 13 rows or more were a 400)', async () => {
  const real = JSON.parse(readFileSync(new URL('../../../fixtures/search-night/2026-11-06.json', import.meta.url), 'utf8'));
  const verdict = {...real, rows: [0, 1, 2].flatMap(copy => real.rows.map(row => ({...row, persona: row.persona + 6 * copy})))};   // the real six rows, three times: 18 personas of real size
  assert.equal(verdict.rows.length, 18);
  assert.ok(JSON.stringify(verdict).length < MAX_BYTES / 2, `18 real rows are ${JSON.stringify(verdict).length} bytes of ${MAX_BYTES}`);
  const env = {STATS: d1()}, done = await ingest(env, verdict, {night: '2026-11-07', run: '42147413237'}, new Date('2026-11-07T04:00:00Z'));
  assert.deepEqual([done.status, done.body.total, done.body.measured], [200, 18, 6]);
  assert.equal((await nights(env))[0].rows.length, 18);
  assert.equal((await ingest(env, {...verdict, rows: [...verdict.rows, ...verdict.rows, ...verdict.rows]}, {night: '2026-11-08'}, new Date('2026-11-08T04:00:00Z'))).status, 400, '54 rows are still refused');
});

test('reference(): the weekly record per persona id as counts; none, a bad id or a bad count is never a number', async () => {
  const env = {STATS: d1()};
  assert.deepEqual(await reference(env), {}, 'no record yet');
  await writeState(env, REFERENCE_KEY, {week: '2026-11-16', personas: {1: {total: 20, reachable: 14, eures: 12, google: 8}, 2: {total: 'x', reachable: -1}, bad: {total: 1}, 3: null}}, new Date('2026-11-16T05:00:00Z'));
  assert.deepEqual(await reference(env), {1: {total: 20, reachable: 14, eures: 12, google: 8}, 2: {total: null, reachable: null, eures: null, google: null}, 3: {total: null, reachable: null, eures: null, google: null}});
});

test('a night that never arrived alerts once at 06:30 UTC: no night for the UTC day tells, a night there is silent, the second send that day is held, the next day tells again', async () => {
  const env = {STATS: d1(), NOTIFY_SECRET: 'vault-secret'}, tg = telegram(), at = hhmm => new Date(`2026-11-07T${hhmm}:00Z`);
  assert.equal((await connect(env, 'engineering', TOKEN, '', tg.fetcher, at('06:00'))).ok, true);
  assert.deepEqual([CHECK_AT, isCheckTick(at('06:30')), isCheckTick(at('06:25')), isCheckTick(at('07:25')), isCheckTick(at('07:30')), isCheckTick(at('18:30'))], ['06:30', true, false, true, false, false], 'a window, so one skipped tick does not bring the silence back');
  await store([night('2026-11-06')], env, at('01:00'));   // yesterday's night is there; today's is not
  assert.deepEqual(await checkMissing(env, at('06:30'), tg.fetcher), {missing: true, alert: 'sent'});
  assert.match(tg.sends()[0].body.text, /^🔴 <b>Night search: no result last night<\/b>[\s\S]*<a href="https:\/\/www\.jobadabra\.top\/admin\/job-search\/lab\?tab=night">Open the night search<\/a>$/);
  assert.equal(tg.sends()[0].body.text, MISSING_TEXT);
  assert.equal((await checkMissing(env, at('06:30'), tg.fetcher)).alert, 'already-today', 'a second check the same day sends nothing');
  assert.equal(tg.sends().length, 1);
  await store([night('2026-11-07'), night('2026-11-06')], env, at('07:00'));
  assert.deepEqual(await checkMissing(env, at('18:30'), tg.fetcher), {missing: false, alert: null}, 'today\'s night is there: silent');
  assert.deepEqual(await checkMissing(env, new Date('2026-11-08T06:30:00Z'), tg.fetcher), {missing: true, alert: 'sent'}, 'the next day with no night tells again');
  assert.equal(tg.sends().length, 2);
});

test('the Worker\'s five-minute tick runs the check from 06:30 UTC for an hour and at no other tick; a failing check is logged, never thrown', async t => {
  const env = {STATS: d1(), NOTIFY_SECRET: 'vault-secret', STATS_KEY: 'k3y', STATS_SALT: 's', ASSETS: {fetch: () => new Response('asset')}}, tg = telegram();
  assert.equal((await connect(env, 'engineering', TOKEN, '', tg.fetcher, new Date('2026-11-07T05:00:00Z'))).ok, true);
  const real = globalThis.fetch, errors = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  globalThis.fetch = (url, init) => (/api\.telegram\.org/.test(String(url)) ? tg.fetcher(String(url), init) : Promise.resolve(new Response(null, {status: 204})));
  try {
    const tick = async time => { const tasks = []; await worker.scheduled({cron: '*/5 * * * *', scheduledTime: Date.parse(`2026-11-07T${time}:00Z`)}, env, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks); };
    await tick('06:25');
    assert.equal(tg.sends().length, 0, 'not the 06:30 tick');
    await tick('06:30');
    assert.equal(tg.sends().length, 1);
    assert.match(tg.sends()[0].body.text, /no result last night/);
    await tick('06:35');
    assert.equal(tg.sends().length, 1, 'a later tick of the window sends nothing more (the daily limit)');
    await store([night('2026-11-07')], env, new Date('2026-11-07T06:31:00Z'));
    await tick('06:30');
    assert.equal(tg.sends().length, 1, 'a night filed: nothing more');
    const broken = {...env, STATS: {prepare: () => { throw new Error('boom'); }, batch: () => { throw new Error('boom'); }}};
    const tasks = []; await worker.scheduled({cron: '*/5 * * * *', scheduledTime: Date.parse('2026-11-08T06:30:00Z')}, broken, {waitUntil: task => tasks.push(task)}); await Promise.allSettled(tasks);
    assert.ok(errors.mock.calls.some(call => /search night missing: boom/.test(String(call.arguments[0]))), 'the unreadable store is named in the log');
  } finally { globalThis.fetch = real; }
  assert.equal((await nights(env)).length, 1);
});
