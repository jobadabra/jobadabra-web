// The container's /claude route runs the Claude CLI with the caller's effort, as the app's own engine does (src/ai/providers/claude_code.py adds --effort).
// Guard: right answers. Before 13 Nov 2026 the route dropped the effort, so a Haiku call ran at the CLI default and thought ~45% longer than the same call in the app.
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
import {CLAUDE_TIMEOUT_MS, claudeArgs, claudeInput, readClaude} from '../../../../workers/ai-broker/container/claude.mjs';
import {kindOf} from '../../../../workers/ai-broker/container/kinds.mjs';

// The stand-in "claude": reads its prompt and prints a result line the way CLI 2.1.316 does (trimmed to the fields readClaude reads).
const STAND_IN = `process.stdin.resume(); process.stdin.on('end', () => {
  console.log(JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: 'pong', stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0}}));
});`;

function server(dir, seen) {
  let handler;
  const spawn = (binary, args, options) => {
    if (args[0] === 'app-server') { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {}; child.stdin = {write() {}}; return child; }
    seen.push({binary, args});
    return spawnProcess(process.execPath, ['-e', STAND_IN], options);
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../../../workers/ai-broker/container/server.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), {
    http: {createServer(fn) { handler = fn; return {listen() {}}; }},
    fs, os: {tmpdir: () => dir}, path, spawn, buildArgs, weeklyWindow, readTurn, threadTable, turnUsage, kindOf, CLAUDE_TIMEOUT_MS, claudeArgs, claudeInput, readClaude, Buffer, setTimeout, clearTimeout, setInterval,
    process: {on() {}, env: {CODEX_HOME: path.join(dir, 'home'), HOME: dir, PATH: process.env.PATH}, kill: (pid, signal) => process.kill(pid, signal)},
  });
  return body => new Promise(resolve => {
    const request = new EventEmitter(); request.url = '/claude'; request.method = 'POST';
    handler(request, {setHeader() {}, once() {}, end(text) { resolve({status: this.statusCode, body: JSON.parse(text)}); }});
    request.emit('data', Buffer.from(JSON.stringify(body))); request.emit('end');
  });
}

test('the /claude route hands the caller\'s effort to the CLI, and a call without one runs at the CLI default as before', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-claude-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const seen = [], ask = server(dir, seen);
  const low = await ask({prompt: 'p', model: 'claude-haiku-5-5', effort: 'low'});
  assert.equal(low.status, 200); assert.equal(low.body.reply, 'pong');
  assert.equal(seen[0].binary, 'claude');
  assert.deepEqual(seen[0].args, claudeArgs({model: 'claude-haiku-5-5', effort: 'low'}));
  assert.deepEqual(seen[0].args.slice(seen[0].args.indexOf('--effort'), seen[0].args.indexOf('--effort') + 2), ['--effort', 'low']);
  await ask({prompt: 'p', model: 'claude-haiku-5-5'});
  assert.ok(!seen[1].args.includes('--effort'), 'no effort asked, none sent: the CLI picks its own');
});
