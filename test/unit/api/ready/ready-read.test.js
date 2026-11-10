// Cloud browser runner 2/4 (api/ready-read.js; spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): the site starts a `readiness` night, keeps each read sealed, and hands it to the app once.
// Owner, 8 Nov 2026: "Site holds it, encrypted" (the app takes it and it is removed on the site). A read is page text (flags, required-question labels), never the person's data, and still never in a log, an admin page or an event.
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
  for (const file of ['0015_ai_calls.sql', '0021_ai_cost.sql', '0043_ai_cost_provider.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_hosted.sql', '0089_ready.sql', '0090_ready_fill_at.sql', '0091_ready_ai_stopped.sql', '0097_ready_line.sql', '0098_ready_turn.sql', '0142_ready_mailed.sql', '0143_ready_task.sql', '0144_ready_read_day.sql']) db.exec(sql(file));
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

test('a readiness night is its own night: a fill night of the same day is not replaced, and each is told its task', async () => {
  const e = env();
  const fill = await (await call(e, 'POST', 'batch', fillBody(), await owner())).json();
  const read = await (await call(e, 'POST', 'batch', readBody(), await owner())).json();
  assert.ok(fill.batch && read.batch && fill.batch !== read.batch);
  assert.deepEqual(e.STATS.db.prepare('SELECT task FROM ready_batches ORDER BY task').all().map(row => row.task), ['fill', 'readiness']);
  const again = await (await call(e, 'POST', 'batch', readBody(), await owner())).json();   // a second readiness post for the day replaces the first readiness night only
  assert.deepEqual(e.STATS.db.prepare('SELECT id, task FROM ready_batches ORDER BY task').all().map(row => ({...row})), [{id: fill.batch, task: 'fill'}, {id: again.batch, task: 'readiness'}]);
  const token = {authorization: `Bearer ${await readyToken(e, again.batch)}`};
  assert.equal((await call(e, 'GET', 'batch', undefined, token)).status, 401);   // queued, not started: no token yet works
  for (const bad of ['auto', 'Fill', 7, {}]) assert.equal((await call(e, 'POST', 'batch', {...readBody(), task: bad}, await owner())).status, 400, `task ${JSON.stringify(bad)}`);
  assert.equal((await call(e, 'POST', 'batch', readBody(), await stranger())).status, 401);
});

test('a readiness batch keeps only the pages to read: no contact, no facts, no kit, nothing of the person', async () => {
  const {e, bearer} = await night();
  for (const bytes of e.HOSTED_STATE.m.values()) {
    const text = new TextDecoder().decode(bytes);
    for (const word of ['secretprofile', 'alex@example', 'boards.example.com']) assert.ok(!text.includes(word), `${word} is not stored in the clear`);
  }
  const batch = await (await call(e, 'GET', 'batch', undefined, bearer)).json();   // what the container reads, decrypted
  assert.equal(batch.task, 'readiness');
  assert.deepEqual([batch.contact, Object.values(batch.facts).join(''), batch.readyBy], [{}, '', '']);
  assert.deepEqual(batch.jobs.map(job => [job.id, job.url, job.kit, job.letter, job.cv, job.letterPdf]), [['j1', jobs()[0].url, {}, '', '', ''], ['j2', jobs()[1].url, {}, '', '', '']]);
});

test('run starts the night of the task asked for, and the queue message carries it', async () => {
  const e = env();
  await call(e, 'POST', 'batch', fillBody(), await owner());
  await call(e, 'POST', 'batch', readBody(), await owner());
  const read = await call(e, 'POST', 'run', {task: 'readiness'}, await owner());
  assert.equal(read.status, 202);
  assert.deepEqual(e.READY_QUEUE.sent.map(message => message.task), ['readiness']);
  const fill = await call(e, 'POST', 'run', {}, await owner());   // no task: the fill night, as before
  assert.equal(fill.status, 202);
  assert.deepEqual(e.READY_QUEUE.sent.map(message => message.task), ['readiness', 'fill']);
  assert.equal((await call(e, 'POST', 'run', {task: 'auto'}, await owner())).status, 400);
  assert.equal((await call(e, 'POST', 'run', {task: 'readiness'}, await stranger())).status, 401);
});

test('the cron starts a due readiness night with its task too, and the runner passes the task to /run', async () => {
  const e = env();
  await call(e, 'POST', 'batch', readBody(), await owner());
  assert.equal((await tick(e, new Date('2026-11-08T21:05:00Z'))).started, 1);
  assert.equal(e.READY_QUEUE.sent[0].task, 'readiness');
  const bodies = [];
  const done = await consume({messages: [{body: e.READY_QUEUE.sent[0], ack() {}}, {body: {batch: 'old', token: 't', site: 's'}, ack() {}}]}, () => ({fetch: async request => { bodies.push(JSON.parse(await request.text())); return new Response('{"ok":true}', {status: 202}); }}));
  assert.equal(done.ok, 2);
  assert.equal(bodies[0].task, 'readiness');
  assert.equal(bodies[1].task, undefined, 'a message from before this change still starts a fill night');
});

