// Guard: safety — without it, CI's honest browser could ask a job board that refused it again (a retry of a 401/403) or read one site more than the app's 5 a day.
// The broker's board mark (lib/board-reads.mjs; owner, 14 Nov 2026: one read per search page per UTC day across all CI, a stop is per host and for good).
import test from 'node:test';
import assert from 'node:assert/strict';
import {reserve, report, forgetOldDays, boardView, boardFetch, hostOf, HOST_PAGES_A_DAY, MAX_JOBS} from '../../../../workers/ai-broker/lib/board-reads.mjs';

/** The Durable Object storage calls the module uses (get, put, delete of one key or a list, list by prefix), over a Map. */
const storage = () => {
  const map = new Map();
  return {map, get: async k => map.get(k), put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async k => { for (const key of [].concat(k)) map.delete(key); }, list: async ({prefix}) => new Map([...map].filter(([k]) => k.startsWith(prefix)))};
};
const t0 = Date.parse('2026-11-14T10:00:00Z'), nextDay = Date.parse('2026-11-15T00:00:05Z');
const page = 'https://www.trans.bg/front_job_search.php?keywords=driver', other = 'https://www.trans.bg/front_job_search.php?keywords=driver&location=1';
const job = {title: 'Шофьор кат. C+E', url: 'https://www.trans.bg/job/1', company: 'Acme', place: 'София', date: '2026-11-13', cookie: 'secret'};

test('one read per page per day: the first run goes, a run asking while it reads skips, and once opened every run gets its jobs without a request', async () => {
  const s = storage();
  assert.equal((await reserve(s, 'pair#1', page, t0)).reply.go, true);
  assert.deepEqual((await reserve(s, 'pair#1b', page, t0 + 1000)).reply, {go: false, state: 'reading'});
  assert.equal((await report(s, 'pair#1', page, 'opened', {jobs: [job], count: 23}, t0 + 15_000)).reply.kept, 1);
  const again = (await reserve(s, 'round#2', page, t0 + 60_000)).reply;
  assert.equal(again.go, false); assert.equal(again.state, 'opened'); assert.equal(again.count, 23); assert.equal(again.read_by, 'pair#1');
  assert.deepEqual(again.jobs, [{title: job.title, url: job.url, company: 'Acme', place: 'София', date: '2026-11-13'}], 'public listing fields only: no other key is kept');
});

test('a stop is per host and for good: no page of that host is ever reserved again, by any run, on any day', async () => {
  const s = storage();
  await reserve(s, 'night#1', page, t0);
  await report(s, 'night#1', page, 'stopped', {why: 'HTTP 403'}, t0 + 5000);
  for (const [who, at, where] of [['round#2', t0 + 60_000, other], ['bench#3', nextDay, page], ['pair#4', nextDay + 30 * 86400_000, other]]) {
    const r = (await reserve(s, who, where, at)).reply;
    assert.deepEqual([r.go, r.state], [false, 'stopped'], `${who} on ${new Date(at).toISOString()}`);
  }
});

test('a 429 waits the host out until the next UTC day, then the page may be read once more', async () => {
  const s = storage();
  await reserve(s, 'a#1', page, t0);
  await report(s, 'a#1', page, 'waiting', {}, t0 + 5000);
  assert.deepEqual((await reserve(s, 'b#2', other, t0 + 60_000)).reply, {go: false, state: 'waiting'});
  await forgetOldDays(s, nextDay);
  assert.equal((await reserve(s, 'c#3', other, nextDay)).reply.go, true);
});

