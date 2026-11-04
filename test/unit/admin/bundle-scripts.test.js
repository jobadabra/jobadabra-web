// The admin pages' inline scripts, as DEPLOYED (owner, 1 Nov 2026: "Cmd + K not working anymore on the admin"): ⌘K and the table tools threw "ReferenceError: __name is not defined" on every page.
// Root cause: several pages paste a function's own source (fn.toString()) into an inline <script>; wrangler's esbuild "keep_names" wraps every inner function of the BUNDLE in __name(...),
// a helper that exists in the Worker's bundle and not in the browser. Every other test ran the source files, never the bundle, so none could see it (11 Oct 2026: applying.js got a one-page shim for
// the same thing; the class came back through two other scripts). This test builds the bundle the way site.yml deploys it, serves the admin pages from it and checks every inline script.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {PAGES} from '../../../admin/admin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response('asset')},
  fetcher: async () => new Response('', {status: 503})});

/** The scripts of a page: every inline <script> without a src. */
const scriptsOf = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(text => text.trim());
/** The bundler's helpers a script calls but does not define itself (__name, __defProp, __publicField …): in a browser they do not exist. */
function strayHelpers(script) {
  const defined = new Set([...script.matchAll(/(?:const|let|var|function)\s+(__\w+)/g)].map(match => match[1]));
  return [...new Set([...script.matchAll(/\b(__\w+)\s*\(/g)].map(match => match[1]))].filter(name => !defined.has(name));
}

test('strayHelpers finds a bundler helper a script uses without defining it', () => {
  assert.deepEqual(strayHelpers('const a = __name((x) => x, "a"); a();'), ['__name']);
  assert.deepEqual(strayHelpers('const __name = t => t; const a = __name(() => 1, "a");'), []);
  assert.deepEqual(strayHelpers('const a = 1 + b(2);'), []);
});

test('the DEPLOYED bundle serves admin pages whose inline scripts call no bundler helper (⌘K and the table tools run)', {timeout: 600000}, async () => {
  const out = mkdtempSync(join(tmpdir(), 'www-bundle-'));
  after(() => rmSync(out, {recursive: true, force: true}));
  // The same command as .github/workflows/site.yml, without the upload: wrangler's own esbuild settings (keep_names from workers/www/wrangler.toml) decide what the bundle looks like.
  execFileSync('npx', ['--yes', 'wrangler@4', 'deploy', '--dry-run', '--outdir', out, '--config', 'wrangler.toml'], {cwd: new URL('../../../workers/www/', import.meta.url), stdio: 'pipe', env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1'}});
  const {default: bundled} = await import(pathToFileURL(join(out, 'index.js')).href);
  const checked = [], bad = [];
  for (const page of PAGES) {
    const response = await bundled.fetch(new Request(`https://www.jobpilotto.top${page.path}`, {headers: {Cookie: 'jp_stats=k3y'}}), env(), {waitUntil() {}});
    if (response.status !== 200 || !String(response.headers.get('Content-Type')).includes('text/html')) continue;
    const scripts = scriptsOf(await response.text());
    checked.push({path: page.path, scripts: scripts.length});
    for (const script of scripts) {
      for (const name of strayHelpers(script)) bad.push(`${page.path}: calls ${name}()`);
      assert.doesNotThrow(() => new vm.Script(script), `${page.path}: an inline script is not valid JavaScript`);
    }
  }
  assert.ok(checked.length >= 10, `positive control: the bundle served ${checked.length} admin pages (at least 10 expected)`);
  assert.ok(checked.every(page => page.scripts >= 2), 'every page carries the table tools and the ⌘K palette (withNav): at least two inline scripts');
  assert.deepEqual([...new Set(bad)].slice(0, 12), [], 'a bundler helper in an inline script: set keep_names = false in workers/www/wrangler.toml (the browser has no __name)');
});
