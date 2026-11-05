// A Codex turn that never finishes must come back from the container at its guard, with the conversation dropped, and the next turn must answer (runs 42057090129 and 42058621304, 5 Nov 2026: calls 1-4 of a conversation answered, the 5th got nothing in 180 s while the guard is 100 s).
// Guard: money — a stalled turn holds the conversation's lock and one of the 4 Codex slots for as long as it hangs; every persona call behind it waits, and the night's budget burns on a caller that gave up.
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

// The stand-in "codex": a real OS process. It counts the turns of its conversation in its folder; turn STALL_AT leaves a grandchild holding stdout and stderr (the way a helper process of the CLI would) and never answers.
const STAND_IN = `const fs = require('node:fs'), cp = require('node:child_process');
  const chunks = []; process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const turn = (fs.existsSync('turns') ? Number(fs.readFileSync('turns', 'utf8')) : 0) + 1;
    fs.writeFileSync('turns', String(turn));
    if (turn === Number(process.env.STALL_AT)) {
      console.log(JSON.stringify({type: 'thread.started', thread_id: 't1'})); console.log(JSON.stringify({type: 'turn.started'}));
      cp.spawn('sleep', ['5'], {stdio: 'inherit', detached: process.env.STRAY === 'own-group'});   // holds the pipes after codex itself is killed
      setInterval(() => {}, 1000);   // codex waits for a reply that never comes
      return;
    }
    fs.writeFileSync('out.txt', 'turn ' + turn);
    console.log(JSON.stringify({type: 'thread.started', thread_id: 't1'}));
    console.log(JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1000 * turn, cached_input_tokens: 0, output_tokens: turn}}));
  });`;

function serverWith(dir, {stallAt, stray}) {
  let handler;
  const spawn = (binary, args, options) => {
    if (args[0] === 'app-server') { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {}; child.stdin = {write(line) { const {id} = JSON.parse(line); if (id) queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({id, result: {rateLimits: {}}})}\n`)); }}; return child; }
    return spawnProcess(process.execPath, ['-e', STAND_IN], {...options, env: {...options.env, STALL_AT: String(stallAt), STRAY: stray}});
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../../../workers/ai-broker/container/server.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), {
    http: {createServer(fn) { handler = fn; return {listen() {}}; }},
    fs, os: {tmpdir: () => dir}, path, spawn, buildArgs, weeklyWindow, readTurn, threadTable, turnUsage, Buffer, setTimeout, clearTimeout, setInterval,
    process: {env: {CODEX_HOME: path.join(dir, 'home'), HOME: dir, PATH: process.env.PATH, CALL_TIMEOUT_MS: '1500', KILL_GRACE_MS: '500'}, kill: (pid, signal) => process.kill(pid, signal)},
  });
  return body => new Promise(resolve => {
    const request = new EventEmitter(); request.url = '/call'; request.method = 'POST';
    handler(request, {setHeader() {}, end(text) { resolve({status: this.statusCode, body: JSON.parse(text)}); }});
    request.emit('data', Buffer.from(JSON.stringify(body))); request.emit('end');
  });
}

for (const stray of ['same-group', 'own-group']) {
  test(`five turns on one conversation, the 5th stalls with a helper holding the pipes (${stray}): it comes back at the guard, and the turn after it answers`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-hang-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const call = serverWith(dir, {stallAt: 5, stray});
    const session = (expect, extra = {}) => ({key: 'jobadabra/jobadabra#1.1#agent-g1', expect, delta: 'next', ...extra});
    const first = await call({prompt: 'full prompt', model: 'm', session: session('none')});
    assert.equal(first.status, 200); assert.equal(first.body.session.mode, 'opened');
    for (let turn = 2; turn <= 4; turn++) { const next = await call({prompt: 'full prompt', model: 'm', session: session('warm')}); assert.equal(next.status, 200, `turn ${turn}`); assert.equal(next.body.session.mode, 'resumed'); }
    const started = Date.now();
    const stalled = await Promise.race([call({prompt: 'full prompt', model: 'm', session: session('warm')}), new Promise(resolve => setTimeout(() => resolve('no answer'), 3500))]);
    assert.notEqual(stalled, 'no answer', 'the guard answered within 3.5 s (guard 1.5 s + at most 0.5 s grace); the old run() waited for the helper, about 5 s');
    assert.equal(stalled.status, 500);
    assert.match(stalled.body.error, /^codex-failed:null \[killed after 1\.5 s: codex did not finish\]/, 'the failure says it was the guard');
    assert.match(stalled.body.error, /\[codex events: 2, last: thread\.started > turn\.started\]/, 'and what codex had printed before it stalled');
    assert.ok(Date.now() - started < 3000, `came back after ${Date.now() - started} ms`);
    const after = await call({prompt: 'full prompt', model: 'm', session: session('none', {restart: 'gap'})});
    assert.equal(after.status, 200, 'the turn after a stalled one is a new conversation and answers');
    assert.equal(after.body.session.mode, 'restarted');
  });
}
