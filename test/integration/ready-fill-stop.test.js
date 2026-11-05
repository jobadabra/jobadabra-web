// The Ready to send container exits when Cloudflare says stop (hr, 5 Nov 2026: as PID 1 a Node process without a SIGTERM handler ignores the signal, as the Always on engine did in
// staging try 6). The logic is in hosted/ready-fill/stop.mjs so this test loads it without Playwright; the real PID 1 is proved by hosted/ready-fill/image-check.mjs (CI, after the merge).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const {onStop} = await import(new URL('../../hosted/ready-fill/stop.mjs', import.meta.url));

function setup(closeNight) {
  const proc = new EventEmitter(), calls = [], alive = setInterval(() => {}, 1000);   // the real process has live handles; the grace timer is unref'd, so the test keeps the loop alive itself
  proc.exit = code => { calls.push(`exit ${code}`); clearInterval(alive); proc.emit('exited'); };
  const server = {close: () => calls.push('server.close'), closeAllConnections: () => calls.push('server.closeAllConnections')};
  onStop(proc, server, async () => { calls.push('closeNight'); await closeNight?.(); }, {graceMs: 80});
  return {proc, calls, exited: new Promise(done => proc.once('exited', done))};
}

test('a stop signal stops taking calls, closes the night, then exits 0', async () => {
  const {proc, calls, exited} = setup();
  proc.emit('SIGTERM');
  await exited;
  assert.deepEqual(calls, ['server.close', 'server.closeAllConnections', 'closeNight', 'exit 0']);
});

test('a second stop signal does not close the night twice', async () => {
  const {proc, calls, exited} = setup();
  proc.emit('SIGTERM'); proc.emit('SIGTERM');
  await exited;
  assert.equal(calls.filter(call => call === 'closeNight').length, 1);
});

test('a night that will not close, or throws, does not keep the container alive', async () => {
  const hanging = setup(() => new Promise(() => {}));
  hanging.proc.emit('SIGTERM');
  await hanging.exited;
  assert.ok(hanging.calls.includes('exit 0'), 'the grace period ends it');
  const throwing = setup(() => { throw new Error('browser already gone'); });
  throwing.proc.emit('SIGTERM');
  await throwing.exited;
  assert.ok(throwing.calls.includes('exit 0'));
});

test('a real Node process with a server and an open connection exits 0 on SIGTERM, where one without the handler is killed', async () => {
  const stop = new URL('../../hosted/ready-fill/stop.mjs', import.meta.url).href;
  const run = async withHandler => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import http from 'node:http';
      const {onStop} = await import(${JSON.stringify(stop)});
      const server = http.createServer((request, response) => { response.writeHead(200, {connection: 'keep-alive'}); response.end('ok'); });
      ${withHandler ? `onStop(process, server, async () => console.log('night closed'));` : ''}
      server.listen(0, '127.0.0.1', () => console.log('port ' + server.address().port));`], {stdio: ['ignore', 'pipe', 'inherit']});
    let out = '';
    const port = await new Promise(found => child.stdout.on('data', data => { out += data; const m = out.match(/port (\d+)/); if (m) found(Number(m[1])); }));
    const agent = new http.Agent({keepAlive: true});
    await new Promise(done => http.get({host: '127.0.0.1', port, agent}, response => { response.resume(); response.on('end', done); }));   // an open keep-alive connection, as a morning call leaves
    child.kill('SIGTERM');
    const [code, signal] = await new Promise(done => child.on('exit', (...end) => done(end)));
    agent.destroy();
    return {code, signal, out};
  };
  assert.deepEqual(await run(false).then(({code, signal}) => ({code, signal})), {code: null, signal: 'SIGTERM'});   // positive control: without it, only the default action ends it (PID 1 never gets that)
  const handled = await run(true);
  assert.deepEqual({code: handled.code, signal: handled.signal}, {code: 0, signal: null});
  assert.match(handled.out, /night closed/);
});

test('main.mjs wires it, and the image check stops the real container', () => {
  assert.match(readFileSync(new URL('../../hosted/ready-fill/main.mjs', import.meta.url), 'utf8'), /onStop\(process, server, /);
  assert.match(readFileSync(new URL('../../hosted/ready-fill/image-check.mjs', import.meta.url), 'utf8'), /docker\('stop'/);
});
