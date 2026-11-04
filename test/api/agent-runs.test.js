// The AI persona's runs (api/agent-runs.js): CI uploads a run's record, video and note screenshots (Bearer REPLAYS_PUBLISH_KEY) under agent/<run>/ in the Lab's private bucket, the owner reads them with Range,
// anything older than 14 days is dropped on the next upload without touching the Lab's own fill videos, and every refusal (key, id, file name, type, size, no bucket) is tested.
// Guard: privacy — only the owner may read a run, and a name is never a path.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEEP_DAYS, MAX_RECORD, MAX_SHOT, MAX_VIDEO, runData, runFile, runIngest} from '../../api/agent-runs.js';

const KEY = 'k'.repeat(64);
const bucket = () => {
  const kept = new Map();
  return {kept,
    put: async (name, value, options) => { kept.set(name, {bytes: new Uint8Array(value), uploaded: options.uploaded || new Date(), ...options}); },
    delete: async names => { for (const name of [].concat(names)) kept.delete(name); },
    list: async ({prefix = ''} = {}) => ({objects: [...kept].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({key, uploaded: o.uploaded, customMetadata: o.customMetadata})), truncated: false}),
    head: async name => { const o = kept.get(name); return o ? {size: o.bytes.length, httpMetadata: o.httpMetadata} : null; },
    get: async (name, {range} = {}) => { const o = kept.get(name); if (!o) return null;
      const offset = range?.offset ?? 0, length = range?.length ?? o.bytes.length - offset;
      return {body: o.bytes.slice(offset, offset + length), size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata}; }};
};
const env = (extra = {}) => ({LAB_FILLS: bucket(), REPLAYS_PUBLISH_KEY: KEY, STATS_API_KEY: 'owner-key', STATS_KEY: 'k', ...extra});
const record = (run, extra = {}) => ({run, at: '2026-11-04T15:00:00Z', kind: 'replay', commit: 'b4d64112', plan: 'learned-questions', goals: [{n: 1, verdict: 'could-not-finish'}, {n: 2, verdict: 'worked'}], notes: [{goal: 1}], cost: {calls: 58, tokens: 1836000, minutes: 13}, ...extra});
const put = (e, {run = '41857218091', file = 'run.json', type, body, size = 1000, key = KEY, now = new Date('2026-11-04T16:00:00Z')} = {}) => {
  const asJson = file === 'run.json', kind = type || (asJson ? 'application/json' : file.endsWith('.webm') ? 'video/webm' : 'image/png');
  const bytes = body ?? (asJson ? new TextEncoder().encode(JSON.stringify(record(run))) : new Uint8Array(size).fill(7));
  return runIngest(new Request(`https://x.test/agent/run?run=${run}&file=${encodeURIComponent(file)}`, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': kind}, body: bytes}), e, now);
};
const auth = a => (a ? {Authorization: `Bearer ${a}`} : {});
const data = (e, query, a = 'owner-key') => runData(new Request(`https://x.test/admin/ai-persona/data${query}`, {headers: auth(a)}), e);
const file = (e, query, headers = {}, a = 'owner-key') => runFile(new Request(`https://x.test/admin/ai-persona/file${query}`, {headers: {...auth(a), ...headers}}), e);

test('only the publish key writes; no key, a wrong key or no bucket never stores a byte', async () => {
  const e = env();
  assert.equal((await put(e, {key: 'wrong'})).status, 404);
  assert.equal((await put(env({REPLAYS_PUBLISH_KEY: ''}))).status, 404);
  assert.equal((await put(env({LAB_FILLS: undefined}))).status, 503);
  assert.equal(e.LAB_FILLS.kept.size, 0);
});

test('refuses a run id that is not a number, a file name that is not one of three, a wrong type, a size over the cap, an empty body and a record that is not this run\'s', async () => {
  const e = env();
  for (const run of ['', 'abc', '../41857218091', '41857218091/x', '1']) assert.equal((await put(e, {run})).status, 400, `run ${run}`);
  for (const name of ['../run.json', 'agent/run.json', 'run.json/x', 'shot-0.png', 'shot-100.png', 'shot-1.jpg', 'notes.txt', '']) assert.equal((await put(e, {file: name, size: 10})).status, 400, `file ${name}`);
  assert.equal((await put(e, {file: 'video.webm', type: 'text/html'})).status, 400);
  assert.equal((await put(e, {file: 'run.json', type: 'text/html', body: new TextEncoder().encode('{}')})).status, 400);
  assert.equal((await put(e, {file: 'video.webm', size: MAX_VIDEO + 1})).status, 413);
  assert.equal((await put(e, {file: 'shot-1.png', size: MAX_SHOT + 1})).status, 413);
  assert.equal((await put(e, {file: 'run.json', body: new Uint8Array(MAX_RECORD + 1)})).status, 413);
  assert.equal((await put(e, {file: 'video.webm', size: 0})).status, 400);
  assert.equal((await put(e, {body: new TextEncoder().encode('not json')})).status, 400);
  assert.equal((await put(e, {body: new TextEncoder().encode(JSON.stringify(record('999999')))})).status, 400, 'a record of another run');
  assert.equal((await put(e, {body: new TextEncoder().encode('[]')})).status, 400);
  assert.equal(e.LAB_FILLS.kept.size, 0);
});

test('a run\'s record, video and screenshots are kept under agent/<run>/ and the list shows verdict counts, cost, the video and the number of screenshots, newest first', async () => {
  const e = env();
  for (const file of ['run.json', 'video.webm', 'shot-1.png', 'shot-2.png']) assert.equal((await put(e, {file})).status, 200, file);
  assert.equal((await put(e, {run: '41860394127', body: new TextEncoder().encode(JSON.stringify(record('41860394127', {at: '2026-11-04T16:30:00Z', goals: [{verdict: 'bug'}], notes: []}))), now: new Date('2026-11-04T16:31:00Z')})).status, 200);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].sort(), ['agent/41857218091/run.json', 'agent/41857218091/shot-1.png', 'agent/41857218091/shot-2.png', 'agent/41857218091/video.webm', 'agent/41860394127/run.json']);
  const {runs} = await (await data(e, '?index')).json();
  assert.deepEqual(runs.map(row => row.run), ['41860394127', '41857218091']);
  const [newer, older] = runs;
  assert.deepEqual({bug: newer.bug, video: newer.video, shots: newer.shots}, {bug: '1', video: false, shots: 0});
  assert.deepEqual({worked: older.worked, stuck: older.stuck, notes: older.notes, calls: older.calls, tokens: older.tokens, minutes: older.minutes, commit: older.commit, kind: older.kind, video: older.video, videoBytes: older.videoBytes, shots: older.shots},
    {worked: '1', stuck: '1', notes: '1', calls: '58', tokens: '1836000', minutes: '13', commit: 'b4d64112', kind: 'replay', video: true, videoBytes: 1000, shots: 2});
});

