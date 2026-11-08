// Runs inside the broker's container: one `codex exec` per call (shell tool off, empty temp dir), plus the Codex week's rate limit. The login arrives from the Durable Object and goes back with each reply.
// Why (28 Oct 2026, spec ci-on-codex-subscription-design): the container's disk is wiped on sleep, so the login lives in the Durable Object; this server only holds it in CODEX_HOME while it runs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {weeklyWindow} from './weekly.mjs';
import {buildArgs} from '../lib/args.mjs';
import {readTurn, threadTable, turnUsage} from './threads.mjs';
import {CLAUDE_TIMEOUT_MS, claudeArgs, claudeInput, readClaude} from './claude.mjs';
import {kindOf} from './kinds.mjs';

const HOME = process.env.CODEX_HOME, AUTH = path.join(HOME, 'auth.json');
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS) || 100000;   // under the callers' own wait, so a hung codex comes back with its last output instead of a dropped request (28 Oct 2026)
fs.mkdirSync(HOME, {recursive: true});   // codex exits 1 ("Error finding codex home") when this folder is missing, e.g. a call before the login arrives (found locally, 28 Oct 2026)
const readAuth =() => (fs.existsSync(AUTH) ? fs.readFileSync(AUTH, 'utf8') : '');

// HTTPS goes through Cloudflare's egress interception, so codex must trust its CA (written at container start): system roots + that CA in one bundle. Only the CA file's presence decides; locally there is none.
const CF_CA = '/etc/cloudflare/certs/cloudflare-containers-ca.crt', BUNDLE = path.join(os.tmpdir(), 'ca-bundle.crt');
let trust = null;   // built once per process: 4 calls overlap, and a bundle rewritten in place could be read half-written (Gitar on #222)
function trustEnv() {
  if (trust) return trust;
  if (!fs.existsSync(CF_CA)) return {};
  const system = ['/etc/ssl/certs/ca-certificates.crt'].find(f => fs.existsSync(f));
  const tmp = `${BUNDLE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${system ? fs.readFileSync(system, 'utf8') : ''}\n${fs.readFileSync(CF_CA, 'utf8')}`);
  fs.renameSync(tmp, BUNDLE);   // atomic: a reader sees the old or the whole new file, never a part
  return (trust = {SSL_CERT_FILE: BUNDLE, CODEX_CA_CERTIFICATE: CF_CA});
}

// Why (5 Nov 2026, a8; runs 42057090129 and 42058621304: the 5th call of a conversation got no answer in 180 s while this guard is 100 s; worker log: the container leg lasted 179,975 ms): `close` waits for every process that still holds codex's stdout and stderr, so killing codex alone left the call waiting for a helper it had started, and the guard never answered. The guard now kills codex's whole process group and answers by itself after KILL_GRACE_MS even if a pipe is still held; its error says it was the guard and what codex had printed, so the next stall explains itself.
const KILL_GRACE_MS = Number(process.env.KILL_GRACE_MS) || 2000;
function killTree(child) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }   // -pid = the group (codex is its leader: detached); a helper that left the group is covered by the grace answer

// Why (5 Nov 2026, a8; ag run 42064112764: calls 6 and its restart stalled, and the 900-character tail was only the "stale rollout path" stderr line): a killed call says what codex had printed, so the next stall shows whether it reached `turn.started` or the model's first item.
function lastEvents(out) {
  const types = out.split('\n').flatMap(line => { try { const m = JSON.parse(line); return m && typeof m.type === 'string' ? [m.type] : []; } catch { return []; } });
  return types.length ? `[codex events: ${types.length}, last: ${types.slice(-4).join(' > ')}]` : '[codex events: none]';
}

// Why (5 Nov 2026, a8, owner via mac-32: "record ONE timeline with timestamps on all 3 hops"; 4 tries and 3 signatures of "a persona Codex call dies around step 5-6"): the container's own log is not readable, so each call carries its own clock home: "<ms since spawn> <event>" for codex's first stderr byte, each stdout event and its end. Logging only; nothing decides on it.
const traceOf = stamps => stamps.map(([ms, what]) => `${ms} ${what}`).join('|');

