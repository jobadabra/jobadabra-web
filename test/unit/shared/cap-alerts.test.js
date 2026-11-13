// Guard: money — a stop that everyone hits in silence costs the owner users (they see "Free AI is busy today" and he is not told), and an alert that fails a call costs the call.
// Every cap of the registry (shared/cap-alerts.js): approaching -> one 🟠 card, a refusal (`reached`) -> one 🔴 card, a count past the line alone -> no 🔴 (13 Nov 2026, the drift card), a second crossing in the same period -> nothing, a failed send never fails the caller.
// Why (13 Nov 2026, owner: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CAPS, NIGHT_HOURS, RUNNER_CEILING, RUNNER_LIVE, capCheck, runnerCheck} from '../../../shared/cap-alerts.js';
import {RUN_HOURS} from '../../../api/ready.js';

const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }}; };
// The vars as in force (workers/www/wrangler.toml) plus a Workers AI allowance, so the neuron line is a number; the old bot is the only way out (no switchboard in a unit test).
const env = () => ({WAITLIST: kv(), BRAIN_BOT_TOKEN: 't', BRAIN_CHAT_ID: 'c', FREE_AI_NEURONS: '10000'});
const posting = sent => async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{"ok":true,"result":{"message_id":1}}'); };
const DAY = new Date('2026-11-13T10:00:00Z'), NEXT_DAY = new Date('2026-11-14T10:00:00Z'), NEXT_MONTH = new Date('2026-12-01T10:00:00Z');

test('every cap: 🟠 once when approaching, 🔴 once when the line refuses, nothing more in the same period, both again in the next one', async () => {
  assert.ok(Object.keys(CAPS).length >= 4, 'positive control: the registry holds the Free AI lines');
  for (const [name, cap] of Object.entries(CAPS)) {
    const e = env(), sent = [], fetcher = posting(sent), line = cap.line(e), near = cap.approach(e);
    assert.ok(Number.isFinite(line) && near > 0 && near < line, `${name}: an approach line below its line (${near} of ${line})`);
    await capCheck(e, name, near - 1, {now: DAY, fetcher});
    assert.equal(sent.length, 0, `${name}: below the approach line, nothing`);
    await capCheck(e, name, near, {now: DAY, fetcher}); await capCheck(e, name, near + 1, {now: DAY, fetcher});
    assert.equal(sent.length, 1, `${name}: one medium card`); assert.match(sent[0], /^🟠/, `${name}: medium is orange\n${sent[0]}`);
    await capCheck(e, name, line, {now: DAY, fetcher}); await capCheck(e, name, line * 2, {now: DAY, fetcher});
    assert.equal(sent.length, 1, `${name}: a count at or past the line refused nothing: no critical card`);
    await capCheck(e, name, line, {now: DAY, fetcher, reached: true}); await capCheck(e, name, null, {now: DAY, fetcher, reached: true});
    assert.equal(sent.length, 2, `${name}: one critical card`); assert.match(sent[1], /^🔴/, `${name}: critical is red\n${sent[1]}`);
    assert.match(sent[1], new RegExp(cap.fix.split(' ')[1]), `${name}: the card says what to raise`);
    await capCheck(e, name, line, {now: cap.period === 'day' ? NEXT_DAY : NEXT_MONTH, fetcher, reached: true});
    assert.equal(sent.length, 3, `${name}: a new period tells again`); assert.match(sent[2], /^🔴/);
  }
});

test('a line that refuses with no approach card yet sends the critical card only', async () => {
  const e = env(), sent = [];
  await capCheck(e, 'free-ai-day', CAPS['free-ai-day'].line(e), {now: DAY, fetcher: posting(sent), reached: true});
  await capCheck(e, 'free-ai-day', CAPS['free-ai-day'].approach(e), {now: DAY, fetcher: posting(sent)});
  assert.deepEqual(sent.map(text => text.slice(0, 2)), ['🔴']);
});

test('a refusal with no counter (the platform says the allowance is spent) is a reached line', async () => {
  const e = env(), sent = [];
  await capCheck(e, 'free-ai-neurons', null, {now: DAY, fetcher: posting(sent), reached: true});
  assert.equal(sent.length, 1); assert.match(sent[0], /^🔴/);
});

test('a failed send never throws and gives the flag back, so the next crossing tries again', async () => {
  for (const fetcher of [async () => { throw new Error('network'); }, async () => new Response('nope', {status: 500})]) {
    const e = env(), line = CAPS['free-ai-day'].line(e);
    await assert.doesNotReject(capCheck(e, 'free-ai-day', line, {now: DAY, fetcher}));
    const sent = [];
    await capCheck(e, 'free-ai-day', line, {now: DAY, fetcher: posting(sent)});
    assert.equal(sent.length, 1, 'tried again after the failed send');
  }
});

test('an unknown cap or a missing store is a no-op, never a throw', async () => {
  await assert.doesNotReject(capCheck(env(), 'no-such-cap', 1, {now: DAY, fetcher: async () => { throw new Error('x'); }}));
  await assert.doesNotReject(capCheck({}, 'free-ai-day', 1e12, {now: DAY, fetcher: async () => { throw new Error('x'); }}));
});