test('a read is sealed on the site, and the rows hold words and counts only', async () => {
  const {e, made, bearer} = await night();
  const posted = await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ, why: '', ms: 41000, costMicro: 50000}, bearer);   // under today's $0.15 (api/ready-read-access.js)
  assert.equal(posted.status, 200);
  assert.deepEqual(await posted.json(), {ok: true, stop: false});
  const keys = [...e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/'));
  assert.deepEqual(keys, [`ready/owner-install-1/read/${made.batch}/j1.json`]);
  for (const bytes of e.HOSTED_STATE.m.values()) assert.ok(!new TextDecoder().decode(bytes).includes(QUESTION), 'the question label is not stored in the clear');
  const row = e.STATS.db.prepare("SELECT * FROM ready_jobs WHERE job = 'j1'").get();
  assert.equal(row.state, 'read');
  assert.ok(!JSON.stringify(row).includes(QUESTION) && !JSON.stringify(row).includes('Work permit'));
  assert.equal(e.STATS.db.prepare('SELECT cost_micro FROM ready_batches WHERE id = ?').get(made.batch).cost_micro, 50000);
});

test('the result of a readiness night is checked: only its outcomes, never a fill outcome; a bad or oversize read is stored as unreadable', async () => {
  const {e, bearer} = await night();
  for (const body of [{job: 'j1', state: 'prepared', filled: 3, left: 0}, {job: 'j1', task: 'readiness', state: 'submitted'}]) assert.equal((await call(e, 'POST', 'result', body, bearer)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(e.STATS.db.prepare("SELECT state FROM ready_jobs WHERE job = 'j1'").get().state, 'queued');
  // Why (code review of 2/4): a refusal is ignored by the container, which would leave the row "reading" until the night's end.
  const bads = [['text', 'bad read'], [null, 'bad read'], [{questions: 'x'.repeat(40000)}, 'too large'], [{questions: 'é'.repeat(20000)}, 'too large']];
  for (const [read, why] of bads) {
    const one = await night();   // a fresh night each: the last form's result ends a night and its token with it
    assert.equal((await call(one.e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read}, one.bearer)).status, 200);
    assert.deepEqual({...one.e.STATS.db.prepare("SELECT state, wall FROM ready_jobs WHERE job = 'j1'").get()}, {state: 'unreadable', wall: why});
    assert.deepEqual([...one.e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/')), [], 'no object for a read that was not kept');
  }
  assert.equal((await call(e, 'POST', 'result', {job: 'nope', task: 'readiness', state: 'unreadable', read: null, why: 'x'}, bearer)).status, 404);
  const fill = env(); await call(fill, 'POST', 'batch', fillBody(), await owner()); await call(fill, 'POST', 'run', {}, await owner());
  const made = fill.STATS.db.prepare('SELECT id FROM ready_batches').get().id;
  assert.equal((await call(fill, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, {authorization: `Bearer ${await readyToken(fill, made)}`})).status, 400, 'a fill night never takes a read');
});

test('a repeated result for a form already read keeps its read (a container retry after a timeout)', async () => {
  const {e, bearer} = await night();
  const first = {job: 'j1', task: 'readiness', state: 'read', read: READ};
  await call(e, 'POST', 'result', first, bearer);
  assert.equal((await (await call(e, 'POST', 'result', {...first, read: {...READ, why: 'again'}}, bearer)).json()).dropped, true);
  const taken = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.deepEqual(taken.reads.map(read => [read.job, read.state, read.read]), [['j1', 'read', READ]], 'the first read is still there, unchanged');
});

test('a store error while taking leaves the read for the next call; a stopped form keeps no object', async () => {
  const {e, bearer} = await night();
  await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, bearer);
  const get = e.HOSTED_STATE.get; e.HOSTED_STATE.get = async () => { throw new Error('R2 down'); };
  const failed = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.deepEqual([failed.reads, failed.pending], [[], 2], 'nothing taken, nothing deleted; the form and the other one are still counted');
  e.HOSTED_STATE.get = get;
  assert.deepEqual((await (await call(e, 'POST', 'reads', {}, await owner())).json()).reads.map(read => [read.job, read.state]), [['j1', 'read']]);
  // the owner stopped j2 while it was read: its late result keeps nothing
  e.STATS.db.prepare("UPDATE ready_jobs SET state = 'stopped' WHERE job = 'j2'").run();
  assert.equal((await (await call(e, 'POST', 'result', {job: 'j2', task: 'readiness', state: 'read', read: READ}, bearer)).json()).dropped, true);
  assert.deepEqual([...e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/')), []);
});

test('the app takes the reads once: they come back opened, then they are gone from the site', async () => {
  const {e, made, bearer} = await night();
  assert.deepEqual(await (await call(e, 'POST', 'reads', {}, await owner())).json(), {ok: true, reads: [], pending: 2});
  await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ, why: '', ms: 41000, costMicro: 10}, bearer);
  await call(e, 'POST', 'result', {job: 'j2', task: 'readiness', state: 'unreadable', read: null, why: 'afterApply', ms: 30000, costMicro: 10}, bearer);
  assert.equal((await call(e, 'POST', 'reads', {}, await stranger())).status, 401);
  assert.equal((await call(e, 'POST', 'reads', {}, bearer)).status, 401);   // the night token does not read what the night wrote
  assert.equal((await call(e, 'GET', 'reads', undefined, await owner())).status, 405);   // taking removes: never a GET
  const taken = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.equal(taken.pending, 0);
  assert.deepEqual(taken.reads.map(read => ({job: read.job, state: read.state, why: read.why, night: read.night})), [{job: 'j1', state: 'read', why: '', night: '2026-11-09'}, {job: 'j2', state: 'unreadable', why: 'afterApply', night: '2026-11-09'}]);
  assert.deepEqual(taken.reads[0].read, READ);
  assert.equal(taken.reads[1].read, null);
  assert.deepEqual([...e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/')), [], 'nothing of the reads is left');
  assert.deepEqual(await (await call(e, 'POST', 'reads', {}, await owner())).json(), {ok: true, reads: [], pending: 0});
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches WHERE id = ?').get(made.batch).state, 'deleted', 'a night with nothing left is deleted');
  assert.ok(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_jobs WHERE cleared_at IS NOT NULL').get().n === 2);
});

test("one person's reads never reach another install, and a fill night's rows are not taken as reads", async () => {
  const {e, bearer} = await night();
  await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, bearer);
  assert.deepEqual((await (await call({...e, READY_OWNER: 'someone-else-9'}, 'POST', 'reads', {}, await stranger())).json()).reads, []);
  await call(e, 'POST', 'batch', fillBody(), await owner());
  e.STATS.db.prepare("UPDATE ready_jobs SET state = 'failed' WHERE batch IN (SELECT id FROM ready_batches WHERE task = 'fill')").run();
  assert.deepEqual((await (await call(e, 'POST', 'reads', {}, await owner())).json()).reads.map(read => read.job), ['j1']);
});

test('a finished readiness night closes its container at once and mails nothing', async () => {
  const {e, made, bearer} = await night();
  await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, bearer);
  assert.equal(e.READY_RUNNER.seen.length, 0, 'one job still reading');
  const last = await (await call(e, 'POST', 'result', {job: 'j2', task: 'readiness', state: 'failed', read: null, why: 'the night could not start'}, bearer)).json();
  assert.deepEqual(last, {ok: true, stop: true});
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches WHERE id = ?').get(made.batch).state, 'finished');
  assert.ok(e.READY_RUNNER.seen.some(url => url.startsWith(`https://runner/close?batch=${made.batch}`)), 'nothing is held, so the container is not kept for 3 h');
  assert.equal(e.STATS.db.prepare('SELECT mailed_at FROM ready_batches WHERE id = ?').get(made.batch)?.mailed_at ?? null, null);
  const taken = await (await call(e, 'POST', 'reads', {}, await owner())).json();
  assert.deepEqual(taken.reads.map(read => [read.job, read.state, read.why]), [['j1', 'read', ''], ['j2', 'failed', 'the night could not start']]);
});

test('Ready to send does not see readiness nights in its state, report or morning; Stop reaches them', async () => {
  const e = env();
  await call(e, 'POST', 'batch', fillBody(), await owner());
  await call(e, 'POST', 'batch', readBody(), await owner());   // the newer batch of the same night
  const state = await (await call(e, 'GET', 'state', undefined, await owner())).json();
  assert.deepEqual(state.jobs.map(job => job.job), ['j1'], "only the fill night's one row");
  assert.equal((await (await call(e, 'GET', 'report', undefined, await owner())).json()).nights.length, 1);
  await call(e, 'POST', 'run', {task: 'readiness'}, await owner());   // the readiness night runs; the fill night is still queued
  assert.equal((await call(e, 'GET', 'held', undefined, await owner())).status, 404, 'a read night holds no tab for the morning');
});

test('Stop on the rows stops a readiness night too: its forms read stopped, the container is told at its next step, the night ends and its container closes', async () => {
  // Coordinator, 9 Nov 2026 (cloud runner 3/4 scope, finding 3 of 2/4's review): Stop on the rows stops a readiness night too.
  const {e, made, bearer} = await night();
  await call(e, 'POST', 'batch', fillBody(), await owner());   // a fill night waiting beside it
  assert.equal((await (await call(e, 'POST', 'progress', {job: 'j1', step: 'looking'}, bearer)).json()).stop, false);
  assert.deepEqual(await (await call(e, 'POST', 'stop', {job: 'j1'}, await owner())).json(), {ok: true, stopped: 2}, 'j1 in both nights');
  assert.equal((await (await call(e, 'POST', 'progress', {job: 'j1', step: 'looking'}, bearer)).json()).stop, true, 'the container drops this form at its next step');
  assert.equal((await (await call(e, 'POST', 'progress', {job: 'j2', step: 'looking'}, bearer)).json()).stop, false, 'the other form is not told to stop');
  assert.equal((await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, bearer)).status, 200, 'a late result is dropped, not an error');
  assert.deepEqual([...e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/')), [], 'a stopped form keeps no read');
  assert.deepEqual(await (await call(e, 'POST', 'stop', {}, await owner())).json(), {ok: true, stopped: 1}, 'the whole night: what is left, j2');
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches WHERE id = ?').get(made.batch).state, 'finished');
  assert.ok(e.READY_RUNNER.seen.some(url => url.startsWith(`https://runner/close?batch=${made.batch}`)), 'nothing is held, so the container closes at once');
  assert.deepEqual((await (await call(e, 'POST', 'reads', {}, await owner())).json()).reads, [], 'stopped forms are not reads to take');
  assert.equal((await call(e, 'POST', 'stop', {}, await owner())).status, 404, 'nothing left to stop');
});

test('Stop reaches the newest open night of each task only, and a readiness night that has not started wakes no container', async () => {
  const e = env();
  const older = await (await call(e, 'POST', 'batch', {...fillBody(), night: '2026-11-08'}, await owner(), new Date('2026-11-08T12:00:00Z'))).json();   // last night's, still open (an earlier stamp than the other two, which share `evening`)
  const newer = await (await call(e, 'POST', 'batch', fillBody(), await owner())).json();
  const read = await (await call(e, 'POST', 'batch', readBody(), await owner())).json();   // queued: no container yet
  assert.deepEqual(await (await call(e, 'POST', 'stop', {}, await owner())).json(), {ok: true, stopped: 3}, 'the newer fill row and the two read rows');
  const states = batch => e.STATS.db.prepare('SELECT j.state FROM ready_jobs j WHERE j.batch = ? ORDER BY j.job').all(batch).map(row => row.state);
  assert.deepEqual([states(older.batch), states(newer.batch), states(read.batch)], [['queued'], ['stopped'], ['stopped', 'stopped']], "last night's open batch is not this press's");
  assert.deepEqual(e.READY_RUNNER.seen, [], 'a night that never started has no container to close');
});

test('the night token may report a read night\'s steps, and only that night', async () => {
  const {e, bearer} = await night();
  for (const step of ['opening', 'looking', 'pressing', 'landed', 'judging', 'planning']) assert.equal((await (await call(e, 'POST', 'progress', {job: 'j1', step, n: 1}, bearer)).json()).stop, false, step);
  assert.equal((await call(e, 'POST', 'progress', {job: 'j1', step: 'filling'}, bearer)).status, 400, 'a fill step is not a read step');
  const fill = env(); await call(fill, 'POST', 'batch', fillBody(), await owner()); await call(fill, 'POST', 'run', {}, await owner());
  const made = fill.STATS.db.prepare('SELECT id FROM ready_batches').get().id;
  assert.equal((await call(fill, 'POST', 'progress', {job: 'j1', step: 'looking'}, {authorization: `Bearer ${await readyToken(fill, made)}`})).status, 400);
});

test('unread reads go with the day: the sweep removes them, and no read code logs', async () => {
  const {e, bearer} = await night();
  await call(e, 'POST', 'result', {job: 'j1', task: 'readiness', state: 'read', read: READ}, bearer);
  const swept = await sweep(e, new Date('2026-11-10T00:00:00Z'));
  assert.equal(swept.swept, 1);
  assert.deepEqual([...e.HOSTED_STATE.m.keys()].filter(key => key.includes('/read/')), []);
  assert.deepEqual((await (await call(e, 'POST', 'reads', {}, await owner())).json()).reads, []);
  const source = readFileSync(new URL('../../../../api/ready-read.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.|track\(|logEvent|telemetry/, 'a read is never logged or sent as an event');
});
