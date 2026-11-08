// A deploy no longer drops the calls in flight (bd, 8 Nov 2026; web#493 lost 3 calls of p10's recording, #494 a pair, #498 met Tape 8).
// Design (worker.js toContainer, container/server.mjs): serving -> SIGTERM -> draining (refuses new calls with x-broker-draining, finishes the running ones, exits 0) -> gone; the Worker sends a refused call again until a container accepts it.
// Guard: money and recordings — a call cut by a restart costs a recording or a job its turn; a retry that double-counted would spend the week twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {body, success, harness, CodexBroker} from './harness.mjs';

const refused = () => new Response(JSON.stringify({error: 'draining'}), {status: 503, headers: {'x-broker-draining': '1'}});
const SERVER = process.env.DRAIN_SERVER || new URL('../../../../workers/ai-broker/container/server.mjs', import.meta.url).pathname;   // the env var points the real-process test at an older server.mjs to prove it fails there

// --- Worker half: a call a draining container refused goes to the next container, once, uncounted ---
function broker({sequence, env = {}}) {
  const made = harness(undefined, env);
  const seen = [];
  made.broker.drainWaitMs = 200; made.broker.drainPollMs = 5;
  made.broker.containerFetch = async url => { seen.push(new URL(url).pathname); return (sequence[Math.min(seen.length, sequence.length) - 1] ?? success)(); };
  return {...made, seen};
}
const weekTokens = async storage => (await storage.get('meter'))?.tokens?.scheduled ?? 0;

test('Codex: a call the draining container refused is answered by the next container, and the week is counted once', async () => {
  const {broker: b, seen, storage} = broker({sequence: [refused, refused, success]});
  const reply = await b.call('scheduled', body);
  assert.equal(reply.status, 200); assert.equal((await reply.json()).engine, 'codex');
  assert.deepEqual(seen, ['/call', '/call', '/call']);
  assert.equal(await weekTokens(storage), 5, 'one answer of 2 + 3 tokens, not one per attempt');
});

test('Claude: the same hand-over on the Claude route', async () => {
  const {broker: b, seen} = broker({sequence: [refused, () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}))], env: {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'}});
  const reply = await b.call('scheduled', {...body, engine: 'claude', only: true});
  assert.equal((await reply.json()).engine, 'claude');
  assert.deepEqual(seen, ['/claude', '/claude']);
});

test('the hand-over wait leaves a refused call time to run before its caller (180 s, no retry) gives up', () => {
  const wait = new CodexBroker({storage: {}}, {}).drainWaitMs;
  assert.ok(wait + 100_000 + 10_000 <= 180_000, `${wait} ms of waiting + a 100 s Codex guard + a start must fit in the caller's 180 s`);
});

test('a container that stays draining for ever does not hold the call past the wait', async () => {
  const {broker: b, seen} = broker({sequence: [refused]});
  b.drainWaitMs = 60;
  const reply = await b.call('scheduled', body);
  assert.notEqual(reply.status, 200);
  assert.ok(seen.length <= 60 / 5 + 2, `${seen.length} attempts: each waits at least one 5 ms poll, so a 60 ms wait allows at most 14 (a loaded machine makes it fewer, never more)`);
});

test('a call a container ACCEPTED and then lost is never sent twice', async () => {
  const {broker: b, seen} = broker({sequence: [() => { throw new Error('Container suddenly disconnected'); }]});
  await assert.rejects(b.call('scheduled', body), /disconnected/);
  assert.deepEqual(seen, ['/call']);
});

test('a refused call lands on a NEW container: if that one fails while it starts, the call still passes on to the next engine (#285 holds across the swap)', async () => {
  const codexFailed = () => new Response(JSON.stringify({error: 'codex-failed:1 ps/mcp … Transport channel closed'}), {status: 500});
  const claudeOk = () => new Response(JSON.stringify({reply: 'claude ok', tokens: {input: 5, output: 3}, ms: 7}));
  const {broker: b, seen} = broker({sequence: [refused, codexFailed, claudeOk], env: {CLAUDE_CODE_OAUTH_TOKEN: 'fixture-not-a-token'}});   // the harness broker had already answered before the swap
  const answer = await (await b.call('scheduled', body)).json();
  assert.equal(answer.engine, 'claude'); assert.equal(answer.fellBack[0].engine, 'codex');
  assert.deepEqual(seen, ['/call', '/call', '/claude']);
});

test('the Dockerfile keeps node as PID 1 (exec-form CMD), the only place SIGTERM reaches the drain handler', () => {
  const cmd = fs.readFileSync(new URL('../../../../workers/ai-broker/container/Dockerfile', import.meta.url), 'utf8').split('\n').filter(line => /^(CMD|ENTRYPOINT)\b/.test(line));
  assert.deepEqual(cmd, ['CMD ["node", "/app/container/server.mjs"]']);
});

// --- Container half: the real server.mjs as a real process, with a stand-in `codex` that needs 1.2 s per call ---
const STAND_IN = `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'app-server') { process.stdin.on('data', d => { for (const line of String(d).split('\\n')) { if (!line) continue; const {id} = JSON.parse(line); if (id) process.stdout.write(JSON.stringify({id, result: {rateLimits: {}}}) + '\\n'); } }); }
else { const chunks = []; process.stdin.on('data', c => chunks.push(c)); process.stdin.on('end', () => setTimeout(() => {
  fs.writeFileSync('out.txt', 'answered');
  console.log(JSON.stringify({type: 'thread.started', thread_id: 't1'}));
  console.log(JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1, cached_input_tokens: 0, output_tokens: 1}}));
}, 1200)); }
`;
const post = (port, pathname) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path: pathname, method: 'POST', agent: false}, res => { let text = ''; res.on('data', d => { text += d; }); res.on('end', () => resolve({status: res.statusCode, drained: res.headers['x-broker-draining'], body: text})); });
  req.on('error', reject); req.end(JSON.stringify({prompt: 'hello', model: 'm'}));
});

