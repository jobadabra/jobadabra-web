// Free AI for the random draw (owner, 26 Oct 2026: "use claude in chrome. Same account if possible, just different workspace/token/worker"): the site's own
// Free AI handler (shared/free-ai.js: the same models, translation, per-install caps and board web search lane as /api/ai) served on the runner, so a draw on
// engine "free" meets what a Free AI user meets, without touching production's counters, alerts or Worker. Its bindings:
//   - env.AI: Workers AI over REST on the caller's own token: FREE_AI_LOCAL_CF_ACCOUNT_ID + FREE_AI_LOCAL_CF_AI_TOKEN (any CI job, e.g. the public e2e on
//     CI_FREE_AI_CF_TOKEN), else the draws' RANDOM_DRAWS_CF_ACCOUNT_ID + RANDOM_DRAWS_CF_AI_TOKEN. Workers AI only, never the site's;
//   - the web search lane: off unless FREE_AI_LOCAL_WEB_ANTHROPIC_KEY is given (owner, 26 Oct 2026: "I don't want to top up anymore"), never WEB_SEARCH_ANTHROPIC_KEY;
//   - KV and D1 in memory (this run only), the caps from workers/www/wrangler.toml [vars] (production's), no Telegram (no alert reaches the owner);
//   - one throwaway install whose JPF1 key is signed with a salt made for this run.
// GET /__report: {usd, calls, refused: {status: n}, by_action: {action: usd}} from the run's own ai_calls rows (the site's cost meter).
//   node jobs/persona-search/free-ai-local.mjs <port> <key file> [--install-prefix ci-e2e-]     (prints "free-ai-local: listening on <port>"; prefix default ci-draw-)
// Guard: test/unit/jobs/free-ai-local.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {freeAi} from '../../shared/free-ai.js';
import {tokenFor} from '../../shared/guard.js';
import {pathToFileURL} from 'node:url';

const HERE = new URL('../../', import.meta.url);

// workers/www/wrangler.toml's top [vars]: production's Free AI lines and switches, so the draw has the user's caps.
export function vars(text = fs.readFileSync(new URL('workers/www/wrangler.toml', HERE), 'utf8')) {
  const out = {};
  let inVars = false;
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) { inVars = /^\s*\[vars\]\s*$/.test(line); continue; }
    const match = inVars && line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

// D1 in memory, every migration applied (the shape test/unit/admin/*.test.js use).
export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(new URL('db/migrations/', HERE)).filter(name => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(`db/migrations/${file}`, HERE), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {prepare: sql => statement(sql), db};
}

export function memoryKv() {
  const map = new Map();
  return {get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, String(value)); }, delete: async key => { map.delete(key); }};
}

// env.AI over REST: run() returns the result as the binding does and throws its error text (shared/free-ai.js reads "4006 / daily free allocation").
export function restAi(account, token, fetcher = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/ai`, auth = {authorization: `Bearer ${token}`};
  const answer = async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error((body.errors || []).map(e => `${e.code || ''} ${e.message || ''}`.trim()).join('; ') || `Workers AI ${response.status}`);
    return body.result;
  };
  return {
    run: async (model, input) => answer(await fetcher(`${base}/run/${model}`, {method: 'POST', headers: {...auth, 'content-type': 'application/json'}, body: JSON.stringify(input)})),
    toMarkdown: async files => {
      const form = new FormData();
      for (const file of files) form.append('files', file.blob, file.name);
      return answer(await fetcher(`${base}/tomarkdown`, {method: 'POST', headers: auth, body: form}));
    },
  };
}

// The handler's env and the install's JPF1 key. `source`: process.env (the three draw secrets).
// The Workers AI account and token: the generic names first (any CI job), then the draws' own.
export function cloudflare(source = process.env) {
  const account = source.FREE_AI_LOCAL_CF_ACCOUNT_ID || source.RANDOM_DRAWS_CF_ACCOUNT_ID, token = source.FREE_AI_LOCAL_CF_AI_TOKEN || source.RANDOM_DRAWS_CF_AI_TOKEN;
  if (!account || !token) throw new Error('free-ai-local: FREE_AI_LOCAL_CF_ACCOUNT_ID + FREE_AI_LOCAL_CF_AI_TOKEN (or RANDOM_DRAWS_CF_ACCOUNT_ID + RANDOM_DRAWS_CF_AI_TOKEN) are needed');
  return {account, token};
}

export async function setup(source = process.env, fetcher = fetch, {installPrefix = 'ci-draw-'} = {}) {
  if (!/^[\w-]{1,40}$/.test(installPrefix)) throw new Error(`free-ai-local: install prefix "${installPrefix}" must be letters, digits, _ or - (at most 40)`);
  const {account, token} = cloudflare(source);
  const env = {...vars(), AI: restAi(account, token, fetcher), WAITLIST: memoryKv(), STATS: memoryD1(),
    STATS_SALT: crypto.randomBytes(24).toString('hex'), WEB_SEARCH_ANTHROPIC_KEY: source.FREE_AI_LOCAL_WEB_ANTHROPIC_KEY || ''};
  if (!env.WEB_SEARCH_ANTHROPIC_KEY) env.FREE_AI_WEB_SEARCH = 'off';
  const install = `${installPrefix}${crypto.randomBytes(6).toString('hex')}`;
  return {env, key: `JPF1.${install}.${await tokenFor(install, env, 'ai')}`};
}

export function report(env, refused) {
  const rows = env.STATS.db.prepare('SELECT action, SUM(calls) AS calls, SUM(micro_usd) AS micro FROM ai_calls GROUP BY action').all();
  const usd = rows.reduce((sum, row) => sum + (row.micro || 0), 0) / 1e6;
  return {usd: Math.round(usd * 1e4) / 1e4, calls: rows.reduce((sum, row) => sum + (row.calls || 0), 0), refused,
    by_action: Object.fromEntries(rows.map(row => [row.action, Math.round((row.micro || 0) / 100) / 1e4]))};
}

// The server: Node's request -> a fetch Request -> freeAi -> Node's response. Refusals (4xx/5xx) are counted by status.
export function serve(env, fetcher = fetch) {
  const refused = {};
  return http.createServer(async (req, res) => {
    if (req.url === '/__report') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(report(env, refused))); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(Object.entries(req.headers).flatMap(([name, value]) => (Array.isArray(value) ? value.map(v => [name, v]) : [[name, value]])));
    const request = new Request(`http://localhost${req.url}`, {method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)});
    let response;
    try { response = await freeAi(request, env, new Date(), null, fetcher); } catch (error) { response = Response.json({type: 'error', error: {type: 'api_error', message: String(error.message)}}, {status: 500}); }
    if (response.status >= 400) refused[response.status] = (refused[response.status] || 0) + 1;
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  });
}

async function main() {
  const [port, keyFile] = process.argv.slice(2), at = process.argv.indexOf('--install-prefix');
  if (!port || !keyFile || port.startsWith('--')) { console.error('usage: node jobs/persona-search/free-ai-local.mjs <port> <key file> [--install-prefix ci-e2e-]'); process.exit(2); }
  const {env, key} = await setup(process.env, fetch, at > 0 ? {installPrefix: process.argv[at + 1]} : {});
  fs.writeFileSync(keyFile, key, {mode: 0o600});
  serve(env).listen(Number(port), '127.0.0.1', () => console.log(`free-ai-local: listening on ${port}`));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
