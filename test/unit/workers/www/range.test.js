// Byte ranges for the landing's videos (workers/www/range.js): Safari plays a <video> only when a Range request is answered with 206 + Content-Range.
// The worker must run first for every folder that holds a video (wrangler.toml run_worker_first), or static assets answer 200 with the whole file.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import {mediaRange, parseRange} from '../../../../workers/www/range.js';

const bytes = Uint8Array.from({length: 1000}, (_, i) => i % 251);
const env = {ASSETS: {async fetch(request) {
  assert.equal(request.headers.get('range'), null, 'the asset is fetched whole, the worker slices it');
  return new Response(bytes, {status: 200, headers: {'content-type': 'video/mp4', 'cache-control': 'public, max-age=0, must-revalidate'}});
}}};
const get = (range, method = 'GET') => mediaRange(new Request('https://x.example/media/a.mp4', {method, headers: range ? {range} : {}}), env);

test('range forms: from-to, open end, last n bytes; anything else is not a range', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), {start: 0, end: 99});
  assert.deepEqual(parseRange('bytes=900-', 1000), {start: 900, end: 999});
  assert.deepEqual(parseRange('bytes=-100', 1000), {start: 900, end: 999});
  assert.deepEqual(parseRange('bytes=990-5000', 1000), {start: 990, end: 999});
  for (const bad of ['bytes=1000-', 'bytes=5-2', 'bytes=-', 'items=0-1', '', null]) assert.equal(parseRange(bad, 1000), null, String(bad));
});

test('a Range request gets 206 with Content-Range and exactly those bytes; Accept-Ranges is always said', async () => {
  const res = await get('bytes=10-19');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 10-19/1000');
  assert.equal(res.headers.get('content-length'), '10');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...bytes.slice(10, 20)]);
  const whole = await get(null);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
});

test('a range past the end is 416; HEAD gets no body', async () => {
  const past = await get('bytes=5000-');
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), 'bytes */1000');
  assert.equal((await get(null, 'HEAD')).body, null);
});

test('every folder of public/ that holds a video is run through the worker first', () => {
  const toml = readFileSync(new URL('../../../../workers/www/wrangler.toml', import.meta.url), 'utf8');
  const root = new URL('../../../../web/public/', import.meta.url);
  const folders = new Set();
  const walk = (dir, prefix) => { for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
    else if (/\.(mp4|webm)$/.test(entry.name)) folders.add(prefix); } };
  walk(root, '');
  assert.ok(folders.size > 0);
  for (const folder of folders) assert.ok(toml.includes(`"/${folder}*"`), `run_worker_first lacks "/${folder}*" (a video there gets 200, not 206)`);
});