test(`a host gets at most ${HOST_PAGES_A_DAY} pages a day across all CI, then nothing more is sent to it that day`, async () => {
  const s = storage();
  for (let i = 0; i < HOST_PAGES_A_DAY; i++) assert.equal((await reserve(s, `r#${i}`, `${page}&p=${i}`, t0)).reply.go, true);
  assert.deepEqual((await reserve(s, 'r#9', `${page}&p=9`, t0)).reply, {go: false, state: 'host-full', limit: HOST_PAGES_A_DAY});
  assert.equal((await reserve(s, 'r#9', 'https://jobs.bg/x', t0)).reply.go, true, 'another host keeps its own share');
  await forgetOldDays(s, nextDay);
  assert.equal((await reserve(s, 'r#10', `${page}&p=9`, nextDay)).reply.go, true, 'a new UTC day has a new share');
});

test('only the run that reserved a page today, while it reads, may report it', async () => {
  const s = storage();
  assert.equal((await report(s, 'x#1', page, 'opened', {jobs: [job]}, t0)).status, 409, 'nothing reserved');
  await reserve(s, 'x#1', page, t0);
  assert.equal((await report(s, 'y#2', page, 'stopped', {}, t0)).status, 409, 'another run');
  assert.equal((await report(s, 'x#1', page, 'opened', {jobs: []}, t0)).status, 200);
  assert.equal((await report(s, 'x#1', page, 'stopped', {}, t0)).status, 409, 'a second report');
  assert.equal((await report(s, 'x#1', page, 'maybe', {}, t0)).status, 400);
});

test('a reservation never reported stays reading for the rest of the day; the next day it may be read once more', async () => {
  const s = storage();
  await reserve(s, 'cancelled#1', page, t0);
  assert.deepEqual((await reserve(s, 'b#2', page, t0 + 12 * 3600_000)).reply, {go: false, state: 'reading'});
  await forgetOldDays(s, nextDay);
  assert.equal((await reserve(s, 'c#3', page, nextDay)).reply.go, true);
});

test('jobs kept are bounded and cleaned: no link or title, not http(s), long fields and more than MAX_JOBS', async () => {
  const s = storage();
  await reserve(s, 'a#1', page, t0);
  const many = Array.from({length: MAX_JOBS + 20}, (_, i) => ({title: `T${i}`.padEnd(400, 'x'), url: `https://trans.bg/j/${i}`}));
  await report(s, 'a#1', page, 'opened', {jobs: [{title: 'no link'}, {title: 'ftp', url: 'ftp://x/y'}, ...many]}, t0);
  const jobs = (await reserve(s, 'b#2', page, t0)).reply.jobs;
  assert.equal(jobs.length, MAX_JOBS); assert.equal(jobs[0].title.length, 300); assert.equal(jobs[0].url, 'https://trans.bg/j/0');
});

test('old days are forgotten but stops are kept; /health shows counts and stopped hosts only', async () => {
  const s = storage();
  await reserve(s, 'a#1', page, t0); await report(s, 'a#1', page, 'stopped', {why: 'a bot check'}, t0);
  await reserve(s, 'a#1', 'https://jobs.bg/q', t0); await report(s, 'a#1', 'https://jobs.bg/q', 'opened', {jobs: [job]}, t0);
  assert.deepEqual(await boardView(s, t0), {day: '2026-11-14', pages: {stopped: 1, opened: 1}, stopped: ['trans.bg'], limit: HOST_PAGES_A_DAY});
  assert.equal(await forgetOldDays(s, nextDay), 4);
  assert.deepEqual([...s.map.keys()].sort(), ['board-day', 'board-stop:trans.bg']);
});

test('the Durable Object route: reserve and report through one POST, a bad op or address refused', async () => {
  const s = storage();
  const post = body => boardFetch(s, new Request('http://c/board-read', {method: 'POST', body: JSON.stringify(body)}), 'run#1', t0);
  assert.equal((await (await post({op: 'reserve', page})).json()).go, true);
  assert.equal((await post({op: 'report', page, outcome: 'opened', jobs: [job]})).status, 200);
  assert.equal((await post({op: 'peek', page})).status, 400);
  assert.equal((await post({op: 'reserve', page: 'file:///etc/passwd'})).status, 400);
  assert.equal(hostOf('https://WWW.Jobs.BG/a'), 'jobs.bg');
});
