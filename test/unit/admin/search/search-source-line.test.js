// The morning line (owner, 11 Nov 2026, asked via AskUserQuestion: "Morning message: a source at 0 (Recommended)"; job boards gave 0 jobs for two weeks and he learned of it from a first Find jobs): when the night just uploaded has a source
// at 0 for the people who read it, the owner is told, one row per source with the night count rising, also when the night is otherwise fine. The rule is admin/search-source-zero.js, the one the Finish line chart's LOST chip reads.
// Guard for the alert `search-source-zero` in admin/search-night.js ingest, its card (shared/owner-cards.js sourceZeroCard) and its registry entry.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {connect, saveSetting} from '../../../../shared/notify.js';
import {ingestRoute} from '../../../../admin/search-night.js';
import {sourceZeroCard} from '../../../../shared/owner-cards.js';
import {checkCard} from '../../../../shared/tg-card.js';

const KEY = 'search-lab-key-0123456789', TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', START = Date.parse('2026-10-27T05:00:00Z');
const at = n => new Date(START + n * 86400000), day = n => at(n).toISOString().slice(0, 10);

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {db, prepare: sql => statement(sql)};
}
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
  return {fetcher, sends: () => calls.filter(call => call.method === 'sendMessage')};
}
const setup = async () => {
  const env = {STATS: d1(), NOTIFY_SECRET: 'vault-secret', REPLAYS_PUBLISH_KEY: KEY}, tg = telegram();
  assert.equal((await connect(env, 'engineering', TOKEN, '', tg.fetcher, at(0))).ok, true);
  return {env, tg};
};
// An 18-person night where every person is measured; `right` = right jobs per source for each person (undefined = the person sent no row for it).
const verdict = right => ({state: 'success', head: 'measured 18 of 18', eures: 'off', rows: Array.from({length: 18}, (_, i) => ({persona: i + 1, label: `p${i + 1} Fictional, Town`, kind: 'measured', why: '', local: 2, found: 7, seconds: 100,
  sources: Object.fromEntries(Object.entries(right).filter(([, value]) => value !== undefined).map(([source, value]) => [source, {right: value}]))}))});
const OK = {employer_sites: 1, job_boards: 1, free_job_apis: 1, web_search: 1};
const upload = async (n, right, {env, tg}) => (await ingestRoute(new Request(`https://www.jobadabra.top/search-check/night?night=${day(n)}`, {method: 'PUT', headers: {Authorization: `Bearer ${KEY}`}, body: JSON.stringify(verdict(right))}), env, at(n), tg.fetcher)).json();

test('the card: one source, several sources, "all 18" or "the N who read it"; counts only; one shape', () => {
  const one = sourceZeroCard([{label: 'Job boards', readers: 18, total: 18, run: 3}]), many = sourceZeroCard([{label: 'Job boards', readers: 18, total: 18, run: 3}, {label: 'Web search', readers: 9, total: 18, run: 1}]);
  assert.match(one.text, /^🟠 <b>Night search: Job boards brought no right job<\/b>[\s\S]*Job boards: 0 right jobs for all 18 people, night 3 in a row/);
  assert.match(many.text, /<b>Night search: 2 sources brought no right job<\/b>[\s\S]*Web search: 0 right jobs for the 9 who read it of 18 people, night 1 in a row/);
  for (const card of [one, many]) assert.deepEqual(checkCard(card), []);
});

test('the owner\'s case from 27 Oct: job boards at 0 on 14 nights tells on each of them with the count rising, also when the night is otherwise fine; employer sites never; one row per night', async () => {
  const run = await setup(), told = [];
  for (let n = 0; n < 16; n++) {
    const answer = await upload(n, {...OK, job_boards: n < 2 ? 5 : 0}, run);
    assert.equal(answer.dropped, false, 'the night itself is fine: nothing else dropped');
    told.push([answer.zero.map(item => item.source).join(), answer.zeroAlert]);
  }
  assert.deepEqual(told.slice(0, 3), [['', null], ['', null], ['job_boards', 'sent']]);
  assert.equal(run.tg.sends().length, 14, 'one message per night at 0, never one for the nights that were fine');
  assert.deepEqual(run.tg.sends().map(call => Number(/night (\d+) in a row/.exec(call.body.text)[1])), Array.from({length: 14}, (_, i) => i + 1), 'the count rises by one a night');
  assert.ok(run.tg.sends().every(call => !/Employer sites/.test(call.body.text)), 'employer sites bring jobs every night: never named');
});

test('a second upload of the same night is held; a night that did not read the source keeps the count; a night with right jobs says nothing and starts over', async () => {
  const run = await setup();
  await upload(0, {...OK, job_boards: 0}, run);
  assert.equal((await upload(0, {...OK, job_boards: 0}, run)).zeroAlert, 'same-state', 'a re-run of the same night: the same words are not sent twice');
  assert.equal((await upload(1, {employer_sites: 1}, run)).zeroAlert, null, 'no row for job boards: not read, neither fires nor counts');
  await upload(2, {...OK, job_boards: 0}, run);
  assert.match(run.tg.sends().at(-1).body.text, /night 2 in a row/, 'the not-read night did not break the run');
  assert.equal((await upload(3, OK, run)).zeroAlert, null);
  await upload(4, {...OK, job_boards: 0}, run);
  assert.match(run.tg.sends().at(-1).body.text, /night 1 in a row/);
});

test('EURES off and LinkedIn never tell; switched off in Notifications it says "off"', async () => {
  const run = await setup();
  const answer = await upload(0, {...OK, eures: 0, linkedin: 0}, run);
  assert.deepEqual([answer.zero, answer.zeroAlert, run.tg.sends().length], [[], null, 0]);
  await saveSetting(run.env, 'search-source-zero', {enabled: false}, at(0));
  assert.equal((await upload(1, {...OK, job_boards: 0}, run)).zeroAlert, 'off');
  assert.equal(run.tg.sends().length, 0);
});
