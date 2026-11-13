// A Codex call's trace names every host codex opened a connection to, with its time, so the container-only exit wait (exits on 5 s steps after spawn, 13 Nov 2026, #614's after-numbers) names its host.
// Guard: secrets — only a host name ever leaves codex's debug lines; the lines themselves never reach the reply, the error tail or the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {spawn as spawnProcess} from 'node:child_process';
import {buildArgs} from '../../../../workers/ai-broker/lib/args.mjs';
import {weeklyWindow} from '../../../../workers/ai-broker/container/weekly.mjs';
import {readTurn, threadTable, turnUsage} from '../../../../workers/ai-broker/container/threads.mjs';
import {kindOf} from '../../../../workers/ai-broker/container/kinds.mjs';

// The stand-in "codex": prints reqwest's connection lines the way codex 0.162.1 does under RUST_LOG (format measured 13 Nov 2026), one ordinary warning, and either answers or exits 1.
const STAND_IN = `const fs = require('node:fs');
  process.stdin.resume(); process.stdin.on('end', () => {
    const at = '2026-11-13T04:12:40.659514Z';
    process.stderr.write(at + ' DEBUG reqwest::connect: starting new connection: https://chatgpt.com/\\n');
    process.stderr.write(at + ' DEBUG hyper_util::client::legacy::connect::http: connecting to 104.18.32.47:443\\n');
    process.stderr.write(at + ' DEBUG reqwest::connect: starting new connection: https://Ab.ChatGPT.com:443/otlp?key=' + 'sk-' + 'x'.repeat(40) + '\\n');
    process.stderr.write(at + ' DEBUG hyper_util::client::legacy::connect::dns: resolving host="telemetry.example.net"\\n');
    process.stderr.write('a plain warning line\\n');
    process.stderr.write(at + ' DEBUG reqwest::connect: starting new connection: https://partial.example.org/');   // the last line has no newline
    if (process.env.FAIL) process.exit(1);
    fs.writeFileSync('out.txt', 'ok');
    console.log(JSON.stringify({type: 'thread.started', thread_id: 't1'}));
    console.log(JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1, cached_input_tokens: 0, output_tokens: 1}}));
  });`;

function serverWith(dir, fail, seen) {
  let handler;
  const spawn = (binary, args, options) => {
    if (args[0] === 'app-server') { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {}; child.stdin = {write(line) { const {id} = JSON.parse(line); if (id) queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({id, result: {rateLimits: {}}})}\n`)); }}; return child; }
    seen.env = options.env;
    return spawnProcess(process.execPath, ['-e', STAND_IN], {...options, env: {...options.env, ...(fail ? {FAIL: '1'} : {})}});
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../../../workers/ai-broker/container/server.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), {
    http: {createServer(fn) { handler = fn; return {listen() {}}; }},
    fs, os: {tmpdir: () => dir}, path, spawn, buildArgs, weeklyWindow, readTurn, threadTable, turnUsage, kindOf, Buffer, setTimeout, clearTimeout, setInterval,
    process: {on() {}, env: {CODEX_HOME: path.join(dir, 'home'), HOME: dir, PATH: process.env.PATH, }, kill: (pid, signal) => process.kill(pid, signal)},
  });
  return body => new Promise(resolve => {
    const request = new EventEmitter(); request.url = '/call'; request.method = 'POST';
    handler(request, {setHeader() {}, once() {}, end(text) { resolve({status: this.statusCode, body: JSON.parse(text)}); }});
    request.emit('data', Buffer.from(JSON.stringify(body))); request.emit('end');
  });
}

test('codex runs with connection logging on, and the trace names each host it connected to, nothing else of those lines', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-hosts-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const seen = {};
  const {status, body} = await serverWith(dir, false, seen)({prompt: 'p', model: 'm'});
  assert.equal(status, 200);
  assert.match(seen.env.RUST_LOG, /^error,/, 'everything else stays at the error level codex printed before');
  assert.match(seen.env.RUST_LOG, /reqwest::connect=debug/);
  const hosts = body.trace.split('|').map(stamp => stamp.split(' ')[1]).filter(label => label.startsWith('host:'));
  assert.deepEqual(hosts, ['host:chatgpt.com', 'host:ab.chatgpt.com', 'host:telemetry.example.net', 'host:partial.example.org'], 'each connection and lookup in order, lower-cased, the last line without a newline too');
  assert.doesNotMatch(body.trace, /sk-|otlp|104\.18|DEBUG/, 'a path, a query, an address or a log word never reaches the trace');
  assert.match(body.trace, /\d+ stderr\|/, 'the plain warning still stamps stderr');
});

test('a failed call keeps its error tail as before: plain stderr lines only, never codex debug lines', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-hosts-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {status, body} = await serverWith(dir, true, {})({prompt: 'p', model: 'm'});
  assert.equal(status, 500);
  assert.match(body.error, /^codex-failed:1 a plain warning line\s*$/, 'the tail is the warning alone');
  assert.match(body.trace, /host:ab\.chatgpt\.com/, 'a failed call names its hosts too');
});