function run(args, cwd, prompt) {
  return new Promise(resolve => {
    const child = spawn('codex', args, {cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: HOME, ...trustEnv()}});
    let out = '', err = '', answered = false, grace = null, killed = false;
    const t0 = Date.now(), stamps = [[0, 'spawn']], stamp = (label, last = false) => { if (last || stamps.length < 39) stamps.push([Date.now() - t0, /^[\w.:-]{1,40}$/.test(label) ? label : 'event']); };   // 39 + the end stamp; a label is a short name, never free text
    let pending = '';
    const guard = () => `[killed after ${CALL_TIMEOUT_MS / 1000} s: codex did not finish]`;
    const answer = result => { if (answered) return; answered = true; flush(); stamp(result.guard ? 'guard' : `exit:${result.code}`, true); clearTimeout(timer); clearTimeout(grace); resolve({...result, trace: traceOf(stamps)}); };
    const note = line => { try { const m = JSON.parse(line); if (typeof m?.type === 'string') stamp(m.type); } catch { /* not an event line */ } };
    const flush = () => { if (pending) note(pending); pending = ''; };   // a last event with no newline
    child.stdout.on('data', d => { out += d; pending += d; if (pending.length > 1e6) pending = ''; const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(note); });   // a runaway stream with no newline is dropped at 1 MB, not re-split for ever
    child.stderr.on('data', d => { if (!err) stamp('stderr'); err += d; });
    const timer = setTimeout(() => {
      killed = true; killTree(child);
      grace = setTimeout(() => answer({code: null, out, err, guard: guard()}), KILL_GRACE_MS);
    }, CALL_TIMEOUT_MS);
    child.on('close', code => answer({code, out, err, ...(killed ? {guard: guard()} : {})}));
    child.on('error', e => answer({code: -1, out, err: `spawn: ${e.message}`}));
    child.stdin.on('error', () => {});   // an early CLI exit can close the pipe before the whole prompt is written
    child.stdin.end(String(prompt));   // EOF is required: Codex waits for the complete prompt before starting
  });
}

// The Codex week figure, read the way PR 0 did: the app-server's account/rateLimits/read. -> {usedPercent, resetsAt} or null.
function readLimits() {
  return new Promise(resolve => {
    const child = spawn('codex', ['app-server'], {stdio: ['pipe', 'pipe', 'ignore'], env: {PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: HOME, ...trustEnv()}});
    const done = v => { clearTimeout(timer); child.kill(); resolve(v); };
    const timer = setTimeout(() => done(null), 20000);
    const send = m => child.stdin.write(`${JSON.stringify(m)}\n`);
    let buf = '';
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({method: 'initialized'}); send({id: 2, method: 'account/rateLimits/read'}); }
        if (m.id === 2) done(weeklyWindow(m.result?.rateLimits));
      }
    });
    send({id: 1, method: 'initialize', params: {clientInfo: {name: 'ai-broker', title: 'ai-broker', version: '1'}}});
  });
}

// Why (1 Nov 2026, pg via mac-07: "about 5 s of the 13-17 s per call"; 0.9-1.6 s on tiny calls): every call spawned a `codex app-server` after its reply just to read the week figure, which moves by fractions of a percent a minute.
// The last reading is served, and one background refresh starts when it is older than LIMITS_TTL_MS. Only the first reading after a start (or after a failed one) is waited for, so the week brake never runs without a figure.
const LIMITS_TTL_MS = Number(process.env.LIMITS_TTL_MS ?? 60000);
let limitsCache = null, limitsRefresh = null;   // {at, value}, and the refresh in flight
async function limitsNow() {
  const stale = !limitsCache?.value || Date.now() - limitsCache.at >= LIMITS_TTL_MS;
  // Why (Gitar on #290): calls that overlap a start share ONE in-flight read, and a failed read never replaces a good figure.
  if (stale && !limitsRefresh) limitsRefresh = readLimits().then(value => { if (value) limitsCache = {at: Date.now(), value}; }).catch(() => {}).finally(() => { limitsRefresh = null; });
  if (!limitsCache?.value) await limitsRefresh;
  return limitsCache?.value ?? null;
}

// Conversations kept for the AI user agent (spec 2026-11-05-broker-codex-resume-design.md): the table is in memory, so a sleep or a redeploy empties it and the next call starts a conversation again from the full prompt.
const threads = threadTable();
const forget = entry => {
  if (!entry) return;
  fs.rmSync(entry.dir, {recursive: true, force: true});
  if (!entry.thread) return;   // Codex named none: nothing to look for (and never a file called null.jsonl)
  const root = path.join(HOME, 'sessions');
  try { for (const file of fs.readdirSync(root, {recursive: true})) if (String(file).endsWith(`${entry.thread}.jsonl`)) fs.rmSync(path.join(root, String(file)), {force: true}); } catch { /* no sessions folder: nothing to delete */ }
};
setInterval(() => threads.sweep().forEach(forget), 60000).unref();

