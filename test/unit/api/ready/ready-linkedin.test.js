// The `linkedin` night (api/ready-linkedin.js; spec jobadabra docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6): the owner's one LinkedIn cloud read. Guard: privacy — the LinkedIn session is sealed with the batch, handed only to that night's token, gone the moment the night reports, and never in a row, a read or an error.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../../../../shared/guard.js';
import {ready, readyToken, sweep} from '../../../../api/ready.js';
import {consume} from '../../../../api/ready-consume.js';
import {tick} from '../../../../api/ready-tick.js';

const sql = file => readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql', '0142_ready_mailed.sql', '0143_ready_task.sql', '0144_ready_read_day.sql', '0145_ready_read_lanes.sql', '0146_ready_auto.sql']) db.exec(sql(file));
  db.exec('CREATE TABLE anomalies (day TEXT, kind TEXT, who TEXT, n INTEGER, detail TEXT, PRIMARY KEY (day, kind, who))');
  db.exec('CREATE TABLE IF NOT EXISTS revoked (who TEXT PRIMARY KEY, reason TEXT, at TEXT)');
  const statement = (text, args = []) => ({bind: (...v) => statement(text, v), run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args).map(r => ({...r}))}), first: async () => { const r = db.prepare(text).get(...args); return r ? {...r} : null; }, text, args});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const r2 = () => { const m = new Map(), at = new Map(); return {m, put: async (k, v) => { m.set(k, new Uint8Array(v)); at.set(k, new Date('2026-11-08T21:00:00Z')); }, get: async k => (m.has(k) ? {arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength)} : null),
  head: async k => (m.has(k) ? {} : null), delete: async k => { for (const one of [k].flat()) m.delete(one); }, list: async ({prefix}) => ({objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({key, uploaded: at.get(key)}))})}; };
