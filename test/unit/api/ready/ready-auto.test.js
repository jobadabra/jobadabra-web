// Guard: safety, money — without it the site could start a Full automation night with no confirmation of the person's, let one job be pressed twice, lose a press a Stop crossed, or let a loop submit without end.
// Cloud browser runner 4/4, cs 2/4 (api/ready-auto.js; spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"). Owner, 10 Nov 2026 (asked via AskUserQuestion, relayed by the coordinator):
// "Build it now (Recommended)": Pro on Always on, its jobs submitted by the cloud browser while its Mac is off; "~500/day + alert (Recommended)": an abuse ceiling only, the owner told once.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../../../../shared/guard.js';
import {ready, readyToken} from '../../../../api/ready.js';
import {tick} from '../../../../api/ready-tick.js';
import {sweep} from '../../../../api/ready.js';
import {checkItem} from '../../../../api/ready-auto.js';

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
const evening = new Date('2026-11-09T21:00:00Z');
const call = async (e, method, path, body, headers = {}, at = evening) => ready(new Request(`https://x/api/ready/${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), e, at);
const member = async (install = 'member-1') => ({'x-api-key': await keyOf(install)});   // an Always on install: its own key, no owner secret
const kv = () => { const m = new Map(); return {m, get: async key => m.get(key) ?? null, put: async (key, value) => { m.set(key, value); }, delete: async key => { m.delete(key); }}; };
const always = (extra = {}, state = 'on') => {
  const e = env({HOSTED_ALWAYS_ON: 'on', ...extra});
  e.STATS.db.prepare('INSERT INTO hosted_schedules (account, install, freq_hours, next_run_at, state, last_seen_at, created_at) VALUES (?, ?, 24, ?, ?, ?, ?)').run('acct-1', 'member-1', '2026-11-10T00:00:00Z', state, '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z');
  return e;
};
const forms = (n, base = 0) => Array.from({length: n}, (_, i) => ({id: `j${base + i}`, url: `https://boards.example.com/acme/jobs/${base + i}`, title: 'SRE', company: 'Acme'}));

const credit = e => {
  e.STATS.db.exec('CREATE TABLE IF NOT EXISTS install_credit (install TEXT PRIMARY KEY, credit_micro INTEGER NOT NULL DEFAULT 0, credit_added_micro INTEGER NOT NULL DEFAULT 0, updated_at TEXT)');
  e.STATS.db.prepare("INSERT INTO install_credit (install, credit_micro, credit_added_micro, updated_at) VALUES ('member-1', 5000000, 5000000, 'x')").run();
  return e;
};
const pro = (extra = {}) => credit(always({READY_AUTO: 'on', PRO_PLAN: 'promo', WAITLIST: kv(), ...extra}));
const itemOf = job => ({job: job.id, url: job.url, session: `s-${job.id}`, state: 'cloud', manualOverride: false, mode: 'auto', chosenAt: '2026-11-01T10:00:00.000Z', autoConfirmedAt: '2026-11-09T20:00:00.000Z',
  queuedAt: Date.parse('2026-11-09T20:01:00Z'), waitMin: 0, allowIneligible: false});
const autoBatch = (n = 2, night = '2026-11-09', base = 0, change = job => job) => ({task: 'auto', night, jobs: forms(n, base).map(job => change({...job, stage: 'Kit ready', kit: {eligible: true}, item: itemOf(job)}))});
const started = async (e, body = autoBatch()) => {
  const made = await (await call(e, 'POST', 'batch', body, await member())).json();
  await call(e, 'POST', 'run', {task: 'auto'}, await member());
  return {made, bearer: {authorization: `Bearer ${await readyToken(e, made.batch)}`}};
};
const reserveFor = async (e, bearer, job) => call(e, 'POST', 'reserve', {job}, bearer);
const report = async (e, bearer, body) => (await call(e, 'POST', 'result', {task: 'auto', ms: 30000, costMicro: 400, ...body}, bearer)).json();
const stateOf = (e, job) => ({...e.STATS.db.prepare('SELECT state, wall, attempt FROM ready_jobs WHERE job = ?').get(job)});

test('the kill switch and Pro: READY_AUTO off answers 404; a Free install is refused with the words; a Pro install queues and starts its night', async () => {
  assert.equal((await call(credit(always({PRO_PLAN: 'promo', WAITLIST: kv()})), 'POST', 'batch', autoBatch(), await member())).status, 404, 'off by default');
  const free = always({READY_AUTO: 'on', WAITLIST: kv()});
  const refused = await call(free, 'POST', 'batch', autoBatch(), await member());
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /part of Pro/);
  assert.equal((await call(free, 'POST', 'run', {task: 'auto'}, await member())).status, 402, 'nor can it start one');
  const e = pro();
  const {made} = await started(e);
  assert.equal(made.queued, 2);
  assert.equal(e.READY_QUEUE.sent.at(-1).task, 'auto');
  assert.equal(e.STATS.db.prepare('SELECT strict FROM ready_batches').get().strict, 0, 'no daily cap: the ceiling is at /reserve');
});

test('every job carries the Mac\'s own item for that job: none, another job\'s, a stopped one or one without its wait is refused; the site never makes one', async () => {
  const e = pro();
  const bad = async change => (await call(e, 'POST', 'batch', autoBatch(2, '2026-11-09', 0, change), await member())).status;
  assert.equal(await bad(job => ({...job, item: undefined})), 400, 'no item');
  assert.equal(await bad(job => ({...job, item: {...job.item, job: 'other'}})), 400, 'another job\'s');
  assert.equal(await bad(job => ({...job, item: {...job.item, url: 'https://boards.example.com/other'}})), 400, 'another address');
  assert.equal(await bad(job => ({...job, item: {...job.item, manualOverride: true}})), 400, 'stopped on the Mac');
  assert.equal(await bad(job => ({...job, item: {...job.item, state: 'needs_user_handoff'}})), 400, 'handed off');
  assert.equal(await bad(job => ({...job, item: {...job.item, autoConfirmedAt: ''}})), 400, 'no stamp');
  assert.equal(await bad(job => ({...job, item: {...job.item, waitMin: undefined}})), 400, 'no wait of its own');
  assert.equal(await bad(job => ({...job, url: 'https://10.0.0.5/jobs/1', item: {...job.item, url: 'https://10.0.0.5/jobs/1'}})), 400, 'a private address');
  assert.equal(checkItem({id: 'j0', url: 'https://boards.example.com/acme/jobs/0', settings: {autoConfirmedAt: 'x'}}), null, 'a setting is never read');
  const {bearer} = await started(e);
  const night = await (await call(e, 'GET', 'batch', undefined, bearer)).json();
  assert.equal(night.task, 'auto');
  assert.ok(Date.parse(night.sentAt), 'the gate counts the 24 h from the site\'s own clock');
  assert.deepEqual(night.jobs[0].item, itemOf(forms(1)[0]));
  assert.deepEqual([night.jobs[0].stage, night.jobs[0].eligible, night.jobs[0].kit.eligible], ['Kit ready', true, true], 'the eligibility snapshot sits beside the fill\'s kit');
});

test('each job has ONE attempt: a second reserve, a stopped job and a fill night are refused', async () => {
  const e = pro();
  const {bearer} = await started(e);
  const first = await (await reserveFor(e, bearer, 'j0')).json();
  assert.equal(first.ok, true);
  assert.equal(stateOf(e, 'j0').attempt, first.attempt);
  const again = await reserveFor(e, bearer, 'j0');
  assert.deepEqual([again.status, (await again.json()).error], [409, 'already']);
  assert.equal(stateOf(e, 'j0').attempt, first.attempt, 'the first attempt stays');
  await call(e, 'POST', 'stop', {job: 'j1'}, await member());
  assert.equal((await reserveFor(e, bearer, 'j1')).status, 409, 'a job stopped before its press is never reserved');
  const fill = env();
  const made = await (await call(fill, 'POST', 'batch', {night: '2026-11-09', jobs: forms(1)}, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')})).json();
  await call(fill, 'POST', 'run', {}, {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')});
  assert.equal((await reserveFor(fill, {authorization: `Bearer ${await readyToken(fill, made.batch)}`}, 'j0')).status, 400, 'a fill night has no attempt to take');
});

test('the abuse ceiling: past ~500 a day (2 here) the reserve is refused, the job is never pressed, and the owner is told once', async () => {
  const e = pro({READY_AUTO_MAX: '2'});
  const {bearer} = await started(e, autoBatch(4));
  for (const job of ['j0', 'j1']) assert.equal((await reserveFor(e, bearer, job)).status, 200, job);
  const over = await reserveFor(e, bearer, 'j2');
  assert.deepEqual([over.status, (await over.json()).error], [429, 'ceiling']);
  assert.equal(e.STATS.db.prepare('SELECT submits, submits_alerted FROM ready_read_days').get().submits_alerted, 1, 'told once');
  assert.equal((await reserveFor(e, bearer, 'j3')).status, 429);
  assert.deepEqual({...e.STATS.db.prepare('SELECT submits, submits_alerted FROM ready_read_days').get()}, {submits: 2, submits_alerted: 1}, 'and not again');
  assert.equal((await reserveFor(e, bearer, 'j2')).status, 409, 'a job refused at the ceiling keeps its used attempt: never tried again');
});

test('the outcome: a press with its own attempt is submitted; a claimed press without one is unknown; the app takes each once, with the page\'s proof and no field value', async () => {
  const e = pro();
  const {bearer} = await started(e);
  const {attempt} = await (await reserveFor(e, bearer, 'j0')).json();
  const proof = {signature: 'sig-1', submitControl: 'button#send', requiredComplete: true, botCheck: false, answers: {email: 'a@b.c'}};
  await report(e, bearer, {job: 'j0', state: 'submitted', attempt, proof});
  await report(e, bearer, {job: 'j1', state: 'submitted', attempt: 'made-up', proof});
  assert.deepEqual([stateOf(e, 'j0').state, stateOf(e, 'j1').state, stateOf(e, 'j1').wall], ['submitted', 'unknown', 'no attempt']);
  const taken = await (await call(e, 'POST', 'reads', {}, await member())).json();
  const byJob = Object.fromEntries(taken.submits.map(each => [each.job, each]));
  assert.equal(byJob.j0.state, 'submitted');
  assert.deepEqual(byJob.j0.outcome.proof, {signature: 'sig-1', submitControl: 'button#send', requiredComplete: true, botCheck: false});
  assert.equal(JSON.stringify(taken).includes('a@b.c'), false, 'never a field value');
  assert.equal(byJob.j1.state, 'unknown');
  assert.equal((await (await call(e, 'POST', 'reads', {}, await member())).json()).submits.length, 0, 'taken once, then gone from the site');
});

test('a Stop never drops a press: a job whose attempt is taken stays until its result; one not yet reserved is put back', async () => {
  const e = pro();
  const {bearer} = await started(e);
  const {attempt} = await (await reserveFor(e, bearer, 'j0')).json();
  await call(e, 'POST', 'stop', {}, await member());
  assert.equal(stateOf(e, 'j0').state, 'queued', 'still live: its press may already be on its way');
  assert.notEqual(stateOf(e, 'j1').state, 'queued', 'the unreserved job was stopped');
  await report(e, bearer, {job: 'j0', state: 'submitted', attempt, proof: {signature: 's'}});
  assert.equal(stateOf(e, 'j0').state, 'submitted', 'the press that crossed the Stop is told to the app');
});

test('a night past its time ends a reserved job unknown (the person checks), an unreserved one failed', async () => {
  const e = pro();
  const {bearer} = await started(e);
  await reserveFor(e, bearer, 'j0');
  await tick(e, new Date(evening.getTime() + 4 * 3600 * 1000));
  assert.deepEqual([stateOf(e, 'j0').state, stateOf(e, 'j1').state], ['unknown', 'failed']);
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches').get().state, 'finished');
});

// Code review of cs 2/4: the one attempt lived on the night's row, so whatever deleted or cleared that row reset it. These play each way that happened.
test('a night sent again cannot wipe a running night, and a job pressed once is never reserved again, in any night of the same queued item', async () => {
  const e = pro();
  const {bearer} = await started(e);
  assert.equal((await reserveFor(e, bearer, 'j0')).status, 200);
  const again = await call(e, 'POST', 'batch', autoBatch(), await member());
  assert.equal(again.status, 409, 'the running night stays: its attempts and its token');
  assert.equal(stateOf(e, 'j0').attempt.length > 0, true);
  const other = await started(e, autoBatch(1, '2026-11-10'));
  const twice = await reserveFor(e, other.bearer, 'j0');
  assert.deepEqual([twice.status, (await twice.json()).error], [409, 'already'], 'the same item (job and session) in another night: its attempt is used');
});

test('the Mac off for days: the outcome waits on the site until the app takes it, while the job\'s form data still goes after 24 h', async () => {
  const e = pro();
  const {made, bearer} = await started(e);
  const {attempt} = await (await reserveFor(e, bearer, 'j0')).json();
  await report(e, bearer, {job: 'j0', state: 'submitted', attempt, proof: {signature: 's'}});
  assert.equal((await call(e, 'POST', 'batch', {task: 'readiness', night: '2026-11-09', jobs: forms(1, 20)}, await member())).status, 200, 'another night of this install, swept with it: its clear ages out old kept objects');
  await sweep(e, new Date(evening.getTime() + 30 * 3600 * 1000));
  assert.equal([...e.HOSTED_STATE.m.keys()].some(key => key === `ready/member-1/${made.batch}.json`), false, 'the kit, CV and letter are gone after a day');
  const taken = await (await call(e, 'POST', 'reads', {}, await member(), new Date(evening.getTime() + 50 * 3600 * 1000))).json();
  assert.deepEqual(taken.submits.map(each => [each.job, each.state]), [['j0', 'submitted']], 'the app still learns it was sent');
});

test('no press once the kill switch is off, the night is capped, or Pro has lapsed', async () => {
  for (const change of [e => { e.READY_AUTO = 'off'; }, e => { e.STATS.db.prepare("UPDATE ready_batches SET state = 'capped'").run(); }, e => { e.STATS.db.prepare('UPDATE install_credit SET credit_micro = 0').run(); }]) {
    const e = pro();
    const {bearer} = await started(e);
    change(e);
    assert.notEqual((await reserveFor(e, bearer, 'j0')).status, 200);
    assert.equal(stateOf(e, 'j0').attempt, null, 'no attempt taken');
  }
});

test('a job refused at the ceiling ends not_submitted at once, never unknown', async () => {
  const e = pro({READY_AUTO_MAX: '1'});
  const {bearer} = await started(e);
  await reserveFor(e, bearer, 'j0');
  assert.equal((await reserveFor(e, bearer, 'j1')).status, 429);
  assert.deepEqual([stateOf(e, 'j1').state, stateOf(e, 'j1').wall], ['not_submitted', 'ceiling']);
  await tick(e, new Date(evening.getTime() + 4 * 3600 * 1000));
  assert.equal(stateOf(e, 'j1').state, 'not_submitted');
});

test('a store error makes only a press unknown: a night that could not run stays failed', async () => {
  const e = pro();
  const {bearer} = await started(e);
  e.HOSTED_STATE.put = async () => { throw new Error('r2 down'); };
  await report(e, bearer, {job: 'j1', state: 'failed', why: 'unreachable'});
  assert.equal(stateOf(e, 'j1').state, 'failed');
});

test('Stop reaches the job in whichever open night holds it; a job already pressed says it can no longer be stopped', async () => {
  const e = pro();
  const first = await started(e);
  await call(e, 'POST', 'batch', autoBatch(1, '2026-11-10', 5), await member(), new Date(evening.getTime() + 60000));   // a newer night, queued a minute later
  assert.equal((await call(e, 'POST', 'stop', {job: 'j1'}, await member())).status, 200, 'j1 is only in the older, running night');
  assert.notEqual(stateOf(e, 'j1').state, 'queued');
  await reserveFor(e, first.bearer, 'j0');
  const late = await call(e, 'POST', 'stop', {job: 'j0'}, await member());
  assert.deepEqual([late.status, (await late.json()).error], [409, 'already pressed: it can no longer be stopped']);
});
