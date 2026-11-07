// The evidence bundle of an AI tester's bug (shared/bug-bundles.js): only CI's key or the owner's key may store one, a stored bundle opens only for a signed-in admin, a file name is never a path, a bad report or file is refused or left out,
// nothing is written to the feedback table or sent to Telegram, and anything older than 90 days is dropped.
// Guard: privacy — a twin's bundle can hold the owner's real session records and job rows; they must stay behind the Admin login.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEEP_DAYS, MAX_SHOT, MAX_TEXT, bundleFile, bundleIngest, cleanReport, decodeJpeg, prune} from '../../../shared/bug-bundles.js';

const KEY = 'k'.repeat(64), now = new Date('2026-11-07T10:00:00Z');
const bucket = () => {
  const kept = new Map();
  return {kept,
    put: async (name, value, options) => { kept.set(name, {bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), uploaded: options.uploaded || new Date(now), ...options}); },
    delete: async names => { for (const name of [].concat(names)) kept.delete(name); },
    list: async ({prefix = ''} = {}) => ({objects: [...kept].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({key, uploaded: o.uploaded})), truncated: false}),
    head: async name => (kept.has(name) ? {size: kept.get(name).bytes.length} : null),
    get: async name => { const o = kept.get(name); return o ? {body: o.bytes, text: async () => new TextDecoder().decode(o.bytes)} : null; }};
};
const env = (extra = {}) => ({LAB_FILLS: bucket(), REPLAYS_PUBLISH_KEY: KEY, STATS_API_KEY: 'owner-key', STATS_KEY: 'k', STATS: {prepare: () => { throw new Error('the feedback table must not be touched'); }}, ...extra});
const REPORT = {journey: 'J12', severity: 'high', title: 'Saved phone reads as its label', expected: 'The phone the person typed is shown.', seen: 'The phone reads "Phone number".', steps: ['Open Profile', 'Press Save'], at: '2026-11-07T09:58:00Z'};
const jpeg = bytes => `data:image/jpeg;base64,${Buffer.from(new Uint8Array(bytes).fill(7)).toString('base64')}`;
const post = (e, body, {key = KEY, source = 'persona', at = now} = {}) => bundleIngest(new Request('https://x.test/agent/bundle', {method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify({source, report: REPORT, files: {}, ...body})}), e, at);
const get = (e, id, name, key = 'owner-key') => bundleFile(new Request(`https://x.test/admin/bug-bundle/${id}/${name}`, {headers: key ? {Authorization: `Bearer ${key}`} : {}}), e, id, name);

test('CI stores a bundle with its files and gets an id and the link; the report is kept last', async () => {
  const e = env();
  const answer = await (await post(e, {files: {'logs.txt': 'line', 'state.json': '{"a":1}', 'env.json': '{"v":"0.9.12"}', 'app.jpg': jpeg(500), 'tab.jpg': jpeg(500)}})).json();
  assert.equal(answer.ok, true);
  assert.match(answer.id, /^[0-9a-f]{16}$/);
  assert.equal(answer.url, `https://www.jobadabra.top/admin/bug-bundle/${answer.id}`);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].map(key => key.split('/')[2]).sort(), ['app.jpg', 'env.json', 'logs.txt', 'report.json', 'state.json', 'tab.jpg']);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].at(-1), `bundle/${answer.id}/report.json`);
  assert.equal(JSON.parse(new TextDecoder().decode(e.LAB_FILLS.kept.get(`bundle/${answer.id}/report.json`).bytes)).source, 'persona');
});

test('the owner\'s own key stores one too (the twin on their Mac); any other caller, or none, gets a 404 and stores nothing', async () => {
  const e = env();
  assert.equal((await post(e, {}, {key: 'owner-key', source: 'desktop-tester'})).status, 200);
  for (const key of ['wrong', '']) assert.equal((await post(e, {}, {key})).status, 404);
  assert.equal(e.LAB_FILLS.kept.size, 1 + 0 * 1, 'only the owner\'s bundle (its report) is stored');
  assert.equal((await post(env({REPLAYS_PUBLISH_KEY: ''}), {}, {key: ''})).status, 404, 'an unset key never matches an empty one');
});