test('a file older than 14 days leaves with the next upload; the Lab\'s own fill videos are never touched', async () => {
  const e = env();
  e.LAB_FILLS.kept.set('agent/100000/run.json', {bytes: new Uint8Array(3), uploaded: new Date('2026-10-01T00:00:00Z'), customMetadata: {at: '2026-10-01T00:00:00Z'}});
  e.LAB_FILLS.kept.set('fills/abc.webm', {bytes: new Uint8Array(3), uploaded: new Date('2026-10-01T00:00:00Z'), customMetadata: {name: 'lab row'}});
  assert.equal(KEEP_DAYS, 14);
  await put(e);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()].sort(), ['agent/41857218091/run.json', 'fills/abc.webm']);
});

test('only the owner reads a run: the record, then a video or screenshot whole or by Range, and never anything else', async () => {
  const e = env();
  await put(e);
  await put(e, {file: 'video.webm', size: 1000});
  assert.equal((await data(e, '?run=41857218091', null)).status, 404);
  assert.equal((await data(e, '?run=41857218091', 'wrong')).status, 404);
  assert.equal((await data(e, '?index', null)).status, 404);
  assert.equal((await (await data(e, '?run=41857218091')).json()).plan, 'learned-questions');
  assert.equal((await data(e, '?run=41857218092')).status, 404);
  const q = '?run=41857218091&name=video.webm';
  assert.equal((await file(e, q, {}, null)).status, 404);
  assert.equal((await file(e, q, {}, 'wrong')).status, 404);
  const whole = await file(e, q);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Content-Type'), 'video/webm');
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
  const part = await file(e, q, {Range: 'bytes=100-199'});
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.equal((await file(e, q, {Range: 'bytes=5000-'})).status, 416);
  for (const bad of ['?run=41857218091&name=run.json', '?run=41857218091&name=../x', '?run=41857218091&name=shot-1.png', '?run=abc&name=video.webm', '?name=video.webm']) assert.equal((await file(e, bad)).status, 404, bad);
});
