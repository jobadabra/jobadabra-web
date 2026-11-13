// The Always on LinkedIn trial's gate (api/linkedin-turn.js): only the owner's install gets a turn, by either way; one GET per lease, 20 s apart, 30 a day; a stop answer stops the cloud for 24 h;
// a 200's cards are served from the cache for 6 h without a request. Owner, 13 Nov 2026: "Both ways", caps "Approve as written", "Yes, 6 h cache", "Start at 30/day, raise on clean days".
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../../../shared/guard.js';
import {schedule, startRun} from '../../../shared/hosted.js';
import {mintTrialKey} from '../../../shared/trial-key.js';
import {answer, capOf, kindOf, turn} from '../../../api/linkedin-turn.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0130_hosted_test_checks.sql', '0157_linkedin_turns.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }});
  return {db, prepare: text => statement(text)};
}
const kv = () => { const m = new Map(); return {get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
const OWNER = 'install-owner1', OTHER = 'install-other1';
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-11-14T10:00:00Z');
const at = s => new Date(now.getTime() + s * 1000);
const SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=sre&location=Geneva&start=0';
const post = (path, body, headers) => new Request(`https://x/api/linkedin/${path}`, {method: 'POST', headers, body: JSON.stringify(body)});

async function setup(extra = {}) {
  const e = {STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', HOSTED_ALWAYS_ON: 'on', LINKEDIN_CLOUD_TRIAL: 'on', READY_OWNER: OWNER, ...extra};
  const runOf = async (install, email) => {
    await schedule(new Request('https://x/s', {method: 'PUT', headers: {'x-api-key': await keyOf(install)}, body: JSON.stringify({on: true, email})}), e, now);
    const row = e.STATS.db.prepare('SELECT * FROM hosted_schedules ORDER BY rowid DESC').get();
    return {authorization: `Bearer ${(await startRun(e, row, now)).token}`};
  };
  const repo = async install => ({'x-api-key': (await (await mintTrialKey(new Request('https://x/t', {method: 'POST', headers: {'x-api-key': await keyOf(install)}}), e, install)).json()).key});
  return {e, hosted: await runOf(OWNER, 'owner@example.com'), github: await repo(OWNER), otherRun: await runOf(OTHER, 'other@example.com'), otherRepo: await repo(OTHER)};
}
const ask = async (e, headers, when = now, url = SEARCH) => (await turn(post('turn', {url}, headers), e, when)).json();
const tell = async (e, headers, body, when = now) => (await answer(post('answer', body, headers), e, when)).json();

test('only LinkedIn\'s public search and job pages are turns; anything else is refused', () => {
  assert.equal(kindOf(SEARCH), 'search');
  assert.equal(kindOf('https://www.linkedin.com/jobs/view/4012345678/'), 'job');
  for (const url of ['https://www.linkedin.com/feed/', 'https://www.linkedin.com/jobs/search/?keywords=sre', 'http://www.linkedin.com/jobs/view/1/', 'https://evil.example/jobs/view/1/', 'x']) assert.equal(kindOf(url), null, url);
});

test('the owner gets a turn by both ways; another install hears no and sends nothing; a bad key is 401; the switch off is 404', async () => {
  const {e, hosted, github, otherRun, otherRepo} = await setup();
  const first = await ask(e, hosted);
  assert.equal(first.answer, 'go');
  await tell(e, hosted, {lease: first.lease, status: 200, word: 'cards'}, at(1));
  assert.equal((await ask(e, github, at(60), SEARCH.replace('start=0', 'start=10'))).answer, 'go');
  for (const headers of [otherRun, otherRepo]) assert.equal((await ask(e, headers, at(120))).answer, 'no');
  assert.equal((await turn(post('turn', {url: SEARCH}, {'x-api-key': 'JPT1.' + 'a'.repeat(32) + '.bad'}), e, now)).status, 401);
  assert.equal((await turn(post('turn', {url: SEARCH}, hosted), {...e, LINKEDIN_CLOUD_TRIAL: 'off'}, now)).status, 404);
  assert.equal((await turn(post('turn', {url: SEARCH}, hosted), {...e, READY_OWNER: ''}, now)).status, 404);
});

test('one GET at a time, at least 20 s apart: an open lease and a fresh GET make the next ask wait', async () => {
  const {e, hosted, github} = await setup();
  const first = await ask(e, hosted);
  const waiting = await ask(e, github, at(5));
  assert.equal(waiting.answer, 'wait');
  assert.ok(waiting.seconds >= 15 && waiting.seconds <= 85, `waits for the lease: ${waiting.seconds}`);
  assert.deepEqual(await tell(e, hosted, {lease: first.lease, status: 200, word: 'cards'}, at(6)), {ok: true});
  assert.equal((await ask(e, github, at(10), SEARCH.replace('start=0', 'start=10'))).seconds, 10);   // answered, still the 20 s gap
  assert.equal((await ask(e, github, at(21), SEARCH.replace('start=0', 'start=10'))).answer, 'go');
});

test('30 GETs a day to start, then no until the next day; a raise is capped at 200', async () => {
  const {e, hosted, github} = await setup();
  for (let i = 0; i < 30; i++) {
    const got = await ask(e, hosted, at(i * 30), SEARCH.replace('start=0', `start=${i}`));
    assert.equal(got.answer, 'go', `GET ${i + 1}`);
    await tell(e, hosted, {lease: got.lease, status: 200, word: 'cards'}, at(i * 30 + 1));
  }
  assert.match((await ask(e, hosted, at(30 * 30), SEARCH.replace('start=0', 'start=99'))).why, /30 LinkedIn reads for today are used/);
  assert.equal((await ask(e, github, new Date('2026-11-15T00:00:30Z'), SEARCH.replace('start=0', 'start=99'))).answer, 'go');
  assert.equal(capOf({}), 30);
  assert.equal(capOf({LINKEDIN_CLOUD_A_DAY: '60'}), 60);
  assert.equal(capOf({LINKEDIN_CLOUD_A_DAY: '5000'}), 200);
  assert.equal(capOf({LINKEDIN_CLOUD_A_DAY: 'x'}), 30);
});

test('a 429, 999 or sign-in page stops the cloud for 24 h, both ways, no retry', async () => {
  for (const stop of [{status: 429}, {status: 999}, {status: 200, word: 'signin'}]) {
    const {e, hosted, github} = await setup();
    const got = await ask(e, hosted);
    await tell(e, hosted, {lease: got.lease, ...stop}, at(2));
    const later = await ask(e, github, at(3600));
    assert.equal(later.answer, 'no', JSON.stringify(stop));
    assert.match(later.why, /the cloud reads none until 2026-11-15T10:00:02/);
    assert.equal((await ask(e, github, at(24 * 3600 + 3))).answer, 'go');
  }
});

test('a 200\'s cards are served from the cache for 6 h (job pages 24 h) without a GET; a lease answers once', async () => {
  const {e, hosted, github} = await setup();
  const got = await ask(e, hosted);
  await tell(e, hosted, {lease: got.lease, status: 200, word: 'page', body: '<li>card</li>'}, at(1));
  assert.equal((await answer(post('answer', {lease: got.lease, status: 200}, hosted), e, at(2))).status, 409);
  assert.deepEqual(await ask(e, github, at(3 * 3600)), {answer: 'cached', body: '<li>card</li>'});
  assert.equal((await ask(e, github, at(6 * 3600 + 5))).answer, 'go');
  const job = 'https://www.linkedin.com/jobs/view/4012345678/';
  const viewed = await ask(e, github, at(7 * 3600), job);   // a run token lives 30 minutes: hours later it is the repo's run
  await tell(e, github, {lease: viewed.lease, status: 200, word: 'page', body: '<div>job</div>'}, at(7 * 3600 + 1));
  assert.equal((await ask(e, github, at(30 * 3600), job)).answer, 'cached');
  const {n} = e.STATS.db.prepare("SELECT COUNT(*) AS n FROM linkedin_turns WHERE answer = 'go'").get();
  assert.equal(n, 3, 'cached answers sent nothing to LinkedIn');
});

test('the turns keep no address, no install and no page text: only a hash, the way, the status and one word', async () => {
  const {e, hosted} = await setup();
  const got = await ask(e, hosted);
  await tell(e, hosted, {lease: got.lease, status: 200, word: 'page', body: '<li>card</li>'}, at(1));
  const row = e.STATS.db.prepare('SELECT * FROM linkedin_turns').get();
  assert.deepEqual(Object.keys(row).sort(), ['answer', 'answered_at', 'asked_at', 'day', 'id', 'kind', 'status', 'url_hash', 'way', 'word']);
  assert.ok(!JSON.stringify(row).includes('Geneva') && !JSON.stringify(row).includes(OWNER));
});

test('a lease is answered once, by its string id; a body without the page word is never cached; a stop is never shortened', async () => {
  const {e, hosted, github} = await setup();
  const got = await ask(e, hosted);
  for (const lease of [123, {id: got.lease}, [got.lease], null]) assert.equal((await answer(post('answer', {lease, status: 200}, hosted), e, at(1))).status, 409, JSON.stringify(lease));
  await tell(e, hosted, {lease: got.lease, status: 200, body: '<html>sign in</html>'}, at(2));   // no word: not a page the engine checked
  assert.equal((await ask(e, github, at(30))).answer, 'go', 'not served from the cache');
  const {db} = e.STATS;
  db.prepare("INSERT INTO linkedin_stop (id, until, why) VALUES (1, '2026-11-16T00:00:00.000Z', '429')").run();
  const open = db.prepare("SELECT id FROM linkedin_turns WHERE answered_at IS NULL").get();
  await tell(e, github, {lease: open.id, status: 999}, at(40));
  assert.equal(db.prepare('SELECT until FROM linkedin_stop').get().until, '2026-11-16T00:00:00.000Z');
});