// Why (13 Nov 2026, owner: "I should be alert if we're approaching the max_instnaces" · "80% warning and 100% critical"): the ceiling in the alert is the ceiling Cloudflare holds.
test('both cloud runners: max_instances in wrangler.jsonc is RUNNER_CEILING, and the queue starts exactly that many at most', () => {
  for (const runner of ['hosted-runner', 'ready-runner']) {
    const text = readFileSync(new URL(`../../../workers/${runner}/wrangler.jsonc`, import.meta.url), 'utf8');
    assert.equal(Number(text.match(/"max_instances":\s*(\d+)/)[1]), RUNNER_CEILING, runner);
    const batch = Number(text.match(/"max_batch_size":\s*(\d+)/)[1]), concurrency = Number(text.match(/"max_concurrency":\s*(\d+)/)[1]);
    // Why (Gitar on #635): each message of a batch starts its own container, so the queue can start batch x concurrency at once
    assert.ok(batch * concurrency <= RUNNER_CEILING, `${runner}: the queue starts at most ${batch * concurrency} containers, never past the ceiling ${RUNNER_CEILING}`);
    assert.equal(batch * concurrency, RUNNER_CEILING, `${runner}: and it can fill the ceiling`);
  }
});

// Why (Gitar on #635; owner, 13 Nov 2026: "please resolve the suggestions in the next PR"): 🔴 comes from a start that was refused, never from a count alone.
test('the 5-minute runner check: nothing at 79, 🟠 at 80, no 🔴 at 100 while every run started, 🔴 when the runner is full and a run never started, each runner on its own', async () => {
  const counts = {hosted_runs: {live: 0, waiting: 0}, ready_batches: {live: 0, waiting: 0}};
  const read = sql => counts[sql.match(/FROM (\w+)/)[1]][/read_at IS NULL|NOT EXISTS/.test(sql) ? 'waiting' : 'live'];
  const e = {...env(), STATS: {prepare: sql => ({bind: () => ({first: async () => ({n: read(sql)})})})}};
  const sent = [], fetcher = posting(sent);
  counts.hosted_runs.live = RUNNER_CEILING * 0.8 - 1;
  assert.deepEqual(await runnerCheck(e, {now: DAY, fetcher}), {'find-jobs-runner': {live: 79, waiting: 0}, 'apply-runner': {live: 0, waiting: 0}});
  assert.equal(sent.length, 0);
  counts.hosted_runs.live = RUNNER_CEILING * 0.8;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 1); assert.match(sent[0], /^🟠[^]*Find jobs runner/);
  counts.hosted_runs.live = RUNNER_CEILING;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 1, 'full, but every run started: nothing was refused, no 🔴');
  counts.hosted_runs.waiting = 1;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 2); assert.match(sent[1], /^🔴[^]*Find jobs runner[^]*refused a start/);
  counts.ready_batches = {live: RUNNER_CEILING - 1, waiting: 3};
  await runnerCheck(e, {now: DAY, fetcher});
  assert.equal(sent.length, 3, 'a night that did not start while the runner has room is not a refusal: 🟠 only');
  assert.match(sent[2], /^🟠[^]*Apply runner/);
  counts.ready_batches.live = RUNNER_CEILING;
  await runnerCheck(e, {now: DAY, fetcher});
  assert.match(sent[3], /^🔴[^]*Apply runner/);
  const broken = {...e, STATS: {prepare: () => { throw new Error('D1 down'); }}};
  assert.deepEqual(await runnerCheck(broken, {now: NEXT_DAY, fetcher}), {'find-jobs-runner': null, 'apply-runner': null}, 'a failed count never fails the tick');
});

// Why (Gitar on #638): the "waiting" clock is the start the table keeps, run on the real SQL; a night planned or queued long ago that a tick turned running a minute ago has not been refused.
test('the runner SQL: a run or night counts as waiting only 5+ minutes after its own start, never from when it was planned or queued', () => {
  assert.equal(NIGHT_HOURS, RUN_HOURS, 'the night length the alert assumes is the one api/ready.js starts nights with');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE hosted_runs (id TEXT, started_at TEXT, expires_at TEXT, finished_at TEXT, read_at TEXT);
    CREATE TABLE ready_batches (id TEXT, state TEXT, fill_at TEXT, created_at TEXT, expires_at TEXT); CREATE TABLE ready_jobs (batch TEXT, started_at TEXT);`);
  const ago = min => new Date(DAY - min * 60000).toISOString(), night = min => new Date(DAY - min * 60000 + RUN_HOURS * 3600000).toISOString();
  db.prepare('INSERT INTO hosted_runs VALUES (?, ?, ?, NULL, NULL)').run('fresh', ago(1), ago(-29));
  db.prepare('INSERT INTO hosted_runs VALUES (?, ?, ?, NULL, NULL)').run('stuck', ago(6), ago(-24));
  db.prepare('INSERT INTO hosted_runs VALUES (?, ?, ?, NULL, ?)').run('read', ago(6), ago(-24), ago(5));
  db.prepare("INSERT INTO ready_batches VALUES (?, 'running', ?, ?, ?)").run('late-start', ago(120), ago(600), night(1));   // planned 2 h ago, started 1 min ago
  db.prepare("INSERT INTO ready_batches VALUES (?, 'running', ?, ?, ?)").run('stuck', ago(7), ago(60), night(6));
  db.prepare("INSERT INTO ready_batches VALUES (?, 'running', ?, ?, ?)").run('filling', ago(30), ago(60), night(6));
  db.prepare('INSERT INTO ready_jobs VALUES (?, ?)').run('filling', ago(5));
  const before = new Date(DAY - 5 * 60000), count = (name, kind) => db.prepare(RUNNER_LIVE[name][kind]).get(...(kind === 'live' ? [DAY.toISOString()] : [DAY.toISOString(), RUNNER_LIVE[name].cutoff(before).toISOString()])).n;
  assert.deepEqual([count('find-jobs-runner', 'live'), count('find-jobs-runner', 'waiting')], [3, 1], 'only the run opened 6 min ago and never read');
  assert.deepEqual([count('apply-runner', 'live'), count('apply-runner', 'waiting')], [3, 1], 'only the night started 6 min ago with no job begun, not the one started late a minute ago');
});
