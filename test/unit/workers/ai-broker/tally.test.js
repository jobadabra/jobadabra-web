// Guards the broker's per-workflow tally (3 Nov 2026, owner: how many tokens a CI workflow burns compared to all the others): the name comes from the verified token only, every call counts, tokens and engines add up, old days drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {day, body, success, harness, entry} from './harness.mjs';
import {addCall, addJobCall, jobKey, JOB_KEEP_DAYS, KEEP_DAYS, MAX_JOB_KEYS, MAX_JOBS_PER_WORKFLOW, MAX_WORKFLOWS, recentDays, tokensOf, workflowKey, workflowOf} from '../../../../workers/ai-broker/lib/tally.mjs';

const ref = (repository, file) => `${repository}/.github/workflows/${file}@refs/heads/main`;

test('the workflow is the file of the verified token, with the repo but not its owner, so the org move keeps one row', () => {
  assert.equal(workflowOf({job_workflow_ref: ref('GarryOne/jobadabra', 'ui-findings.yml')}), 'jobadabra/ui-findings.yml');
  assert.equal(workflowOf({job_workflow_ref: ref('jobadabra/jobadabra', 'ui-findings.yml')}), 'jobadabra/ui-findings.yml');
  assert.equal(workflowOf({job_workflow_ref: ref('jobadabra/jobadabra-lab', 'central-scout.yml')}), 'jobadabra-lab/central-scout.yml');
  assert.equal(workflowOf({workflow_ref: ref('jobadabra/jobadabra', 'ai-user-agents.yaml')}), 'jobadabra/ai-user-agents.yaml');
  for (const claims of [{}, null, {job_workflow_ref: 'nonsense'}, {job_workflow_ref: 'a/b/c.yml@x'}]) assert.equal(workflowOf(claims), 'unknown');
});

test('only a workflow name, "admin" or "unknown" is a key: anything else is unknown', () => {
  assert.equal(workflowKey('jobadabra/ai-user-agents.yml'), 'jobadabra/ai-user-agents.yml');
  assert.equal(workflowKey('admin'), 'admin');
  for (const value of [null, '', 'x', '../../etc/passwd', 'a/b', 'jobadabra/<script>.yml', 'a/b/c.yml']) assert.equal(workflowKey(value), 'unknown');
});

test('tokens are input plus output; a missing or odd count is zero', () => {
  assert.equal(tokensOf({input: 2, output: 3}), 5);
  for (const tokens of [undefined, null, {}, {input: 'x', output: NaN}, 7]) assert.equal(tokensOf(tokens), 0);
  assert.equal(tokensOf({input: 4}), 4);
});

test('a call adds to its workflow and day; a refusal counts as a call with no tokens; engines are counted', () => {
  let tally = addCall(undefined, '2026-11-03', 'jobadabra/a.yml', {ok: true, tokens: 10, ms: 100, engine: 'codex'});
  tally = addCall(tally, '2026-11-03', 'jobadabra/a.yml', {ok: true, tokens: 5, ms: 50, engine: 'claude'});
  tally = addCall(tally, '2026-11-03', 'jobadabra/a.yml', {ok: false});
  tally = addCall(tally, '2026-11-03', 'jobadabra/b.yml', {ok: true, tokens: 1, ms: 1, engine: 'codex'});
  tally = addCall(tally, '2026-11-04', 'jobadabra/a.yml', {ok: true, tokens: 2, ms: 2, engine: 'free-ai'});
  assert.deepEqual(tally.days['2026-11-03']['jobadabra/a.yml'], {calls: 3, ok: 2, tokens: 15, ms: 150, engines: {codex: 1, claude: 1}});
  assert.deepEqual(tally.days['2026-11-03']['jobadabra/b.yml'], {calls: 1, ok: 1, tokens: 1, ms: 1, engines: {codex: 1}});
  assert.equal(tally.days['2026-11-04']['jobadabra/a.yml'].calls, 1);
});

