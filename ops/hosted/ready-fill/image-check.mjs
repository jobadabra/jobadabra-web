// Runs one night in the BUILT container image against a stand-in site (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md), so a night that
// cannot start is caught before merge and before a deploy, in about a minute (18 Oct 2026: every real night failed at setup and nothing showed it).
// Usage: node hosted/ready-fill/image-check.mjs <image tag>   (docker must be running; CI: .github/workflows/ready-fill-image.yml, release-ready-runner.yml)
// Then, in the same container (closed and run again, as the Worker would), a `readiness` night: one job whose page has a form, read by the extension in the image; the page-kind AI call is answered by the stand-in site (cloud runner 2/4: no model, no
// paid call), the read must arrive as a `read` result, nothing may be sent to the form, and no question text may reach the container's log.
// Fictional data only: jobs whose pages the stand-in serves itself, no AI model, no key, no address outside this machine.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const image = process.argv[2] || 'ready-fill:local';
const SITE_PORT = 8799, TLS_PORT = 8798, BOX_PORT = 8780, WAIT_MS = 4 * 60 * 1000, READ_WAIT_MS = 3 * 60 * 1000, name = `ready-check-${process.pid}`;
const seen = [];
let phase = 'fill';   // which night the stand-in site plays: its batch lists that night's job
const QUESTION = 'Why do you want this role?';   // the read's page text: it may reach the site, never the container's log
const FORM_PAGE = `<h1>Apply: SRE at Acme</h1><form method="post"><label>${QUESTION} <input name="why" required></label><button type="submit" onclick="fetch('/pressed')">Submit application</button></form>`;
// Why (9 Nov 2026, cloud runner 2/4, tries 1-2 on "unreadable"): the night's extension copy is allowed on https://*/* only (extension-copy.mjs), and every real job is https; a read page served over http waits for "Allow" and never looks.
// The read's page is therefore served over https with a certificate made for this run, and the container's Chromium is told to accept it (NIGHT_BROWSER_ARGS, set by this check alone).
const job = id => ({id, url: id === 'r1' ? `https://host.docker.internal:${TLS_PORT}/read-job` : `http://host.docker.internal:${SITE_PORT}/job`, title: 'SRE', company: 'Acme', fit: 80, kit: {answers: {}}, letter: 'Dear Acme', cv: '', letterPdf: ''});
const handle = (request, response) => {
  const chunks = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
    const raw = Buffer.concat(chunks), video = (request.headers['content-type'] || '').startsWith('video/');   // Watch the fill: the night's video of the job, bytes not JSON
    seen.push({route: request.url.split('?')[0], method: request.method, body: video ? {bytes: raw.length, head: raw.subarray(0, 4).toString('hex')} : raw.length ? JSON.parse(raw.toString()) : null});
    if (request.url.startsWith('/job')) { response.writeHead(200, {'content-type': 'text/html'}); return response.end('<h1>SRE at Acme</h1><p>A posting with no form.</p>'); }
    if (request.url.startsWith('/read-job')) { response.writeHead(200, {'content-type': 'text/html'}); return response.end(FORM_PAGE); }
    response.writeHead(200, {'content-type': 'application/json'});
    // Like the site (src/ready.js): only the forms still waiting, so a form with its result is not read again (the night's line, src/ready-line.js).
    const id = phase === 'fill' ? 'j1' : 'r1', told = seen.some(each => each.route === '/api/ready/result' && each.body?.job === id);
    if (request.url.startsWith('/api/ready/batch')) return response.end(JSON.stringify({ok: true, line: true, task: phase === 'fill' ? 'fill' : 'readiness', night: '2026-10-18', contact: phase === 'fill' ? {name: 'Alex Example', email: 'alex@example.invalid'} : {},
      jobs: told ? [] : [job(id)], facts: {}}));
    if (request.url.startsWith('/api/ready/ai')) return response.end(JSON.stringify({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 10}, content: [{type: 'text', text: JSON.stringify({kind: 'form', confidence: 0.95})}]}));   // the page-kind call of the read, answered here: no model
    response.end(JSON.stringify({ok: true}));
  });
};
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-check-tls-')), keyFile = path.join(certDir, 'key.pem'), certFile = path.join(certDir, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=host.docker.internal', '-addext', 'subjectAltName=DNS:host.docker.internal'], {stdio: 'ignore'});
const site = http.createServer(handle), pages = https.createServer({key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile)}, handle);
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'}).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = '';
// The readiness night of the cloud runner, in the container the fill night just used (closed, then started again with task "readiness"). -> '' when it passed, else why not.
async function readinessNight() {
  const base = `http://127.0.0.1:${BOX_PORT}`, body = task => JSON.stringify({site: `http://host.docker.internal:${SITE_PORT}`, token: 'check', task});
  if (!(await fetch(`${base}/close?t=check`, {method: 'POST'})).ok) return 'the fill night would not close';
  // Why (12 Nov 2026, coordinator): "auto" became a task with cs 3/4 (jobadabra #3683, 10 Nov; the spec's safety lines the owner approved 8 Nov), so asking for it here started a real auto night
  //   and red every deploy since; the check keeps what it guards: /run refuses a task the runner does not know (desktop/ready-fill/night.mjs TASKS) before any browser starts.
  const refused = await fetch(`${base}/run`, {method: 'POST', body: body('no-such-task')});
  if (refused.status !== 400) return `/run with an unknown task answered ${refused.status}, not 400`;
  phase = 'readiness';
  const cut = seen.length;   // what the site heard from here on is the readiness night's
  const run = await fetch(`${base}/run`, {method: 'POST', body: body('readiness')});
  if (run.status !== 202) return `/run with the task "readiness" answered ${run.status}`;
  let state = {state: 'running'};
  for (const end = Date.now() + READ_WAIT_MS; state.state === 'running' && Date.now() < end; await pause(2000)) state = await (await fetch(`${base}/state?t=check`)).json();
  const reads = seen.filter(s => s.route === '/api/ready/result' && s.body?.job === 'r1').map(s => s.body);
  const heard = seen.slice(cut).map(s => `${s.method} ${s.route}${s.body?.step ? `:${s.body.step}` : ''}`);   // routes and step words only: what the stand-in site heard during the read
  console.log(JSON.stringify({readiness: state.state, error: state.error || '', results: reads.map(r => `${r.job}:${r.task}:${r.state}${r.why ? `:${r.why}` : ''}`), heard}));
  if (state.state !== 'held') return `the readiness night ended "${state.state}"${state.error ? `: ${state.error}` : ''}`;
  if (reads.length !== 1) return `expected 1 read posted, got ${reads.length}`;
  if (reads[0].task !== 'readiness' || reads[0].state !== 'read' || !reads[0].read || typeof reads[0].read !== 'object') return `the read arrived as ${reads[0].task}:${reads[0].state}${reads[0].why ? `:${reads[0].why}` : ''}, not a readiness "read" with its flags`;
  if (seen.some(s => s.route === '/pressed' || (s.route === '/read-job' && s.method !== 'GET'))) return 'the read pressed Submit or sent the form: a read never fills or presses Submit';   // the button reports any click to /pressed (the empty required field would stop a post by itself)
  if (seen.slice(cut).some(s => ['/api/ready/video', '/api/ready/handoff'].includes(s.route))) return 'the read posted a video or hand-off: a read holds nothing';
  const logged = spawnSync('docker', ['logs', name], {encoding: 'utf8'});   // stdout and stderr: night-ai logs on stderr
  if (`${logged.stdout}${logged.stderr}`.includes(QUESTION)) return "the form's question text is in the container's log: a read goes to the site only";
  return '';
}
await new Promise(resolve => site.listen(SITE_PORT, '0.0.0.0', resolve));
await new Promise(resolve => pages.listen(TLS_PORT, '0.0.0.0', resolve));
try {
  docker('run', '-d', '--name', name, '--add-host=host.docker.internal:host-gateway', '-e', 'NIGHT_BROWSER_ARGS=--ignore-certificate-errors', '-p', `${BOX_PORT}:8080`, image);
  let up = false;
  for (const end = Date.now() + 60000; !up && Date.now() < end; await pause(500)) up = await fetch(`http://127.0.0.1:${BOX_PORT}/health`).then(r => r.ok, () => false);
  if (!up) throw new Error('the container did not answer /health within 60 s');
  for (const route of ['state', 'handoff']) {   // a fresh container holds no night: "gone", so the runner stops it and the app says to press Fill now (not "not on for this install")
    const answer = await fetch(`http://127.0.0.1:${BOX_PORT}/${route}?t=&job=j1`);
    if (answer.status !== 410) throw new Error(`a fresh container answered /${route} with ${answer.status}, not 410 gone`);
  }
  const run = await fetch(`http://127.0.0.1:${BOX_PORT}/run`, {method: 'POST', body: JSON.stringify({site: `http://host.docker.internal:${SITE_PORT}`, token: 'check'})});
  if (run.status !== 202) throw new Error(`/run answered ${run.status}`);
  let state = {state: 'running'};
  for (const end = Date.now() + WAIT_MS; state.state === 'running' && Date.now() < end; await pause(2000)) state = await (await fetch(`http://127.0.0.1:${BOX_PORT}/state?t=check`)).json();
  const results = seen.filter(s => s.route === '/api/ready/result').map(s => s.body);
  const videos = seen.filter(s => s.route === '/api/ready/video').map(s => s.body);
  console.log(JSON.stringify({night: state.state, error: state.error || '', jobs: state.jobs, results: results.map(r => `${r.job}:${r.state}`), videos}));
  if (state.state !== 'held') failed = `the night ended "${state.state}"${state.error ? `: ${state.error}` : ''}`;
  else if (results.length !== 1) failed = `expected 1 result posted, got ${results.length}`;
  else if (results[0].wall === 'error') failed = 'the job threw instead of being tried';
  else if (videos.length !== 1 || videos[0].head !== '1a45dfa3') failed = `expected 1 WebM video of the fill posted, got ${JSON.stringify(videos)} (Watch the fill: is Playwright's ffmpeg in the image?)`;   // 1a45dfa3: the WebM/Matroska header
  if (!failed) failed = await readinessNight();
  if (!failed) {   // Why (5 Nov 2026, hr): the real PID 1 gets Cloudflare's stop (SIGTERM). Exit code 0 in a few seconds = it handled it; 137 after the 30 s = it was killed because it ignored it (stop.mjs).
    const began = Date.now();
    docker('stop', '-t', '30', name);
    const code = docker('inspect', '-f', '{{.State.ExitCode}}', name), took = Math.round((Date.now() - began) / 1000);
    if (code !== '0' || took > 15) failed = `docker stop took ${took} s and the container exited ${code}: it must exit 0 within 15 s of SIGTERM (stop.mjs)`;
  }
} catch (error) { failed = error.message; }
finally {
  try { console.log(docker('logs', '--tail', '20', name)); } catch { /* no container */ }
  try { docker('rm', '-f', name); } catch { /* already gone */ }
  site.close(); pages.close(); fs.rmSync(certDir, {recursive: true, force: true});
}
if (failed) { console.error(`image check FAILED: ${failed}`); process.exit(1); }
console.log('image check OK: a fresh container says gone; the night read its batch, tried the job, posted its result and its video; a readiness night read a form and sent its read to the site alone; docker stop ended it with exit 0');