test('a real server.mjs told to stop refuses a new call at once, finishes the one running, then exits 0', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-drain-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'codex'), STAND_IN, {mode: 0o755});
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {env: {PATH: `${dir}:${process.env.PATH}`, HOME: dir, CODEX_HOME: path.join(dir, 'home'), BROKER_TEST_PORT: String(port)}, stdio: ['ignore', 'ignore', 'inherit']});
  t.after(() => child.kill('SIGKILL'));
  const ended = new Promise(done => child.on('exit', (code, signal) => done({code, signal, at: Date.now()})));
  for (let i = 0; i < 50; i++) { if (await post(port, '/nothing').then(() => true, () => false)) break; await new Promise(r => setTimeout(r, 100)); }   // listening
  const running = post(port, '/call');
  await new Promise(r => setTimeout(r, 400));   // the call is inside codex
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 100));
  const late = await post(port, '/call');
  assert.equal(late.status, 503); assert.equal(late.drained, '1'); assert.match(late.body, /draining/, 'a call arriving while the container stops is refused before it starts');
  const lateClaude = await post(port, '/claude');
  assert.equal(lateClaude.status, 503); assert.equal(lateClaude.drained, '1', 'the Claude route drains too');
  const first = await running;
  assert.equal(first.status, 200, first.body); assert.equal(JSON.parse(first.body).reply, 'answered', 'the call that was running finished');
  const end = await ended;
  assert.deepEqual({code: end.code, signal: end.signal}, {code: 0, signal: null}, 'the last reply flushed, then a clean exit');
});

test('a real idle server.mjs exits 0 on the stop signal (no handler = the signal is ignored as PID 1)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-drain-idle-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {env: {PATH: process.env.PATH, HOME: dir, CODEX_HOME: path.join(dir, 'home'), BROKER_TEST_PORT: String(port)}, stdio: ['ignore', 'ignore', 'inherit']});
  t.after(() => child.kill('SIGKILL'));
  const ended = new Promise(done => child.on('exit', (code, signal) => done({code, signal})));
  for (let i = 0; i < 50; i++) { if (await post(port, '/nothing').then(() => true, () => false)) break; await new Promise(r => setTimeout(r, 100)); }
  child.kill('SIGTERM');
  assert.deepEqual(await ended, {code: 0, signal: null});
});

test('a call whose client went away does not hold the exit until the platform kills the container', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-drain-abort-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'codex'), STAND_IN, {mode: 0o755});
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {env: {PATH: `${dir}:${process.env.PATH}`, HOME: dir, CODEX_HOME: path.join(dir, 'home'), BROKER_TEST_PORT: String(port)}, stdio: ['ignore', 'ignore', 'inherit']});
  t.after(() => child.kill('SIGKILL'));
  const ended = new Promise(done => child.on('exit', (code, signal) => done({code, signal})));
  for (let i = 0; i < 50; i++) { if (await post(port, '/nothing').then(() => true, () => false)) break; await new Promise(r => setTimeout(r, 100)); }
  const req = http.request({host: '127.0.0.1', port, path: '/call', method: 'POST', agent: false}); req.on('error', () => {}); req.end(JSON.stringify({prompt: 'hello', model: 'm'}));
  await new Promise(r => setTimeout(r, 400));
  req.destroy();   // the Worker gave up on it
  await new Promise(r => setTimeout(r, 100));
  child.kill('SIGTERM');
  const end = await Promise.race([ended, new Promise(r => setTimeout(() => r('still running after 5 s'), 5000))]);
  assert.deepEqual(end, {code: 0, signal: null});
});

test('a body still arriving at the stop signal is not cut: it finishes arriving, is refused as draining, then the exit', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-drain-upload-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {env: {PATH: process.env.PATH, HOME: dir, CODEX_HOME: path.join(dir, 'home'), BROKER_TEST_PORT: String(port)}, stdio: ['ignore', 'ignore', 'inherit']});
  t.after(() => child.kill('SIGKILL'));
  let exited = null; child.on('exit', (code, signal) => { exited = {code, signal}; });
  for (let i = 0; i < 50; i++) { if (await post(port, '/nothing').then(() => true, () => false)) break; await new Promise(r => setTimeout(r, 100)); }
  const payload = JSON.stringify({prompt: 'hello', model: 'm'});
  const socket = net.connect(port, '127.0.0.1');
  let answer = ''; socket.on('data', d => { answer += d; });
  socket.write(`POST /call HTTP/1.1\r\nHost: x\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n${payload.slice(0, 10)}`);
  await new Promise(r => setTimeout(r, 300));
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(exited, null, 'a request that is still open keeps the process alive');
  socket.write(payload.slice(10));
  await new Promise(done => socket.on('close', done));
  assert.match(answer, /^HTTP\/1\.1 503/); assert.match(answer, /x-broker-draining: 1/i);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(exited, {code: 0, signal: null});
});