// One call: {prompt, schema?, images?: [{name, base64}], search?: boolean, effort?: low|medium|high|xhigh, session?: {key, expect: 'none'|'warm', delta?, restart?, end?}} -> {reply, tokens: {input, cached, output}, ms, session?: {mode, reason?}}. Throws Error with a reason word on a failed codex run.
// With a session the call keeps its conversation on disk: `warm` + a live conversation + a delta resumes it (only the new turn is sent), anything else starts one from the full prompt. The Worker decides; this only does and reports.
// Tokens are always THIS call's: on a resumed conversation Codex reports the running total, so the turn is the difference from the total after the turn before (lib: threads.mjs turnUsage).
async function call({prompt, schema, images = [], model, search, effort, session}) {
  const key = session?.key, held = key ? threads.get(key) : undefined;
  const resumable = Boolean(held && session.expect === 'warm' && !session.restart && held.model === model && typeof session.delta === 'string' && session.delta);
  const reason = !key || resumable ? undefined : session.restart || (session.expect === 'warm' ? (held ? (held.model !== model ? 'tier' : 'no-delta') : 'lost') : undefined);
  if (held && !resumable) forget(threads.drop(key));   // a conversation that is not continued is deleted before its replacement opens
  const dir = resumable ? held.dir : fs.mkdtempSync(path.join(os.tmpdir(), key ? 'thread-' : 'call-'));
  let retained = false, opened = null;
  if (resumable) held.busy = true;   // Why ([bf] review): a sweep or an eviction never deletes a conversation that is in the middle of a turn
  try {
    if (schema) fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema));
    fs.rmSync(path.join(dir, 'out.txt'), {force: true});   // a turn that fails must not read the turn before it
    const imageNames = images.map((img, i) => {
      const name = `img${i}${path.extname(String(img.name || '.png')).replace(/[^.\w]/g, '')}`;
      fs.writeFileSync(path.join(dir, name), Buffer.from(img.base64, 'base64'));
      return name;
    });
    const args = buildArgs({schema, imageNames, model, search, effort, keep: Boolean(key), resume: resumable ? held.thread : undefined});
    const started = Date.now();
    const {code, out, err, guard, trace} = await run(args, dir, resumable ? session.delta : prompt);
    const reply = fs.existsSync(path.join(dir, 'out.txt')) ? fs.readFileSync(path.join(dir, 'out.txt'), 'utf8') : '';
    if (code !== 0 || !reply) {
      opened = readTurn(out).thread;
      throw Object.assign(new Error(/401 Unauthorized|please log in|not logged in|token (is )?(expired|invalid|revoked)|refresh token/i.test(err) ? 'login-lost' : `codex-failed:${code} ${guard ? `${guard} ${lastEvents(out)} ` : ''}${(err || out).replace(/\s+/g, ' ').slice(-900)}`), {trace});   // the worker refuses a token-shaped tail (lib/guard.mjs); Why (1 Nov 2026, after the transfer): 300/200 characters showed only Codex's MCP noise, never the line that made it exit 1
    }
    const {thread, usage: total} = readTurn(out), turn = turnUsage(total, resumable ? held.total : null);
    let mode;
    if (key) {
      mode = session.end ? 'ended' : resumable ? 'resumed' : reason ? 'restarted' : 'opened';
      if (session.end || (!thread && !resumable)) forget(resumable ? threads.drop(key) : {dir, thread});   // the caller said it was the last turn, or Codex named no thread to continue
      else if (resumable) { threads.touch(key, {total: total || held.total}); retained = true; }
      else { threads.set(key, {thread, dir, model, total}).forEach(forget); retained = true; }
    }
    return {reply, tokens: {input: turn.input, cached: turn.cached, output: turn.output}, ms: Date.now() - started, trace, ...(key ? {session: {mode, ...(reason ? {reason} : {})}} : {})};
  } catch (error) {
    // Why ([bf] review, 5 Nov 2026): whatever stopped a turn (Codex failed, a file could not be written), the conversation is not trusted again: it is deleted here, and the Worker restarts it from the full prompt (it marks the record as having a gap).
    if (resumable) forget(threads.drop(key)); else if (key) forget({dir, thread: opened});
    throw error;
  } finally { if (held) held.busy = false; if (!retained) fs.rmSync(dir, {recursive: true, force: true}); }
}

