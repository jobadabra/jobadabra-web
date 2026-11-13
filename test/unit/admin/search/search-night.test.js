// The nightly Search check in Admin (owner, 6 Nov 2026: "Where should I see it the search dropped? Am I getting alerted? I'm not alerted"): the upload (key, shape, size, 30 nights), the judge
// (the three ways a night drops and what does not), the alert (once a night, counts only, through the owner's switchboard) and the "Night search" tab. The real verdicts of 5 and 6 Nov 2026
// (runs 41938128120, 42133678718: 0 of 6 and 2 of 6 measured, both runs green, nobody told) are the fixtures. Guard for admin/search-night.js, search-night-judge.js, search-night-page.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {connect, saveSetting} from '../../../../shared/notify.js';
import {KEEP_NIGHTS, MAX_BYTES, clean, ingestRoute, nights} from '../../../../admin/search-night.js';
import {alertText, judgeAll, judgeNight} from '../../../../admin/search-night-judge.js';
import {checkCard} from '../../../../shared/tg-card.js';
import {nightSection} from '../../../../admin/search-night-page.js';
import {page} from '../../../../admin/search-lab-page.js';
import worker from '../../../../workers/www/index.js';

const real = name => JSON.parse(readFileSync(new URL(`../../../fixtures/search-night/${name}.json`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-06T09:00:00Z'), KEY = 'search-lab-key-0123456789', TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
// A fake Telegram: records every call; a connected bot is what the owner's Notifications page keeps.
function telegram() {
  const calls = [];
  const fetcher = async (url, init) => {
    const [, token, method] = /bot([^/]+)\/(\w+)$/.exec(url), body = JSON.parse(init.body || '{}');
    calls.push({token, method, body});
    const reply = (ok, result, description) => new Response(JSON.stringify({ok, result, description}), {status: ok ? 200 : 400});
    if (method === 'getMe') return reply(true, {username: 'jobadabra_ci_bot'});
    if (method === 'getChat') return reply(true, {title: 'Jobadabra CI', id: body.chat_id});
    if (method === 'getUpdates') return reply(true, [{message: {chat: {id: 777}}}]);
    return reply(true, {message_id: 9});
  };
  return {calls, fetcher, sends: () => calls.filter(call => call.method === 'sendMessage')};
}
const setup = async ({connected = true} = {}) => {
  const env = {STATS: d1(), NOTIFY_SECRET: 'vault-secret', REPLAYS_PUBLISH_KEY: KEY}, tg = telegram();
  if (connected) assert.equal((await connect(env, 'engineering', TOKEN, '', tg.fetcher, NOW)).ok, true);
  return {env, tg};
};
const put = (body, {night, run, key = KEY, at = NOW, env, tg} = {}) => {
  const query = [night && `night=${night}`, run && `run=${run}`].filter(Boolean).join('&');
  const request = new Request(`https://www.jobadabra.top/search-check/night${query ? `?${query}` : ''}`, {method: 'PUT', headers: key ? {Authorization: `Bearer ${key}`} : {}, body: typeof body === 'string' ? body : JSON.stringify(body)});
  return ingestRoute(request, env, at, tg?.fetcher);
};

// A verdict as CI uploads it: `kinds` per persona, `locals` (right jobs in the persona's places), `out` = how many personas ran out of time for employer sites.
const row = (persona, kind, local, extra = {}) => ({persona, label: `p${persona} Fictional ${persona}, Town`, kind, why: kind === 'measured' ? '' : 'scored 2, none right role and place', local, found: local == null ? null : local + 5, seconds: 150 + persona,
  mark: '⚪', main: [0, 0, 0], usd: 0, billing: 'subscription', engine: 'codex (gpt-6-luna)', reasons: [], ...extra});
const verdict = ({kinds = Array(6).fill('measured'), locals = Array(6).fill(2), out = 0} = {}) => ({state: 'success', head: `🟢 measured ${kinds.filter(kind => kind === 'measured').length} of ${kinds.length} · every press ≤ 180 s`,
  rows: kinds.map((kind, i) => row(i + 1, kind, locals[i], {funnel_note: `places worked out at 17 s; employers named at 54 s; time ran out for: ${i < out ? 'employer sites, ' : ''}job boards, free job APIs`}))});
const stored = (night, spec) => { const record = clean(verdict(spec), {night}); assert.equal(record.error, undefined, record.error); return record; };
const sums = list => list.map((n, i) => stored(`2026-10-${String(20 + i).padStart(2, '0')}`, {locals: [n, 0, 0, 0, 0, 0]})).reverse();   // newest first, as the store hands them out
const USUAL = [12, 14, 10, 13, 11, 12, 15];   // median 12, sample spread 1.72, so the floor is 12 - 2 x 1.72 = 8.56

test('the upload is refused without the key, with a wrong key and without the store: a plain 404, nothing kept', async () => {
  const {env} = await setup();
  for (const [name, attempt] of [['no key', put(real('2026-11-06'), {key: '', env})], ['wrong key', put(real('2026-11-06'), {key: 'x'.repeat(24), env})],
    ['no key configured', put(real('2026-11-06'), {key: '', env: {...env, REPLAYS_PUBLISH_KEY: undefined}})], ['no store', put(real('2026-11-06'), {env: {REPLAYS_PUBLISH_KEY: KEY}})]]) {
    const response = await attempt;
    assert.deepEqual([name, response.status, await response.text()], [name, 404, 'Not found']);
  }
  assert.deepEqual(await nights(env), []);
});

test('a night round-trips as slim rows: the head, one row per persona with counts and the steps that ran out of time; nothing else of the verdict is kept', async () => {
  const {env, tg} = await setup();
  const response = await put(real('2026-11-06'), {night: '2026-11-06', run: '42133678718', env, tg});
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.deepEqual([answer.ok, answer.night, answer.measured, answer.total, answer.dropped, answer.reasons], [true, '2026-11-06', 2, 6, true, ['measured', 'employer-sites']]);
  const [night] = await nights(env);
  assert.deepEqual([night.night, night.run, night.state, night.rows.length], ['2026-11-06', '42133678718', 'success', 6]);
  assert.match(night.head, /measured 2 of 6/);
  assert.deepEqual(night.rows[0], {persona: 1, label: 'p1 Truck Driver (Class CE), Sofia', kind: 'measured', why: '', local: 9, found: 36, seconds: 154,
    ranOut: ['employer sites', 'job boards', 'free job APIs', 'descriptions', "scoring the job boards' jobs"], again: 0, firstTry: '', counters: null, inout: null, read: null, sources: null, scout: null, runs: null, stepYield: null, relevantSources: null, place: null, role: null});   // counters, stepYield: null = the verdict of 5 and 6 Nov holds none (per-step counters 6 Nov 2026, step yield 8 Nov): nothing is claimed
  assert.deepEqual(night.rows.map(item => item.kind), ['measured', 'nothing', 'none-right', 'none-right', 'measured', 'nothing']);
  assert.deepEqual(Object.keys(night).sort(), ['asApp', 'at', 'engine', 'eures', 'floors', 'head', 'measure', 'night', 'rows', 'run', 'state'], 'the engine is kept as ONE word (Scoreboard, 10 Nov 2026), whether the night read like the app as one word (13 Nov 2026); the cost, the main history and the notes are not');
  assert.equal(night.engine, 'codex-gpt-6-luna', "the row's \"codex (gpt-6-luna)\" is the night's one word");
  assert.equal(night.eures, 'on', 'the real night of 6 Nov ran with EURES on');
  assert.equal(night.at, NOW.toISOString());
});

test('the same night uploaded again replaces it; without ?night= it is the UTC day of the upload', async () => {
  const {env, tg} = await setup();
  await put(real('2026-11-05'), {night: '2026-11-06', env, tg});
  await put(real('2026-11-06'), {night: '2026-11-06', env, tg});
  const kept = await nights(env);
  assert.deepEqual([kept.length, kept[0].rows.filter(item => item.kind === 'measured').length], [1, 2], 'the later verdict stands');
  await put(real('2026-11-06'), {env, tg, at: new Date('2026-11-07T00:05:00Z')});
  assert.deepEqual((await nights(env)).map(item => item.night), ['2026-11-07', '2026-11-06']);
});

test('30 nights are kept, newest first; the oldest go', async () => {
  const {env, tg} = await setup();
  const day = n => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
  for (let n = 0; n < KEEP_NIGHTS + 3; n += 1) assert.equal((await put(verdict(), {night: day(n), env, tg})).status, 200);
  const kept = (await nights(env)).map(item => item.night);
  assert.equal(kept.length, KEEP_NIGHTS);
  assert.deepEqual([kept[0], kept.at(-1)], [day(KEEP_NIGHTS + 2), day(3)]);
});

test('a bad upload is refused with a reason and keeps nothing: too big, not JSON, no rows, a bad night, too many personas', async () => {
  const {env, tg} = await setup();
  const big = {...verdict(), padding: 'x'.repeat(MAX_BYTES)};
  const cases = [[big, {}, 413], ['not json', {}, 400], [{state: 'success', head: 'x'}, {}, 400], [{...verdict(), rows: []}, {}, 400], [verdict(), {night: 'yesterday'}, 400],
    [{...verdict(), rows: Array.from({length: 41}, (_, i) => row(i + 1, 'measured', 1))}, {}, 400], [{...verdict(), rows: [null]}, {}, 400], [[1, 2], {}, 400], [verdict(), {run: 'abc'}, 400]];
  for (const [body, options, status] of cases) {
    const response = await put(body, {...options, env, tg});
    assert.equal(response.status, status, JSON.stringify(options) + String(body).slice(0, 20));
    assert.equal((await response.json().catch(() => ({}))).ok ?? false, false);
  }
  assert.deepEqual(await nights(env), []);
});

test('clean(): counts are whole numbers or null (never 0), a kind the gate does not know is "unknown", text is cut, the steps that ran out are read from the gate\'s note', () => {
  const record = clean({state: 'success', head: 'h'.repeat(500), rows: [
    row(1, 'measured', 3, {label: 'L'.repeat(200), why: 'w'.repeat(300), found: -4, seconds: 1.5, funnel_note: 'employers named at 5 s; time ran out for: employer sites, job boards'}),
    row(2, 'martian', null, {funnel_note: ''}), row(3, 'nothing', 0, {funnel_note: 'time ran out for: a, b, c, d, e, f, g, h, i, j'}), row(4, 'fault', 1, {funnel_note: undefined})]}, {night: '2026-11-06'});
  assert.deepEqual([record.head.length, record.rows[0].label.length, record.rows[0].why.length], [300, 80, 120]);
  assert.deepEqual([record.rows[0].found, record.rows[0].seconds, record.rows[0].local, record.rows[0].ranOut], [null, null, 3, ['employer sites', 'job boards']]);
  assert.deepEqual([record.rows[1].kind, record.rows[1].local, record.rows[1].ranOut], ['unknown', null, []]);
  assert.deepEqual([record.rows[2].local, record.rows[2].ranOut.length], [0, 8], 'a real 0 stays 0; at most 8 steps');
  assert.deepEqual(record.rows[3].ranOut, []);
  assert.deepEqual(clean(real('2026-11-05'), {night: '2026-11-05'}).rows.map(item => item.ranOut.includes('employer sites')), Array(6).fill(false), '5 Nov: employer sites were read');
  assert.deepEqual(clean(real('2026-11-06'), {night: '2026-11-06'}).rows.map(item => item.ranOut.includes('employer sites')), Array(6).fill(true), '6 Nov: out of time for employer sites in all six');
});

test('the judge: fewer than 4 of 6 measured drops a night, 4 does not', () => {
  const kinds = measured => Array.from({length: 6}, (_, i) => (i < measured ? 'measured' : 'none-right'));
  assert.deepEqual(judgeNight(stored('2026-11-06', {kinds: kinds(4)}), []).reasons, []);
  const three = judgeNight(stored('2026-11-06', {kinds: kinds(3)}), []);
  assert.deepEqual([three.reasons, three.dropped, three.measured, three.total], [['measured'], true, 3, 6]);
  assert.equal(judgeNight(stored('2026-11-06', {kinds: Array(6).fill('unmeasured')}), []).measured, 0, 'not measured is not a pass');
});

test('the judge: employer sites out of time in 4 personas drops a night, 3 does not', () => {
  assert.deepEqual(judgeNight(stored('2026-11-06', {out: 3}), []).reasons, []);
  const four = judgeNight(stored('2026-11-06', {out: 4}), []);
  assert.deepEqual([four.reasons, four.out], [['employer-sites'], 4]);
});

test('the judge: relevant local jobs below the median of the last 7 nights minus 2 spreads drops a night; at the floor it does not', () => {
  const history = sums(USUAL);
  const low = judgeNight(stored('2026-10-27', {locals: [8, 0, 0, 0, 0, 0]}), history);
  assert.deepEqual([low.reasons, low.local, low.usual, low.floor], [['local'], 8, 12, 8.6]);
  assert.deepEqual(judgeNight(stored('2026-10-27', {locals: [9, 0, 0, 0, 0, 0]}), history).reasons, [], '9 is above the floor of 8.56');
  assert.deepEqual(judgeNight(stored('2026-10-27', {locals: [2, 3, 3, 1, 0, 0]}), history).local, 9, 'the six personas are pooled');
  assert.deepEqual(judgeNight(stored('2026-10-27', {locals: [20, 20, 0, 0, 0, 0]}), history).reasons, [], 'a better night is never a drop');
});

test('the judge: the first week and a median of 0 stay silent on local jobs (nothing to compare with); a missing count is never a 0', () => {
  const none = {locals: [0, 0, 0, 0, 0, 0]};
  assert.deepEqual(judgeNight(stored('2026-10-27', none), sums(USUAL).slice(0, 6)).reasons, [], 'only 6 earlier nights: the first week');
  assert.equal(judgeNight(stored('2026-10-27', none), sums(USUAL).slice(0, 6)).floor, null);
  assert.deepEqual(judgeNight(stored('2026-10-27', none), sums([0, 0, 0, 13, 0, 0, 9])).reasons, [], 'a median of 0: no floor can be below it');
  const unknown = judgeNight(stored('2026-10-27', {locals: Array(6).fill(null)}), sums(USUAL));
  assert.deepEqual([unknown.local, unknown.reasons], [null, []]);
  assert.deepEqual(judgeNight(stored('2026-10-27', {locals: [null, null, 5, 5, 5, 5]}), sums(USUAL)).local, 20, 'a null persona adds nothing');
});

test('judgeAll: each night against the nights before it only; the two real nights both dropped', () => {
  const [six, five] = [clean(real('2026-11-06'), {night: '2026-11-06'}), clean(real('2026-11-05'), {night: '2026-11-05'})];
  const judged = judgeAll([six, five]);
  assert.deepEqual(judged.map(item => [item.night, item.measured, item.total, item.out, item.reasons]), [['2026-11-06', 2, 6, 6, ['measured', 'employer-sites']], ['2026-11-05', 0, 6, 0, ['measured']]]);
  const history = sums(USUAL), all = [stored('2026-10-27', {locals: [8, 0, 0, 0, 0, 0]}), ...history];
  const verdicts = judgeAll(all);
  assert.deepEqual(verdicts.map(item => item.night), all.map(item => item.night), 'same order');
  assert.deepEqual([verdicts[0].reasons, verdicts[1].reasons, verdicts.at(-1).floor], [['local'], [], null], 'tonight is judged against the 7 before; the oldest has nothing before it');
});

test('the alert says counts only: how many measured, and what dropped; no persona, job or employer name', () => {
  const [six, five] = judgeAll([clean(real('2026-11-06'), {night: '2026-11-06'}), clean(real('2026-11-05'), {night: '2026-11-05'})]);
  assert.match(alertText(six), /^🟠 <b>Night search: 2 of 6 personas measured<\/b>[\s\S]*2 measured · 4 missing[\s\S]*Employer sites out of time in 6/);
  assert.match(alertText(five), /^🟠 <b>Night search: 0 of 6 personas measured<\/b>[\s\S]*0 measured · 6 missing/);
  const local = judgeNight(stored('2026-10-27', {locals: [8, 0, 0, 0, 0, 0]}), sums(USUAL));
  assert.match(alertText(local), /Night search: 6 of 6 personas measured[\s\S]*Relevant local jobs 8 against a usual 12/);
  for (const text of [alertText(six), alertText(five), alertText(local)]) assert.deepEqual(checkCard(text), []);
  for (const text of [alertText(six), alertText(five), alertText(local)]) assert.doesNotMatch(text, /Truck|Sofia|Carpenter|Brussels|Fictional/);
});

test('the alert goes out once a night through the owner\'s switchboard: a second upload that day is held, a healthy night says nothing, the next night tells again', async () => {
  const {env, tg} = await setup();
  const first = await (await put(real('2026-11-06'), {night: '2026-11-06', env, tg})).json();
  assert.equal(first.alert, 'sent');
  assert.equal(tg.sends().length, 1);
  assert.match(tg.sends()[0].body.text, /^🟠 <b>Night search: 2 of 6 personas measured<\/b>[\s\S]*Employer sites out of time in 6[\s\S]*<a href="https:\/\/www\.jobadabra\.top\/admin\/job-search\/lab\?tab=night">Open the night search<\/a>$/);
  assert.equal((await (await put(real('2026-11-06'), {night: '2026-11-06', env, tg, at: new Date('2026-11-06T15:00:00Z')})).json()).alert, 'already-today', 'a re-run the same UTC day');
  assert.equal(tg.sends().length, 1);
  const healthy = await (await put(verdict(), {night: '2026-11-07', env, tg, at: new Date('2026-11-07T09:00:00Z')})).json();
  assert.deepEqual([healthy.dropped, healthy.alert], [false, null]);
  assert.equal(tg.sends().length, 1);
  assert.equal((await (await put(real('2026-11-05'), {night: '2026-11-08', env, tg, at: new Date('2026-11-08T09:00:00Z')})).json()).alert, 'sent', 'the next night that drops tells again');
  assert.equal(tg.sends().length, 2);
});

test('a night is stored when the alert cannot go out: switched off, no bot connected, an older night uploaded late', async () => {
  const off = await setup();
  await saveSetting(off.env, 'search-check-dropped', {enabled: false}, NOW);
  const answered = await (await put(real('2026-11-06'), {night: '2026-11-06', env: off.env, tg: off.tg})).json();
  assert.deepEqual([answered.ok, answered.dropped, answered.alert, off.tg.sends().length, (await nights(off.env)).length], [true, true, 'off', 0, 1]);
  const bare = await setup({connected: false});
  const unbound = await (await put(real('2026-11-06'), {night: '2026-11-06', env: bare.env, tg: bare.tg})).json();
  assert.deepEqual([unbound.ok, unbound.alert, bare.tg.sends().length, (await nights(bare.env)).length], [true, 'channel-not-connected', 0, 1]);
  const late = await setup();
  await put(verdict(), {night: '2026-11-07', env: late.env, tg: late.tg});
  const back = await (await put(real('2026-11-05'), {night: '2026-11-05', env: late.env, tg: late.tg})).json();
  assert.deepEqual([back.dropped, back.alert, late.tg.sends().length], [true, null, 0], 'filling in an older night is never news');
});

test('the Worker serves the route: PUT with the key stores, without it is a 404, and only PUT stores', async () => {
  const {env} = await setup();
  const call = (method, headers = {}, body) => worker.fetch(new Request('https://www.jobadabra.top/search-check/night', {method, headers, body}), {...env, WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset', {status: 404})}}, {waitUntil() {}});
  assert.equal((await call('PUT', {}, JSON.stringify(verdict()))).status, 404);
  const stored1 = await call('PUT', {Authorization: `Bearer ${KEY}`}, JSON.stringify(verdict()));
  assert.equal(stored1.status, 200);
  assert.equal((await nights(env)).length, 1);
  assert.notEqual((await call('GET', {Authorization: `Bearer ${KEY}`})).status, 200, 'only PUT stores');
});

test('the tab: the newest night per persona as chips, the head, what ran out of time, a 14-night strip; empty says so and shows no zeros; every value is escaped', () => {
  const six = clean(real('2026-11-06'), {night: '2026-11-06', run: '42133678718'}), five = clean(real('2026-11-05'), {night: '2026-11-05'});
  const html = nightSection(judgeAll([six, five]));
  assert.match(html, /measured 2 of 6/);
  assert.equal((html.match(/class="chip good">✓ measured</g) || []).length, 2, 'the persona table is the newest night only: 2 measured');
  assert.equal((html.match(/class="chip warn">! scored, none right</g) || []).length, 2);
  assert.equal((html.match(/class="chip bad">✕ nothing scored</g) || []).length, 2);
  assert.match(html, /time ran out for[^<]*employer sites/);
  assert.match(html, /p1 Truck Driver \(Class CE\), Sofia/);
  assert.equal((html.match(/<i class="weak"/g) || []).length, 2, 'both nights dropped: two red bars in the strip');
  assert.match(html, /2026-11-05/);
  assert.match(html, /42133678718/);
  const empty = nightSection([]);
  assert.match(empty, /No night uploaded yet/);
  assert.doesNotMatch(empty, /0 of 6|NaN|undefined/);
  const hostile = {...six, head: '<script>1</script>', rows: six.rows.map(item => ({...item, label: '<img src=x onerror=1>', why: '<b>why</b>', ranOut: ['<i>step</i>']}))};
  const hostileHtml = nightSection(judgeAll([hostile]));
  assert.doesNotMatch(hostileHtml, /<script>1<|<img |<b>why|<i>step/);
  assert.equal((hostileHtml.match(/<script>/g) || []).length <= 1, true, 'the only script is the chart tooltip');
});

test('the Job search page has the tab: linked in the tab row and drawn when chosen', () => {
  const six = judgeAll([clean(real('2026-11-06'), {night: '2026-11-06'})]);
  const html = page([], 'night', [], null, [], six);
  assert.match(html, /<a href="\?tab=night" class="on">Night search<\/a>/);
  assert.match(html, /measured 2 of 6/);
  assert.doesNotMatch(page([], 'draws', [], null, [], six), /measured 2 of 6/, 'only on its own tab');
});

test('a night dated in the future is refused: it would sort newest and silence every real night after it (review, 6 Nov 2026)', async () => {
  const {env, tg} = await setup();
  for (const night of ['2099-01-01', '2026-11-08', '2026-13-45']) {
    const response = await put(real('2026-11-06'), {night, env, tg});
    assert.deepEqual([night, response.status], [night, 400]);
  }
  assert.deepEqual(await nights(env), [], 'nothing kept');
  assert.equal((await put(real('2026-11-06'), {night: '2026-11-07', env, tg})).status, 200, 'a clock a day ahead of the Worker (CI in another zone) is still taken');
});

test('a store that cannot be read says "could not be read", never "No night uploaded yet" (review, 6 Nov 2026)', () => {
  const html = nightSection(null);
  assert.match(html, /could not be read/);
  assert.doesNotMatch(html, /No night uploaded yet|0 of 6|NaN|undefined/);
  assert.match(page([], 'night', [], null, [], null), /could not be read/);
});

test('source counts keep only fixed categories, never employer text or inconsistent totals', () => {
  // Guard: privacy — employer/source names must not be saved in the central night store.
  const verdict = {rows: [{persona: 1, local: 3, relevant_sources: {eures: 1, other: 2, unknown: 0, 'Private employer': 9}}]};
  const saved = clean(verdict, {night: '2026-11-01'});
  assert.deepEqual(saved.rows[0].relevantSources, {eures: 1, other: 2, unknown: 0});
  assert.ok(!JSON.stringify(saved).includes('Private employer'));
  const html = nightSection(judgeAll([saved]));
  assert.match(html, /From EURES: 1/);
  assert.match(html, /From other sources: 2/);
  assert.doesNotMatch(html, /Private employer/);
  verdict.rows[0].local = 4;
  assert.equal(clean(verdict, {night: '2026-11-01'}).rows[0].relevantSources, null);
  delete verdict.rows[0].relevant_sources;
  assert.equal(clean(verdict, {night: '2026-11-01'}).rows[0].relevantSources, null);
});

test('a night with EURES off is judged only against EURES-off nights: the switch is no drop; the tab says "ours of EURES" (owner, 10 Nov 2026)', () => {
  // Owner, 10 Nov 2026: "we should make sure that our algorim/search can be as good as EURES, without using EURES"; CI runs without EURES from jobadabra [oe] 1/3.
  const off = spec => ({...stored('2026-10-27', spec), eures: 'off'});
  assert.equal(clean({...verdict(), eures: 'off'}, {night: '2026-10-27'}).eures, 'off');
  assert.equal(clean(verdict(), {night: '2026-10-27'}).eures, 'on', 'a verdict from before the switch had EURES on');
  assert.equal(clean({...verdict(), eures: '<b>'}, {night: '2026-10-27'}).eures, 'on', 'only the fixed words');
  const first = judgeNight(off({locals: [1, 0, 0, 0, 0, 0]}), sums(USUAL));
  assert.deepEqual([first.reasons, first.usual, first.floor], [[], null, null], 'seven EURES-on nights are no baseline for the first EURES-off night');
  const offHistory = USUAL.map((n, i) => ({...stored(`2026-10-${String(20 + i).padStart(2, '0')}`, {locals: [n, 0, 0, 0, 0, 0]}), eures: 'off'})).reverse();
  assert.deepEqual(judgeNight(off({locals: [8, 0, 0, 0, 0, 0]}), offHistory).reasons, ['local'], 'seven EURES-off nights are its baseline');
  assert.deepEqual(judgeNight(stored('2026-10-27', {locals: [1, 0, 0, 0, 0, 0]}), offHistory).floor, null, 'and an EURES-on night is not judged against them');
  const html = nightSection(judgeAll([off({locals: [3, 0, 0, 0, 0, 0]})]), {1: {total: 6, reachable: 6, eures: 6}});
  assert.match(html, /EURES off: our own sources only/);
  assert.match(html, /Ours 3 of EURES 6/);
  assert.doesNotMatch(nightSection(judgeAll([stored('2026-10-27', {})]), {1: {total: 6, reachable: 6, eures: 6}}), /Ours \d/, 'with EURES on, our total includes EURES: no "ours of" line');
});
