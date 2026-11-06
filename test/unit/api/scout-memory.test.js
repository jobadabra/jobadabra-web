// The central scout's memory in R2 (api/scout-memory.js): only INDEX_PUBLISH_KEY reads or writes it, a save is stored as that day's run and comes back as the newest,
// saves older than 30 days are dropped on the next save, and a body that is too large, empty or not gzip is refused before a byte is stored.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEEP_DAYS, MAX_BYTES, scoutMemory} from '../../../api/scout-memory.js';

const KEY = 'p'.repeat(64);
const bucket = ({failList = false} = {}) => {
  const kept = new Map();
  let clock = 0;
  return {kept,
    put: async (name, value, options) => { kept.set(name, {bytes: new Uint8Array(value), uploaded: options.uploaded || new Date(Date.parse(options.customMetadata.at) + clock++), ...options}); },
    delete: async names => { for (const name of [].concat(names)) kept.delete(name); },
    list: async ({prefix, cursor} = {}) => {
      if (failList) throw new Error('R2 list failed');
      const all = [...kept].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({key, uploaded: o.uploaded, size: o.bytes.length}));
      const start = Number(cursor || 0), page = all.slice(start, start + 2);   // two a page, so the code has to follow the cursor
      return {objects: page, truncated: start + 2 < all.length, cursor: String(start + 2)};
    },
    get: async name => { const o = kept.get(name); return o ? {body: o.bytes, size: o.bytes.length} : null; }};
};
const env = (extra = {}) => ({SCOUT_MEMORY: bucket(), INDEX_PUBLISH_KEY: KEY, ...extra});
const gzip = (size = 1000, fill = 7) => { const bytes = new Uint8Array(size).fill(fill); bytes[0] = 0x1f; bytes[1] = 0x8b; return bytes; };
const put = (e, {run = '42118339535', body = gzip(), key = KEY, now = new Date('2026-11-06T10:00:00Z')} = {}) => scoutMemory(
  new Request(`https://x.test/api/scout-memory?run=${run}`, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/gzip'}, body}), e, now);
const get = (e, key = KEY) => scoutMemory(new Request('https://x.test/api/scout-memory', {headers: key ? {Authorization: `Bearer ${key}`} : {}}), e);

test('only the publish key reads or writes; no key, a wrong key or no bucket stores and returns nothing', async () => {
  const e = env();
  assert.equal((await put(e, {key: 'wrong'})).status, 404);
  assert.equal((await put(env({INDEX_PUBLISH_KEY: ''}), {key: ''})).status, 404);
  assert.equal(e.SCOUT_MEMORY.kept.size, 0);
  await put(e);
  assert.equal((await get(e, 'wrong')).status, 404);
  assert.equal((await get(e, null)).status, 404);
  assert.equal((await put(env({SCOUT_MEMORY: undefined}))).status, 503);
  assert.equal((await get(env({SCOUT_MEMORY: undefined}))).status, 503);
});

test('a save comes back byte for byte, as that day\'s run, and the newest of several is the one read', async () => {
  const e = env();
  assert.equal((await get(e)).status, 404);   // nothing saved yet: the scout starts from its cache or empty
  const first = await put(e, {run: '42118339535', body: gzip(1000, 1), now: new Date('2026-11-05T22:00:00Z')});
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {ok: true, key: '2026-11-05-42118339535', bytes: 1000, dropped: 0});
  await put(e, {run: '42120000001-2', body: gzip(2000, 2), now: new Date('2026-11-06T04:00:00Z')});
  await put(e, {run: '9', body: gzip(1500, 3), now: new Date('2026-11-06T09:00:00Z')});   // a run id that sorts first by name is still the newest
  const answer = await get(e);
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get('Content-Type'), 'application/gzip');
  assert.equal(answer.headers.get('X-Scout-Memory'), '2026-11-06-9');
  assert.equal(answer.headers.get('Cache-Control'), 'no-store');
  const bytes = new Uint8Array(await answer.arrayBuffer());
  assert.equal(bytes.length, 1500);
  assert.equal(bytes[2], 3);
  assert.deepEqual([...e.SCOUT_MEMORY.kept.keys()].sort(), ['scout-memory/2026-11-05-42118339535.tgz', 'scout-memory/2026-11-06-42120000001-2.tgz', 'scout-memory/2026-11-06-9.tgz']);
});

test(`a save drops the saves older than ${KEEP_DAYS} days, following every page, and keeps the rest`, async () => {
  const e = env();
  const dropped = [];
  for (const [at, run] of [['2026-10-01T12:00', '1'], ['2026-10-07T12:00', '2'], ['2026-10-07T13:00', '3'], ['2026-10-20T12:00', '4'], ['2026-11-05T12:00', '5'], ['2026-11-06T12:30', '6']]) {
    dropped.push((await (await put(e, {run, now: new Date(`${at}:00Z`)})).json()).dropped);
  }
  // 5 Nov drops 1 Oct (35 days); 6 Nov 12:30 drops 7 Oct 12:00 (30 days and 30 minutes); 7 Oct 13:00 is 29 days and 23.5 hours old and stays
  assert.deepEqual(dropped, [0, 0, 0, 0, 1, 1]);
  assert.deepEqual([...e.SCOUT_MEMORY.kept.keys()].sort(), ['scout-memory/2026-10-07-3.tgz', 'scout-memory/2026-10-20-4.tgz', 'scout-memory/2026-11-05-5.tgz', 'scout-memory/2026-11-06-6.tgz']);
});

test('a trim that fails never loses the save, and the answer says so', async () => {
  const e = env({SCOUT_MEMORY: bucket({failList: true})});
  const answer = await put(e);
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {ok: true, key: '2026-11-06-42118339535', bytes: 1000, dropped: 'failed'});
  assert.equal(e.SCOUT_MEMORY.kept.size, 1);
});

test('refuses a body over the cap, an empty one, one that is not gzip, and a run that is not a run id', async () => {
  const e = env();
  assert.equal((await put(e, {body: gzip(MAX_BYTES + 1)})).status, 413);
  assert.equal((await put(e, {body: new Uint8Array(0)})).status, 400);
  assert.equal((await put(e, {body: new TextEncoder().encode('{"feeds":[]}')})).status, 400);
  for (const run of ['', '../latest', 'abc', '1'.repeat(40)]) assert.equal((await put(e, {run: encodeURIComponent(run)})).status, 400, run);
  assert.equal(e.SCOUT_MEMORY.kept.size, 0);
  assert.equal(MAX_BYTES, 50 * 1024 * 1024);
});

test('only GET and PUT', async () => {
  const answer = await scoutMemory(new Request('https://x.test/api/scout-memory', {method: 'DELETE', headers: {Authorization: `Bearer ${KEY}`}}), env());
  assert.equal(answer.status, 405);
});