// One Claude call on the owner's subscription (spec section 3): {prompt, schema?, images?, model} -> {reply, tokens, ms, limits}. The CLI reads CLAUDE_CODE_OAUTH_TOKEN from here only; its state lives in a temp folder, never in the Codex home.
// Why (1 Nov 2026): an explicit environment, no tools, no settings, an empty working folder and a kill timer, the same shape as the Codex call; images travel as base64 blocks so the CLI needs no file tool.
let claudeHome = null;   // created on the first Claude call
const claudeHomeDir = () => (claudeHome ||= fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-')));
async function callClaude({prompt, schema, images = [], model, search = false}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-call-'));
  try {
    const input = claudeInput({prompt, images}), started = Date.now();
    const env = {PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: claudeHomeDir(), CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...trustEnv(), ...(fs.existsSync(CF_CA) ? {NODE_EXTRA_CA_CERTS: CF_CA} : {})};
    const {code, out, err, timedOut} = await new Promise(resolve => {
      const child = spawn('claude', claudeArgs({model, schema, search: search === true}), {cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env});
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, CLAUDE_TIMEOUT_MS);
      child.on('close', code => { clearTimeout(timer); resolve({code, out, err, timedOut}); });
      child.on('error', e => { clearTimeout(timer); resolve({code: -1, out, err: `spawn: ${e.message}`}); });   // Why (1 Nov 2026): an unhandled spawn 'error' would take the whole container server down (Codex calls too); now it is a plain failure with its text
      child.stdin.on('error', () => {}); child.stdin.end(input);
    });
    const result = readClaude(out, err, code, timedOut);
    if (result.error) { const failure = new Error(result.error); failure.detail = {resetsAt: result.resetsAt ?? null, limits: result.limits ?? null}; throw failure; }
    return {reply: result.reply, tokens: result.tokens, ms: Date.now() - started, limits: result.limits};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

// Why (8 Nov 2026, bd; web#493, #494, #498 each lost the calls they met): a deploy replaces this container. Cloudflare sends SIGTERM to this process and waits up to 15 minutes before SIGKILL (docs: Containers > Rollouts), but a Node process that is PID 1 and has no SIGTERM handler ignores it (the lesson of ops/hosted/ready-fill/stop.mjs), so the old container kept taking calls until it was torn down under them.
// Intended: serving -> (SIGTERM) draining: a new /call or /claude is refused at once with `x-broker-draining` (nothing of it started, so the Worker may send it again to the next container); every request already open (a call, a body still arriving, /health, /auth) is finished; the moment the last one has closed, exit 0. A call is only ever cut by the 15-minute SIGKILL (calls are guarded at 100 s and 150 s).
// Open = from the request's arrival to its response's `close`, which also fires when the client went away: a dropped call must not hold the exit until the SIGKILL.
let draining = false, open = 0;
const exitWhenIdle = () => { if (draining && open === 0) process.exit(0); };
process.on('SIGTERM', () => { draining = true; exitWhenIdle(); });
const isCall = url => url === '/call' || url === '/claude';

http.createServer((req, res) => {
  open++; res.once('close', () => { open--; exitWhenIdle(); });
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 30e6) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    const reply = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (draining && isCall(req.url)) { res.setHeader('x-broker-draining', '1'); return reply(503, {error: 'draining'}); }
    try {
      if (req.url === '/auth' && req.method === 'POST') { fs.mkdirSync(HOME, {recursive: true}); fs.writeFileSync(AUTH, Buffer.concat(chunks), {mode: 0o600}); return reply(200, {ok: true}); }
      if (req.url === '/call' && req.method === 'POST') {
        const result = await call(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const limits = await limitsNow();
        return reply(200, {...result, limits, authFile: readAuth()});   // authFile goes to the Durable Object only, never to the caller (worker.js strips it)
      }
      if (req.url === '/claude' && req.method === 'POST') {
        try { return reply(200, await callClaude(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch (e) { return reply(500, {error: String(e.message || e).slice(0, 1000), kind: kindOf(e.message), ...(e.detail || {})}); }   // no authFile: the Codex login stays out of the Claude route
      }
      if (req.url === '/health') return reply(200, {hasLogin: !!readAuth(), limits: readAuth() ? await readLimits() : null});
      return reply(404, {error: 'not found'});
    } catch (e) { return reply(500, {error: String(e.message || e).slice(0, 1000), kind: kindOf(e.message), authFile: readAuth(), ...(e.trace ? {trace: e.trace} : {})}); }
  });
}).listen(Number(process.env.BROKER_TEST_PORT) || 8080);   // the env var is only for the real-process drain test (test/unit/workers/ai-broker/drain.test.js); the Worker's defaultPort is 8080, and a platform variable called PORT must not move it