const queue = () => { const sent = []; return {sent, send: async message => { sent.push(message); }}; };
const runner = () => { const seen = []; return {seen, fetch: async request => { seen.push(request.url); return new Response('{"ok":true}', {status: 200}); }}; };
const env = (extra = {}) => ({STATS: d1(), HOSTED_STATE: r2(), STATS_SALT: 'salt', READY_KEK: 'kek-for-tests', READY_TO_SEND: 'on', READY_OWNER: 'owner-install-1', READY_OWNER_SECRET: 'owner-secret', READY_QUEUE: queue(), READY_RUNNER: runner(), ...extra});
const keyOf = async install => `JPF1.${install}.${await tokenFor(install, {STATS_SALT: 'salt'}, 'ai')}`;
const evening = new Date('2026-11-08T21:00:00Z');
const call = async (e, method, path, body, headers = {}, at = evening) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const owner = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
const stranger = async () => ({'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('someone-else-9')});
const QUESTION = 'Years of Rustacean experience';
const jobs = () => [{id: 'j1', url: 'https://boards.example.com/acme/jobs/1', title: 'SRE', company: 'Acme'}, {id: 'j2', url: 'https://jobs.example.org/p/2', title: 'DevOps', company: 'Nordlicht'}];
const readBody = (task = 'readiness') => ({task, night: '2026-11-09', contact: {name: 'Alex Example', email: 'alex@example.invalid'}, facts: {profile: 'secretprofile'}, jobs: jobs()});
const fillBody = () => ({night: '2026-11-09', readyBy: '07:30', contact: {name: 'Alex Example', email: 'alex@example.invalid'}, jobs: [{id: 'j1', url: 'https://boards.example.com/acme/jobs/1', title: 'SRE', company: 'Acme', kit: {}, letter: '', cv: ''}]});
const READ = {simple: false, why: 'questions', login: false, captcha: false, accountCreation: false, questions: [QUESTION, 'Work permit']};
// A readiness night started the way the app will (post, then run), with its token as the container gets it.
async function night(e = env(), body = readBody()) {
  const made = await (await call(e, 'POST', 'batch', body, await owner())).json();
  const run = await call(e, 'POST', 'run', {task: 'readiness'}, await owner());
  const bearer = {authorization: `Bearer ${await readyToken(e, made.batch)}`};
  return {e, made, run, bearer};
}

import {checkProbe, wordOf} from '../../../../api/ready-linkedin.js';

const SECRET = 'AQEDAR-secret-li-at-value';
const SEARCH = 'https://www.linkedin.com/jobs/search/?keywords=engineer&location=Switzerland';
const probeBody = (extra = {}) => ({task: 'linkedin', night: '2026-11-11', jobs: [{id: 'probe', url: SEARCH}], linkedin: {li_at: SECRET, JSESSIONID: '"ajax:1"'}, ...extra});
async function probeNight(e = env()) {
  const made = await (await call(e, 'POST', 'batch', probeBody(), await owner())).json();
  const run = await call(e, 'POST', 'run', {task: 'linkedin'}, await owner());
  return {e, made, run, bearer: {authorization: `Bearer ${await readyToken(e, made.batch)}`}};
}
const everything = e => JSON.stringify([e.STATS.db.prepare('SELECT * FROM ready_jobs').all(), e.STATS.db.prepare('SELECT * FROM ready_batches').all()]);

test('checkProbe: exactly one LinkedIn Jobs search address and a well-formed session; every error is a word, never the session', () => {
  assert.deepEqual(checkProbe(probeBody()), {session: {li_at: SECRET, JSESSIONID: '"ajax:1"'}});
  for (const bad of [probeBody({jobs: []}), probeBody({jobs: [{id: 'probe', url: 'https://example.com/jobs/search'}]}), probeBody({jobs: [{id: 'probe', url: 'http://www.linkedin.com/jobs/search'}]}),
    probeBody({jobs: [{id: 'probe', url: 'https://www.linkedin.com/in/someone'}]}), probeBody({jobs: [{id: 'x', url: SEARCH}]}), probeBody({jobs: [{id: 'probe', url: SEARCH}, {id: 'probe', url: SEARCH}]})]) assert.deepEqual(checkProbe(bad), {error: 'bad probe'});
  for (const bad of [probeBody({linkedin: undefined}), probeBody({linkedin: {li_at: 'has space'}}), probeBody({linkedin: {JSESSIONID: 'x'}}), probeBody({linkedin: {li_at: SECRET, JSESSIONID: 5}})]) assert.deepEqual(checkProbe(bad), {error: 'bad session'});
  assert.equal(wordOf({why: 'Check!!'}), 'check');
});

test('only the owner starts a linkedin night; a stranger and an Always on install are refused', async () => {
  const e = env();
  assert.equal((await call(e, 'POST', 'batch', probeBody(), await stranger())).status, 401);
  assert.equal((await call(e, 'POST', 'run', {task: 'linkedin'}, await stranger())).status, 401);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_batches').get().n, 0);
  assert.equal((await call(e, 'POST', 'batch', probeBody({jobs: []}), await owner())).status, 400);
});

test('the session is sealed with the batch, reaches only that night\'s token, and is gone once the night reports', async () => {
  const {e, made, bearer} = await probeNight();
  for (const bytes of e.HOSTED_STATE.m.values()) assert.ok(!new TextDecoder().decode(bytes).includes('secret'), 'sealed, not in the clear');
  const batch = await (await call(e, 'GET', 'batch', undefined, bearer)).json();
  assert.equal(batch.task, 'linkedin');
  assert.deepEqual(batch.linkedin, {li_at: SECRET, JSESSIONID: '"ajax:1"'});
  assert.deepEqual(batch.jobs.map(job => job.id), ['probe']);
  const reported = await call(e, 'POST', 'result', {job: 'probe', task: 'linkedin', state: 'read', read: {status: 200, path: '/jobs/search/', cards: 7, go: true, word: 'ok'}, why: 'ok', ms: 31000, costMicro: 372}, bearer);
  assert.equal(reported.status, 200);
  const after = await call(e, 'GET', 'batch', undefined, bearer);
  const gone = after.status === 200 ? await after.json() : {};
  assert.equal(gone.linkedin, undefined, 'no session after the result');
  assert.ok(!everything(e).includes('secret'));
  assert.equal(e.STATS.db.prepare("SELECT wall FROM ready_jobs WHERE job = 'probe'").get().wall, 'ok');
  assert.ok(made.batch);
});

test('a failed night also removes the session, and the app takes the one read once', async () => {
  const {e, bearer} = await probeNight();
  await call(e, 'POST', 'result', {job: 'probe', task: 'linkedin', state: 'failed', read: null, why: 'the night could not start', ms: 0, costMicro: 0}, bearer);
  const batch = await call(e, 'GET', 'batch', undefined, bearer);
  assert.equal((batch.status === 200 ? await batch.json() : {}).linkedin, undefined);
  const taken = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.deepEqual(taken.reads.map(read => [read.job, read.state]), [['probe', 'failed']]);
  assert.equal((await (await call(e, 'POST', 'reads', {}, await owner())).json()).reads.length, 0, 'taken once');
});

test('a check page is reported as a no and taken once; the read holds no session', async () => {
  const {e, bearer} = await probeNight();
  await call(e, 'POST', 'result', {job: 'probe', task: 'linkedin', state: 'read', read: {status: 200, path: '/checkpoint/challenge', cards: 0, go: false, word: 'check'}, why: 'check', ms: 20000, costMicro: 240}, bearer);
  const taken = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.equal(taken.reads.length, 1);
  assert.deepEqual([taken.reads[0].state, taken.reads[0].read.word, taken.reads[0].read.go, taken.reads[0].why], ['read', 'check', false, 'check']);
  assert.ok(!JSON.stringify(taken).includes('secret'));
});
