// The REAL Worker (workers/www/index.js) on demo data, served on 127.0.0.1 as the owner, and the browser that opens it: shared by tools/page-shot.mjs
// (one page's styled shots) and tools/admin-no-sideways.mjs (every admin page at phone width). Moved out of page-shot.mjs on 26 Oct 2026 (admin on a phone).
// The data is an in-memory database built from db/migrations/ plus seeds (tools/page-shot-seeds.mjs); the owner login is the test key; the live site is never contacted.
// Guards: test/tooling/page-shot.test.js, test/integration/admin-no-sideways.test.js.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {MAIN_HOST} from '../shared/hosts.js';

export const ORIGIN = 'https://www.jobpilotto.top', KEY = 'page-shot-key';
const TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm'};

function d1(root) {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(path.join(root, 'db/migrations')).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'db/migrations', file), 'utf8'));
  const statement = (sql, bound = []) => ({bind: (...values) => statement(sql, values), run: async () => { const r = db.prepare(sql).run(...bound); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(sql).all(...bound)}), first: async () => db.prepare(sql).get(...bound)});
  return {prepare: sql => statement(sql), batch: async list => { const out = []; for (const item of list) out.push(await item.run()); return out; }};
}

// seeds: names from tools/page-shot-seeds.mjs, or 'all'. Returns {base, env, call, close}.
const ranOn = new WeakMap();   // a database (env) -> the once-seeds already run on it
// The seeds whose second run on one database breaks (a plain INSERT into a unique key). Every other seed stays re-runnable on purpose: schedules,
// testing-overview and synthetic-card upsert one snapshot row that callers such as nightly-trends re-run to reset (Gitar on #577).
export const ONCE = ['random-draws', 'session-checks', 'scouting', 'benchmark-search'];
/**
 * Makes the ONCE seeds run at most once per database, whoever asks for them: the "all" list, or a seed that loads them (job-search-overview).
 * Invariant: a second ask on the same env returns at once; a seed that threw is not marked, so a later ask runs it again; wrapping twice keeps one wrapper.
 * Why (12 Nov 2026, coordinator; web main red since #566): "all" ran random-draws, then job-search-overview ran it again and the second INSERT broke search_lab_draws' unique draw_date, so every admin page check failed.
 */
export function runOnce(seeds, names = ONCE) {
  for (const name of names) {
    const seed = seeds[name];
    if (!seed || seed.once) continue;
    seeds[name] = Object.assign(async context => {
      const done = ranOn.get(context.env) ?? new Set();
      ranOn.set(context.env, done);
      if (done.has(name)) return undefined;
      const result = await seed(context);
      done.add(name);
      return result;
    }, {once: true});
  }
  return seeds;
}

export async function workerServer(root, seedNames = []) {
  const assetsDir = path.join(root, 'web/public');
  const ASSETS = {fetch: request => {   // what Workers static assets do for web/public
    let rel = decodeURIComponent(new URL(request.url).pathname); if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(assetsDir, rel); if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(assetsDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', {status: 404});
    return new Response(fs.readFileSync(file), {headers: {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'}});
  }};
  const kv = new Map();
  const env = {STATS: d1(root), STATS_KEY: 'page-shot-browser-key', STATS_API_KEY: KEY, STATS_SALT: 's', PRO_PLAN: 'test', PROMO_CODE_KEY: 'page-shot-code-key', ASSETS,
    WAITLIST: {get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, list: async () => ({keys: []}), delete: async k => { kv.delete(k); }}};
  const worker = (await import(pathToFileURL(path.join(root, 'workers/www/index.js')))).default;
  const call = (pathname, init = {}, origin = ORIGIN) => worker.fetch(new Request(`${origin}${pathname}`, {...init, headers: {Authorization: `Bearer ${KEY}`, Origin: ORIGIN, 'User-Agent': 'Mozilla/5.0 (Macintosh)', ...init.headers}}), env, {waitUntil: () => {}});
  const {seeds} = await import(pathToFileURL(path.join(root, 'tools/page-shot-seeds.mjs')));
  runOnce(seeds);
  const names = seedNames === 'all' ? Object.keys(seeds) : [seedNames].flat().filter(Boolean);
  for (const name of names) {
    if (!seeds[name]) throw new Error(`unknown seed "${name}" (tools/page-shot-seeds.mjs has: ${Object.keys(seeds).join(', ')})`);
    await seeds[name]({env, call});
  }
  const server = http.createServer(async (req, res) => {   // the browser talks to this; the Worker sees the real origin and the owner login
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(resolve => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); });
    try {
      const init = {method: req.method, body, headers: {'Content-Type': req.headers['content-type'] || 'text/plain'}};
      let response = await call(req.url, init);
      // A public page (/download) is sent from the old host to https://www.jobadabra.top/<page> (shared/hosts.js); serve it here instead of the live site.
      const moved = response.status === 301 && new URL(response.headers.get('location') || '/', ORIGIN);
      if (moved && moved.hostname === MAIN_HOST) response = await call(moved.pathname + moved.search, init, moved.origin);
      res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([k]) => k !== 'content-encoding' && k !== 'set-cookie')));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500, {'Content-Type': 'text/plain'}).end(String(error?.stack || error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {base: `http://127.0.0.1:${server.address().port}`, env, call, close: () => server.close()};
}

/**
 * Runs `work` on every admin page of a walk, a few pages at once. Each page has its own browser context, so no page sees another's state.
 * Why (4 Nov 2026, owner: "I want us to optimize the PR time"): one page at a time made the ⌘K walk 158 s of the 197 s Site tests step, nearly all of it waiting.
 */
export async function eachPage(pages, work) {
  const left = [...pages];
  await Promise.all(Array.from({length: 4}, async () => { while (left.length) await work(left.shift()); }));
}

// playwright-core: PLAYWRIGHT_CORE (a path), else the tree's own e2e kit, else the public checkout's (the overlay has no node_modules). null when none.
// The browser: CHROME, else the Mac's or the CI runner's Google Chrome, else playwright's own download.
export async function launchChromium(root) {
  const homes = [root, process.env.JOBADABRA_PUBLIC, path.join(process.env.HOME || '', 'jobadabra')].filter(Boolean).map(dir => path.join(dir, 'desktop/e2e'));
  let chromium = null;
  for (const from of [process.env.PLAYWRIGHT_CORE && path.dirname(process.env.PLAYWRIGHT_CORE), ...homes].filter(Boolean)) {
    try { ({chromium} = createRequire(path.join(from, 'package.json'))(process.env.PLAYWRIGHT_CORE || 'playwright-core')); break; } catch {}
  }
  if (!chromium) return null;
  const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));
  return chromium.launch(chrome ? {executablePath: chrome} : {});
}