test(`only the last ${KEEP_DAYS} days are kept and /health shows the last 7`, () => {
  let tally;
  for (let i = 1; i <= KEEP_DAYS + 3; i++) tally = addCall(tally, `2026-10-${String(i).padStart(2, '0')}`, 'jobadabra/a.yml', {ok: true, tokens: 1});
  assert.equal(Object.keys(tally.days).length, KEEP_DAYS);
  assert.equal(Object.keys(tally.days)[0], '2026-10-04');
  assert.deepEqual(Object.keys(recentDays(tally).days), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual(recentDays(undefined), {days: {}});
});

test(`a day keeps ${MAX_WORKFLOWS} workflow names; a new one past that counts under "other", a known one still counts for itself`, () => {
  let tally;
  for (let i = 0; i < MAX_WORKFLOWS + 5; i++) tally = addCall(tally, '2026-11-03', `jobadabra/w${i}.yml`, {ok: true, tokens: 1});
  const rows = tally.days['2026-11-03'];
  assert.equal(Object.keys(rows).length, MAX_WORKFLOWS + 1);
  assert.equal(rows.other.calls, 5);
  tally = addCall(tally, '2026-11-03', 'jobadabra/w0.yml', {ok: true, tokens: 1});
  assert.equal(tally.days['2026-11-03']['jobadabra/w0.yml'].calls, 2);
  assert.equal(addCall(tally, '2026-11-04', 'jobadabra/new.yml', {ok: true}).days['2026-11-04']['jobadabra/new.yml'].calls, 1, 'the limit is per day');
});

test('the broker counts each call for its workflow, refusals too, and /health returns it', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker} = harness();
  broker.containerFetch = async () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 20, output: 30}, ms: 7}));
  for (let i = 0; i < 2; i++) assert.equal((await broker.call('scheduled', body, 'jobadabra/ai-user-agents.yml')).status, 200);
  assert.equal((await broker.call('scheduled', body, 'jobadabra/ui-findings.yml')).status, 200);
  assert.equal((await broker.call('scheduled', {...body, tier: 'huge'}, 'jobadabra/ui-findings.yml')).status, 400);   // refused before any engine
  assert.equal((await broker.call('scheduled', body)).status, 200);   // no name: unknown
  const rows = (await (await broker.health()).json()).tally.days['2026-10-30'];
  assert.deepEqual(rows['jobadabra/ai-user-agents.yml'], {calls: 2, ok: 2, tokens: 100, ms: 14, engines: {codex: 2}});
  assert.deepEqual(rows['jobadabra/ui-findings.yml'], {calls: 2, ok: 1, tokens: 50, ms: 7, engines: {codex: 1}});
  assert.equal(rows.unknown.calls, 1);
});

test('a tally that cannot be written is logged and the answer still goes out', async t => {
  t.mock.method(Date, 'now', () => day);
  const logged = [];
  t.mock.method(console, 'log', line => logged.push(String(line)));
  const {broker, storage} = harness();
  broker.containerFetch = async () => success();
  const put = storage.put;
  storage.put = async (key, value) => { if (key === 'tally') throw new Error('storage full'); return put(key, value); };
  assert.equal((await broker.call('scheduled', body, 'jobadabra/a.yml')).status, 200);
  assert.ok(logged.some(line => /^tally: storage full/.test(line)));
});