test('a bad source, severity, missing expected or seen, or non-JSON body is refused; a file that is too big, not a JPEG or named like a path is left out and named', async () => {
  const e = env();
  assert.equal((await post(e, {source: 'user'})).status, 400);
  assert.equal((await post(e, {report: {...REPORT, severity: 'critical'}})).status, 400);
  assert.equal((await post(e, {report: {...REPORT, seen: ''}})).status, 400);
  assert.equal((await bundleIngest(new Request('https://x.test/agent/bundle', {method: 'POST', headers: {Authorization: `Bearer ${KEY}`}, body: 'nope'}), e, now)).status, 400);
  assert.equal(e.LAB_FILLS.kept.size, 0);
  const answer = await (await post(e, {files: {'../x.txt': 'x', 'logs.txt': 'y'.repeat(MAX_TEXT + 1), 'app.jpg': 'data:image/png;base64,AAAA', 'tab.jpg': jpeg(MAX_SHOT + 10), 'report.json': '{}', 'env.json': 5}})).json();
  assert.deepEqual(answer.skipped.sort(), ['../x.txt', 'app.jpg', 'env.json', 'logs.txt', 'report.json', 'tab.jpg']);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].map(key => key.split('/')[2]), ['report.json']);
});

test('reading: only a signed-in admin, only a kept file of the table, never a path', async () => {
  const e = env();
  const {id} = await (await post(e, {files: {'logs.txt': 'hello'}})).json();
  assert.equal(await (await get(e, id, 'logs.txt')).text(), 'hello');
  assert.equal((await get(e, id, 'logs.txt', null)).status, 404, 'signed out');
  assert.equal((await get(e, id, 'logs.txt', 'wrong')).status, 404);
  for (const name of ['../report.json', 'a/b', 'nothing.txt']) assert.equal((await get(e, id, name)).status, 404);
  assert.equal((await get(e, 'not-an-id', 'logs.txt')).status, 404);
  assert.equal((await get(e, '0123456789abcdef', 'logs.txt')).status, 404, 'a bundle that is not kept');
});

test('a bundle writes nothing to the feedback table (STATS throws on use) and an unconfigured bucket is a 503', async () => {
  assert.equal((await post(env(), {})).status, 200);
  assert.equal((await post(env({LAB_FILLS: undefined}), {})).status, 503);
});

test('bundles older than 90 days are dropped on the next upload and by the daily prune, newer ones stay', async () => {
  const e = env(), old = new Date(now.getTime() - (KEEP_DAYS + 1) * 86400000);
  await e.LAB_FILLS.put('bundle/aaaaaaaaaaaaaaaa/report.json', '{}', {uploaded: old});
  await e.LAB_FILLS.put('bundle/bbbbbbbbbbbbbbbb/report.json', '{}', {uploaded: new Date(now.getTime() - 86400000)});
  await e.LAB_FILLS.put('agent/41857218091/run.json', '{}', {uploaded: old});
  await prune(e.LAB_FILLS, now);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].sort(), ['agent/41857218091/run.json', 'bundle/bbbbbbbbbbbbbbbb/report.json']);
});

test('cleanReport and decodeJpeg cut and refuse what they should', () => {
  assert.equal(cleanReport(REPORT, 'persona').report.steps.length, 2);
  assert.equal(cleanReport({...REPORT, steps: Array.from({length: 50}, () => 'x'.repeat(900))}, 'persona').report.steps.length, 30);
  assert.equal(cleanReport([], 'persona').error, 'report is an object');
  assert.equal(decodeJpeg('data:image/jpeg;base64,!!!'), null);
  assert.equal(decodeJpeg(jpeg(10)).length, 10);
});

test('a JPEG string the pattern accepts but atob refuses is left out and named, the other files and the report are kept (no 500)', async () => {
  const e = env();
  const answer = await post(e, {files: {'logs.txt': 'line', 'app.jpg': 'data:image/jpeg;base64,AAAAA', 'tab.jpg': 'data:image/jpeg;base64,AB='}});
  assert.equal(answer.status, 200);
  const body = await answer.json();
  assert.deepEqual(body.skipped, ['app.jpg', 'tab.jpg']);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].map(key => key.split('/')[2]).sort(), ['logs.txt', 'report.json']);
});
