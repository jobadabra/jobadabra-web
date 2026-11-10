// Cloud browser runner 3/4 (api/ready-read-access.js; spec jobadabra docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): who may start a readiness night and what it may cost.
// Owner, 8-9 Nov 2026 (asked via AskUserQuestion): "Any user, no matter Free or Pro. But within their AI credit.", "30 reads, $0.15/day (Recommended)", "In the end, we care about AI credit".
// Each test plays the owner's case: an Always on install with its own key, and the loops and the credit that must stop it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {tokenFor} from '../../../../shared/guard.js';
import {ready, readyToken} from '../../../../api/ready.js';

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
const readBatch = (n = 3, night = '2026-11-09', base = 0) => ({task: 'readiness', night, jobs: forms(n, base)});
const READ = {simple: true, why: '', login: false, captcha: false, accountCreation: false, questions: []};
const started = async (e, body = readBatch(), headers) => {
  const made = await (await call(e, 'POST', 'batch', body, headers || await member())).json();
  await call(e, 'POST', 'run', {task: 'readiness'}, headers || await member());
  return {made, bearer: {authorization: `Bearer ${await readyToken(e, made.batch)}`}};
};

test('an Always on install starts, stops and takes its own readiness night with its install key alone, and nothing else of Ready to send', async () => {
  const e = always();
  const {made, bearer} = await started(e);
  assert.equal(made.queued, 3);
  assert.equal((await call(e, 'POST', 'result', {job: 'j0', task: 'readiness', state: 'read', read: READ, ms: 2000, costMicro: 24000}, bearer)).status, 200);
  const taken = await (await call(e, 'POST', 'reads', {}, await member())).json();
  assert.deepEqual(taken.reads.map(each => each.job), ['j0']);
  assert.equal(taken.pending, 2);
  assert.equal((await call(e, 'POST', 'stop', {}, await member())).status, 200, 'Stop reaches the member\'s own readiness night');
  assert.equal((await call(e, 'POST', 'batch', {night: '2026-11-09', jobs: forms(1), contact: {name: 'A'}}, await member())).status, 401, 'a fill night stays the owner\'s');
  assert.equal((await call(e, 'POST', 'run', {}, await member())).status, 401, 'so does starting one');
  for (const route of ['state', 'report', 'live', 'link', 'again', 'done']) assert.equal((await call(e, 'POST', route, {job: 'j0'}, await member())).status, 401, route);
});

test("any install with a valid key of its own may read, whether its Always on runs on its GitHub or on our servers (the owner: \"it doesn't care\"); no key, a wrong token or the switch off is refused", async () => {
  const e = env();   // no hosted schedule at all, HOSTED_ALWAYS_ON unset: a GitHub Always on install
  assert.equal((await call(e, 'POST', 'batch', readBatch(1), await member('github-only-7'))).status, 200);
  assert.equal((await call(e, 'POST', 'reads', {}, await member('github-only-7'))).status, 200);
  assert.equal((await call(e, 'POST', 'batch', readBatch(1), {})).status, 401, 'no key');
  assert.equal((await call(e, 'POST', 'batch', readBatch(1), {'x-api-key': 'JPF1.github-only-7.not-its-token'})).status, 401, 'a wrong token');
  assert.equal((await call(env({READY_READ_OPEN: 'off'}), 'POST', 'batch', readBatch(1), await member())).status, 401, 'the kill switch');
  assert.equal((await call(always(), 'POST', 'reads', {}, await member('someone-else-9'))).status, 200, 'its own reads only: none');
  assert.deepEqual((await (await call(always(), 'POST', 'reads', {}, await member('someone-else-9'))).json()).reads, []);
});

test('the day cap: 30 forms an install and day, counted even when a night is posted again to dodge it', async () => {
  const e = always();
  for (const [night, base] of [['2026-11-09', 0], ['2026-11-10', 100]]) assert.equal((await call(e, 'POST', 'batch', readBatch(15, night, base), await member())).status, 200, night);
  const over = await call(e, 'POST', 'batch', readBatch(1, '2026-11-11', 200), await member());
  assert.equal(over.status, 429);
  assert.deepEqual({...await over.json()}, {ok: false, error: "Today's cloud checks are used up (30 of 30 forms). They start again tomorrow (00:00 UTC).", limit: 30, used: 30});
  assert.equal((await call(e, 'POST', 'batch', readBatch(1, '2026-11-09', 300), await member())).status, 429, 'the same night posted again does not start the count over');
  assert.equal((await call(e, 'POST', 'batch', readBatch(1, '2026-11-11', 400), await member(), new Date('2026-11-10T00:00:01Z'))).status, 200, 'the next UTC day starts again');
});

test("the day's money: past $0.15 the night stops, its unstarted forms are told as 'could not read', and no batch is taken until tomorrow", async () => {
  const e = always({READY_READ_DAY_USD: '0.0001'});   // 100 micro-USD, so one read of 10 s (120 micro) ends the day
  const {made, bearer} = await started(e);
  const result = await (await call(e, 'POST', 'result', {job: 'j0', task: 'readiness', state: 'read', read: READ, ms: 10000, costMicro: 120000 / 1000}, bearer)).json();
  assert.equal(result.stop, true, 'the container is told to stop');
  const rows = e.STATS.db.prepare('SELECT job, state, wall FROM ready_jobs WHERE batch = ? ORDER BY job').all(made.batch).map(row => ({...row}));
  assert.deepEqual(rows.map(row => [row.state, row.wall]), [['read', ''], ['failed', 'cap'], ['failed', 'cap']]);
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches WHERE id = ?').get(made.batch).state, 'finished');
  const next = await call(e, 'POST', 'batch', readBatch(1, '2026-11-10', 50), await member());
  assert.equal(next.status, 429);
  assert.match((await next.json()).error, /budget/);
});

