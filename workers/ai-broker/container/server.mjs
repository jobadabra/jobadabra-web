// Runs inside the broker's container: one `codex exec` per call (shell tool off, empty temp dir), plus the Codex week's rate limit. The login arrives from the Durable Object and goes back with each reply.
// Why (28 Oct 2026, spec ci-on-codex-subscription-design): the container's disk is wiped on sleep, so the login lives in the Durable Object; this server only holds it in CODEX_HOME while it runs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {weeklyWindow} from './weekly.mjs';
import {buildArgs} from '../lib/args.mjs';
import {CLAUDE_TIMEOUT_MS, claudeArgs, claudeInput, readClaude} from './claude.mjs';

const HOME = process.env.CODEX_HOME, AUTH = path.join(HOME, 'auth.json');
const CALL_TIMEOUT_MS = 100000;   // under the callers' own wait, so a hung codex comes back with its last output instead of a dropped request (28 Oct 2026)
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

function run(args, cwd, prompt) {
  return new Promise(resolve => {
    const child = spawn('codex', args, {cwd, stdio: ['pipe', 'pipe', 'pipe'], env: {PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: HOME, ...trustEnv()}});
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), CALL_TIMEOUT_MS);
    child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
    child.on('error', e => { clearTimeout(timer); resolve({code: -1, out, err: `spawn: ${e.message}`}); });
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

// One call: {prompt, schema?, images?: [{name, base64}], search?: boolean, effort?: low|medium|high|xhigh} -> {reply, tokens: {input, output}, ms}. Throws Error with a reason word on a failed codex run.
async function call({prompt, schema, images = [], model, search, effort}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-'));
  try {
    if (schema) fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify(schema));
    const imageNames = images.map((img, i) => {
      const name = `img${i}${path.extname(String(img.name || '.png')).replace(/[^.\w]/g, '')}`;
      fs.writeFileSync(path.join(dir, name), Buffer.from(img.base64, 'base64'));
      return name;
    });
    const args = buildArgs({schema, imageNames, model, search, effort});
    const started = Date.now();
    const {code, out, err} = await run(args, dir, prompt);
    const reply = fs.existsSync(path.join(dir, 'out.txt')) ? fs.readFileSync(path.join(dir, 'out.txt'), 'utf8') : '';
    if (code !== 0 || !reply) throw new Error(/401 Unauthorized|please log in|not logged in|token (is )?(expired|invalid|revoked)|refresh token/i.test(err) ? 'login-lost' : `codex-failed:${code} ${(err || out).replace(/\s+/g, ' ').slice(-900)}`);   // the worker refuses a token-shaped tail (lib/guard.mjs); Why (1 Nov 2026, after the transfer): 300/200 characters showed only Codex's MCP noise, never the line that made it exit 1
    const usage = [...out.matchAll(/"usage":(\{[^}]*\})/g)].map(m => JSON.parse(m[1])).pop() || {};
    return {reply, tokens: {input: usage.input_tokens || 0, output: usage.output_tokens || 0}, ms: Date.now() - started};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
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

http.createServer((req, res) => {
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 30e6) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    const reply = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    try {
      if (req.url === '/auth' && req.method === 'POST') { fs.mkdirSync(HOME, {recursive: true}); fs.writeFileSync(AUTH, Buffer.concat(chunks), {mode: 0o600}); return reply(200, {ok: true}); }
      if (req.url === '/call' && req.method === 'POST') {
        const result = await call(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const limits = await limitsNow();
        return reply(200, {...result, limits, authFile: readAuth()});   // authFile goes to the Durable Object only, never to the caller (worker.js strips it)
      }
      if (req.url === '/claude' && req.method === 'POST') {
        try { return reply(200, await callClaude(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch (e) { return reply(500, {error: String(e.message || e).slice(0, 1000), ...(e.detail || {})}); }   // no authFile: the Codex login stays out of the Claude route
      }
      if (req.url === '/health') return reply(200, {hasLogin: !!readAuth(), limits: readAuth() ? await readLimits() : null});
      return reply(404, {error: 'not found'});
    } catch (e) { return reply(500, {error: String(e.message || e).slice(0, 1000), authFile: readAuth()}); }
  });
}).listen(8080);