test('the Worker names the workflow from the verified token only: a caller-sent x-workflow is never forwarded, the admin smoke call is "admin"', async t => {
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const jwk = {...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1'};
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${enc({alg: 'RS256', kid: 'k1'})}.${enc({iss: 'https://token.actions.githubusercontent.com', aud: 'jobadabra-ai-broker', repository: 'jobadabra/jobadabra', event_name: 'schedule', exp: Math.floor(Date.now() / 1000) + 600, job_workflow_ref: ref('jobadabra/jobadabra', 'ai-user-agents.yml')})}`;
  const token = `${head}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head))).toString('base64url')}`;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({keys: [jwk]})));
  const seen = [];
  const env = {BROKER: {fetch: async request => { seen.push({lane: request.headers.get('x-lane'), workflow: request.headers.get('x-workflow'), job: request.headers.get('x-job')}); return new Response('{}'); }}, BROKER_ADMIN_TOKEN: 'admin-secret'};
  await entry.fetch(new Request('https://broker/call', {method: 'POST', headers: {authorization: `Bearer ${token}`, 'x-workflow': 'jobadabra/someone-else.yml', 'x-lane': 'pr'}, body: JSON.stringify(body)}), env);
  await entry.fetch(new Request('https://broker/admin/call', {method: 'POST', headers: {authorization: 'Bearer admin-secret', 'x-workflow': 'jobadabra/someone-else.yml'}, body: JSON.stringify(body)}), env);
  // Per-job AI cost (5 Nov 2026): the caller's `x-jobadabra-job` is forwarded only when it has a GitHub job id's shape; a caller-sent internal `x-job` never is; the admin call has none.
  for (const job of ['e2e-review', 'Bad Label']) await entry.fetch(new Request('https://broker/call', {method: 'POST', headers: {authorization: `Bearer ${token}`, 'x-jobadabra-job': job, 'x-job': 'smuggled'}, body: JSON.stringify(body)}), env);
  assert.deepEqual(seen, [{lane: 'scheduled', workflow: 'jobadabra/ai-user-agents.yml', job: ''}, {lane: 'scheduled', workflow: 'admin', job: null},
    {lane: 'scheduled', workflow: 'jobadabra/ai-user-agents.yml', job: 'e2e-review'}, {lane: 'scheduled', workflow: 'jobadabra/ai-user-agents.yml', job: ''}]);
});

// Per-job AI cost (owner via mac-32, 5 Nov 2026): the job label is a display-only second counter, in its own storage value.
test('only a GitHub job id of a fixed shape is a job label; anything else is none', () => {
  for (const ok of ['review', 'e2e-review', 'run', 'job-1', 'a']) assert.equal(jobKey(ok), ok);
  for (const bad of [null, '', 'Review', 'a b', '../x', 'a/b', '-x', 'x'.repeat(41), '<script>', 'a|b']) assert.equal(jobKey(bad), '', String(bad));
});

test('a job call adds calls and tokens under "<workflow>|<job>"; no label counts nothing; days are bounded', () => {
  let jobs = addJobCall(undefined, '2026-11-05', 'jobadabra/e2e.yml', 'review', 30);
  jobs = addJobCall(jobs, '2026-11-05', 'jobadabra/e2e.yml', 'review', 20);
  jobs = addJobCall(jobs, '2026-11-05', 'jobadabra/e2e.yml', 'suite', 5);
  assert.deepEqual(jobs.days['2026-11-05'], {'jobadabra/e2e.yml|review': {calls: 2, tokens: 50}, 'jobadabra/e2e.yml|suite': {calls: 1, tokens: 5}});
  assert.equal(addJobCall(jobs, '2026-11-05', 'jobadabra/e2e.yml', '', 99), jobs, 'no label: the same value back');
  // One workflow cannot starve the others: its 13th job counts under its own "other".
  let own;
  for (let i = 0; i < MAX_JOBS_PER_WORKFLOW + 3; i++) own = addJobCall(own, '2026-11-05', 'jobadabra/w.yml', `j${i}`, 1);
  own = addJobCall(own, '2026-11-05', 'jobadabra/z.yml', 'ok', 1);
  const mine = own.days['2026-11-05'];
  assert.equal(mine['jobadabra/w.yml|other'].calls, 3); assert.equal(mine['jobadabra/z.yml|ok'].calls, 1, 'another workflow still gets its own job');
  own = addJobCall(own, '2026-11-05', 'jobadabra/w.yml', 'j0', 1);
  assert.equal(own.days['2026-11-05']['jobadabra/w.yml|j0'].calls, 2, 'a known key still counts once the workflow is full');
  // The whole day is bounded by keys and by key length (bytes): past 50 keys, or a key over 100 characters, the shared "|other" (never a workflow's name).
  let many;
  for (let i = 0; i < MAX_JOB_KEYS + 5; i++) many = addJobCall(many, '2026-11-05', `jobadabra/w${i}.yml`, 'x', 1);
  assert.equal(Object.keys(many.days['2026-11-05']).length, MAX_JOB_KEYS + 1); assert.equal(many.days['2026-11-05']['|other'].calls, 5);
  const long = addJobCall(undefined, '2026-11-05', `jobadabra/${'w'.repeat(120)}.yml`, 'x', 1);
  assert.deepEqual(Object.keys(long.days['2026-11-05']), ['|other'], 'a key that long never reaches storage');
  let old; for (let i = 1; i <= JOB_KEEP_DAYS + 2; i++) old = addJobCall(old, `2026-10-${String(i).padStart(2, '0')}`, 'jobadabra/a.yml', 'x', 1);
  assert.equal(Object.keys(old.days).length, JOB_KEEP_DAYS);
});

test('the broker counts a labelled call under its job, /health returns it, an unlabelled call adds none, and the workflow tally is unchanged', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker, storage} = harness();
  broker.containerFetch = async () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 20, output: 30}, ms: 7}));
  await broker.call('scheduled', body, 'jobadabra/e2e.yml', 'review');
  await broker.call('scheduled', body, 'jobadabra/e2e.yml', 'review');
  await broker.call('scheduled', body, 'jobadabra/e2e.yml');
  const health = await (await broker.health()).json();
  assert.deepEqual(health.jobs.days['2026-10-30'], {'jobadabra/e2e.yml|review': {calls: 2, tokens: 100}});
  assert.equal(health.tally.days['2026-10-30']['jobadabra/e2e.yml'].calls, 3, 'every call is in the workflow tally, labelled or not');
  assert.deepEqual(Object.keys(await storage.get('tally')).sort(), ['days'], 'the workflow value holds no job data');
});

test('a job count that cannot be written is logged: the workflow tally of that call is kept and the answer goes out (review, 5 Nov 2026)', async t => {
  t.mock.method(Date, 'now', () => day);
  const logged = []; t.mock.method(console, 'log', (...line) => logged.push(line.join(' ')));
  const {broker, storage} = harness(), put = storage.put;
  storage.put = async (key, value) => { if (key === 'jobs') throw new Error('storage full'); return put(key, value); };
  broker.containerFetch = async () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 2, output: 3}, ms: 1}));
  assert.equal((await broker.call('scheduled', body, 'jobadabra/e2e.yml', 'review')).status, 200);
  const health = await (await broker.health()).json();
  assert.equal(health.tally.days['2026-10-30']['jobadabra/e2e.yml'].calls, 1, 'the workflow count survives a failed jobs write');
  assert.deepEqual(health.jobs.days, {}); assert.ok(logged.some(line => /jobs: storage full/.test(line)));
});

test('past the day\'s workflow limit a job counts under the "other" row the tally folded it into, so every job row has a parent (Gitar, 5 Nov 2026)', async t => {
  t.mock.method(Date, 'now', () => day);
  const {broker} = harness();
  broker.containerFetch = async () => new Response(JSON.stringify({reply: 'ok', tokens: {input: 1, output: 1}, ms: 1}));
  for (let i = 0; i < MAX_WORKFLOWS; i++) await broker.call('scheduled', body, `jobadabra/w${i}.yml`);
  await broker.call('scheduled', body, 'jobadabra/late.yml', 'review');
  const health = await (await broker.health()).json();
  assert.equal(health.tally.days['2026-10-30'].other.calls, 1, 'the tally folded the 61st workflow');
  assert.deepEqual(health.jobs.days['2026-10-30'], {'other|review': {calls: 1, tokens: 2}}, 'its job sits under that same row');
});
