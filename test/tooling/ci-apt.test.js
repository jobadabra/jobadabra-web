// A CI step that installs apt packages never hangs (owner, 25 Oct 2026: "ffmpeg for the hero media tests" sat 11m51s on web #122, normally 15-30 s; "let's fix it").
// Every workflow installs through tools/apt-install.sh (a cut on each try, a retry, a clear failure), and every step that calls it has its own timeout-minutes.
// This loops over all workflow files, so a new apt-get anywhere fails here. Guards: tools/apt-install.sh, .github/workflows/*.yml.
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
// This repo's workflows only: in the joined tree the public repo's own workflows sit beside them (they keep the same rule in the public repo), and only ours name `.private`.
const flows = readdirSync(new URL('.github/workflows/', root)).filter(name => name.endsWith('.yml') && readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8').includes('.private'));

test('the rule sees this repo\'s workflows', () => assert.ok(flows.includes('tests.yml'), 'tests.yml is one of them'));

test('no workflow calls apt-get itself: they go through tools/apt-install.sh', () => {
  for (const name of flows) {
    const text = readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8');
    assert.doesNotMatch(text, /apt-get/, `${name}: install through .private/tools/apt-install.sh (cut, retried), never a bare apt-get`);
  }
});

test('every step that installs through apt-install has a timeout-minutes of its own', () => {
  for (const name of flows) {
    const steps = readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8').split(/\n {6}- /);
    for (const step of steps.filter(each => each.includes('apt-install.sh'))) {
      assert.match(step, /\n\s+timeout-minutes: \d+/, `${name}: the step "${step.split('\n')[0].slice(0, 60)}" has no timeout-minutes`);
    }
  }
});

test('the script cuts every apt try, retries once and fails with a message', () => {
  const script = readFileSync(new URL('tools/apt-install.sh', root), 'utf8');
  assert.match(script, /Acquire::Retries/, 'apt retries a download');
  assert.match(script, /Acquire::http::Timeout/, 'apt gives up on a silent mirror');
  assert.match(script, /timeout --kill-after=10/, 'each try is cut');
  assert.match(script, /for attempt in 1 2/, 'one retry');
  assert.match(script, /::error::apt-install: could not install/, 'a clear failure');
});

// Runs the script with a fake sudo, timeout and apt-get on PATH: the first command counts its calls and fails `fails` times before it succeeds.
function run(fails, {stall = ''} = {}) {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'apt-'));
  const fake = (name, body) => { writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  fake('sudo', 'if [ "$1" = tee ]; then cat >/dev/null; else exec "$@"; fi');
  fake('timeout', 'shift; [ "${1#--kill-after}" != "$1" ] && shift; shift; exec "$@"');
  fake('sleep', 'exit 0');
  // `stall` = the phase that hangs: it prints apt's last download line and exits 124, as `timeout` does when it cuts a command
  fake('apt-get', `[ "$1" = update ] && { echo "Hit:1 http://azure.archive.ubuntu.com/ubuntu noble InRelease"; [ "${stall}" = update ] && exit 124; exit 0; }
n=$(cat ${bin}/n 2>/dev/null || echo 0); echo $((n+1)) > ${bin}/n; [ "${stall}" = install ] && { echo "Get:42 http://azure.archive.ubuntu.com/ubuntu noble/universe amd64 libavcodec60"; exit 124; }; [ $n -lt ${fails} ] && exit 100; exit 0`);
  mkdirSync(path.join(bin, 'apt', 'sources.list.d'), {recursive: true});
  writeFileSync(path.join(bin, 'apt', 'sources.list.d', 'ubuntu.sources'), 'URIs: mirror+file:/etc/apt/apt-mirrors.txt\n');
  // GitHub's Ubuntu runners list their mirrors here, the sources only point at it (26 Oct 2026 run 40389661253: try 2 still fetched from azure)
  writeFileSync(path.join(bin, 'apt', 'apt-mirrors.txt'), 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n');
  const result = spawnSync('bash', [new URL('tools/apt-install.sh', root).pathname, 'ffmpeg'], {env: {...process.env, PATH: `${bin}:${process.env.PATH}`, APT_DIR: path.join(bin, 'apt')}, encoding: 'utf8'});
  return {...result, sources: readFileSync(path.join(bin, 'apt', 'apt-mirrors.txt'), 'utf8')};
}

test('a failed first try is retried and the second succeeds', () => {
  const result = run(1);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ffmpeg ready \(try 2, \d+ s\)/);
  assert.doesNotMatch(result.sources, /azure/, 'the second try uses another mirror (web #154: the same mirror stalled 3 times), also in the runner\'s mirror list');
  assert.match(result.sources, /archive\.ubuntu\.com\/ubuntu/);
});

test('a first try that works keeps the runner\'s own mirror', () => {
  const result = run(0);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.sources, /azure\.archive\.ubuntu\.com/);
});

test('two failed tries end the step at once with a clear error', () => {
  const result = run(9);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::apt-install: could not install ffmpeg after 2 tries/);
});

// 26 Oct 2026: main's ffmpeg step stalled ~95 s on both tries at 16:34, 19:07 and 19:21 (green in 14-21 s otherwise) and "apt said:" printed
// nothing: apt ran with -qq and the try was cut. A failed try now names the phase, cut or exit code, and apt's last download lines.
test('a stalled install says which phase was cut and the last line apt fetched', () => {
  const result = run(0, {stall: 'install'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /try 1: apt-get install cut after 90 s/);
  assert.match(result.stderr, /Get:42 http:\/\/azure\.archive\.ubuntu\.com\/ubuntu noble\/universe amd64 libavcodec60/);
});

test('a stalled update is told apart from a stalled install', () => {
  const result = run(0, {stall: 'update'});
  assert.match(result.stderr, /try 1: apt-get update cut after 45 s/);
  assert.match(result.stderr, /Hit:1 http:\/\/azure/);
});

test('an apt error is told apart from a cut, and a success says how long it took', () => {
  assert.match(run(1).stderr, /try 1: apt-get install failed \(exit 100\)/);
  assert.match(run(0).stdout, /ffmpeg ready \(try 1, \d+ s\)/);
});