test('within their AI credit: a Free install past its trial, month or day line is refused before a read is queued, with the usual words', async () => {
  const e = always({WAITLIST: kv()});
  e.WAITLIST.get = async key => (key.startsWith('freeai:life:') ? String(2_000_001) : null);   // the trial's $2 is spent
  const refused = await call(e, 'POST', 'batch', readBatch(), await member());
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /Free AI included in your trial/);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_batches').get().n, 0, 'nothing queued');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM ready_read_days').get().n, 0, 'and none of today\'s cap used');
  const day = always({WAITLIST: kv()});
  day.WAITLIST.get = async key => (key.startsWith('freeai:dusd:') ? String(300_000) : null);   // $0.30 a day, the Free line
  assert.equal((await call(day, 'POST', 'batch', readBatch(), await member())).status, 402);
});

test("their own Claude key skips the credit check, but today's cap still counts every read (a key is not validated here, so a made-up one cannot lift the cap)", async () => {
  const e = always({WAITLIST: kv()});
  e.WAITLIST.get = async key => (key.startsWith('freeai:life:') ? String(9_000_000) : null);   // the trial's credit is spent
  const own = {...readBatch(15), ai: {key: 'sk-ant-api03-' + 'x'.repeat(30)}};
  assert.equal((await call(e, 'POST', 'batch', own, await member())).status, 200, 'no credit refusal');
  assert.equal((await call(e, 'POST', 'batch', {...own, night: '2026-11-10', jobs: forms(15, 50)}, await member())).status, 200);
  assert.equal((await call(e, 'POST', 'batch', {...own, night: '2026-11-11', jobs: forms(1, 90)}, await member())).status, 429, 'past 30 forms');
});

test('an Always on install queues public pages only: an IP, localhost or an internal name never reaches the container', async () => {
  const e = always();
  for (const url of ['https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/jobs', 'https://[::1]/x', 'https://intranet.corp/x', 'https://printer.local/x', 'https://2130706433/x', 'https://metadata/x', 'https://localhost./x', 'https://127.0.0.1.nip.io/x', 'https://169.254.169.254/latest', 'https://printer.local./x'])
    assert.equal((await call(e, 'POST', 'batch', {task: 'readiness', night: '2026-11-09', jobs: [{id: 'a', url}]}, await member())).status, 400, url);
  assert.equal((await call(e, 'POST', 'batch', {task: 'readiness', night: '2026-11-09', jobs: [{id: 'a', url: 'https://jobs.example.org/p/1'}]}, await member())).status, 200);
});

test("the owner's install that is also an Always on member: its key alone reaches the readiness night, never his Ready to send night", async () => {
  const e = always();
  e.STATS.db.prepare('INSERT INTO hosted_schedules (account, install, freq_hours, next_run_at, state, last_seen_at, created_at) VALUES (?, ?, 24, ?, ?, ?, ?)').run('acct-o', 'owner-install-1', '2026-11-10T00:00:00Z', 'on', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z');
  const full = {'x-ready-owner': 'owner-secret', 'x-api-key': await keyOf('owner-install-1')}, keyOnly = {'x-api-key': await keyOf('owner-install-1')};
  const fill = await (await call(e, 'POST', 'batch', {night: '2026-11-09', readyBy: '07:30', contact: {name: 'A'}, jobs: [{id: 'f1', url: 'https://boards.example.com/a/1', title: 'SRE', company: 'Acme', kit: {}, letter: '', cv: ''}]}, full)).json();
  await call(e, 'POST', 'batch', readBatch(1), keyOnly);
  assert.equal((await call(e, 'POST', 'batch', {night: '2026-11-10', jobs: forms(1, 5)}, keyOnly)).status, 401, 'a fill night needs the secret');
  assert.equal((await call(e, 'POST', 'stop', {}, keyOnly)).status, 200);
  assert.deepEqual(e.STATS.db.prepare('SELECT j.state FROM ready_jobs j WHERE j.batch = ?').all(fill.batch).map(row => row.state), ['queued'], 'his fill night is not stopped by the key alone');
});

test("a read's container seconds come out of the Free install's own lines (day, month, trial), and the night lands on /admin/ai/costs as 'ready-read'", async () => {
  const store = kv();
  const e = always({WAITLIST: store});
  const {made, bearer} = await started(e, readBatch(1));
  await call(e, 'POST', 'result', {job: 'j0', task: 'readiness', state: 'read', read: READ, ms: 30000, costMicro: 360}, bearer);
  const booked = Object.fromEntries([...store.m].filter(([key]) => /^freeai:(dusd|musd|life):/.test(key)).map(([key, value]) => [key.split(':')[1], Number(value)]));
  assert.deepEqual(booked, {dusd: 360, musd: 360, life: 360}, '30 s at 12 micro-USD a second');
  const cost = e.STATS.db.prepare('SELECT job, usd, calls FROM ai_cost_runs').all().map(row => ({...row}));
  assert.deepEqual(cost, [{job: 'ready-read', usd: 0.00036, calls: 1}]);
  assert.equal(e.STATS.db.prepare('SELECT state FROM ready_batches WHERE id = ?').get(made.batch).state, 'finished');
});
