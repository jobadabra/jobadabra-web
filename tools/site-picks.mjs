// Picks the site tests a PR's changed files can break, for the Site tests step of a web PR; main and the daily run keep every test.
// Why (5 Nov 2026, owner: "We run "site tests" (which are all tests) no matter what's the PR change" · "Everything about web is in jobadabra-web"): it lives here, not in jobadabra's affected-tests.py.
// Usage, from the joined tree: node tools/site-picks.mjs <file with this repo's changed paths>. Prints one test per line; exit 3 = run every test, the reason on stderr.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const IMPORTED = /(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]*)['"]/g;
const STARTED = /new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g;   // a page walker starts its tool as a process
const NAMED_FILE = /['"]((?:[\w.-]+\/)+[\w.-]+\.m?js)['"]/g;   // and the tool loads the Worker by a joined path
const JOINED_FOLDER = /path\.join\(\s*\w+\s*,\s*['"]([\w./-]+)['"]\s*\)/g;   // or serves one: the phone check's path.join(repo, 'web/public')
const FOLDER_READ = /readdirSync\(\s*(?:new URL\(\s*['"]([^'"]+\/)['"]\s*,\s*import\.meta\.url\s*\)|path\.join\(\s*\w+\s*,\s*['"]([\w./-]+)['"]\s*\))/g;
const VALUE_FOLDER = /[`'"](?:\.{1,2}\/)*((?:[\w.-]+\/)+)\$\{/g;   // `admin/${page}.js`: a file named by a value
const IMPORT_LINE = /^\s*import\b[^\n]*$/gm;
const SCAN = /readdirSync|globSync|git ls-files|git ls-tree|['"]ls-(?:files|tree)['"]|(?:execFile|exec|spawn)(?:Sync)?\([^\n]*['"]tools\//;
const WORKFLOW_FOLDER = /\.github['"]?\s*[/,]\s*['"]?workflows/;
const READS_TREE = /(^|\/)(scripts|tools|test|e2e)\//;
const HARNESS = /(^|\/)e2e\/lib\//;   // jobadabra's harness lists its own run folders, never this repo
const PAGES = /^(web|admin|api|shared|workers)\//;
const CODE = /\.(js|mjs|cjs)$/;
const NO_EFFECT = /\.md$|^LICENSE|\.gitignore$/;
const KNOWN = /^(tools|desktop|tests|web|admin|api|shared|workers|db|test|jobs|media|\.github|docs)\//;
const DEPENDENCIES = /(^|\/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|eslint\.config\.mjs)$/;
// What runs the site tests themselves; a change here can break any test without reaching it.
const RUNNER = /^(tools\/(site-picks\.mjs|site-tests\.sh|tree\.sh|overlay\.sh|lay-private\.sh|layout-map\.txt|site-guards\.sh|site-run\.sh)|\.github\/workflows\/tests\.yml)$/;

// mapText: tools/layout-map.txt; a path of this repo -> its path in the joined tree, where tests and imports live
export function joinedPath(file, mapText) {
  const lines = mapText.split('\n').filter(line => !line.startsWith('#')).map(line => line.trim().split(/\s+/)).filter(parts => parts.length === 2);
  const [from, to] = lines.filter(([folder]) => file.startsWith(`${folder}/`)).sort((a, b) => b[0].length - a[0].length)[0] || [];
  return from ? to + file.slice(from.length) : file;
}

// root: the joined tree; changed: joined-tree paths -> {all: reason} or {tests: [paths]}. Invariant: when in doubt, every test runs.
export function pick(root, changed) {
  const everything = changed.find(file => RUNNER.test(file)) || changed.find(file => DEPENDENCIES.test(file));
  if (everything) return {all: `test runner or dependencies: ${everything}`};
  const unknown = changed.find(file => !KNOWN.test(file) && !NO_EFFECT.test(file));
  if (unknown) return {all: `no test area for ${unknown}`};

  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const inRepo = file => file !== root && file.startsWith(root + path.sep);
  const texts = new Map(), edges = new Map();
  const text = file => {
    if (!texts.has(file)) texts.set(file, fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '');
    return texts.get(file);
  };
  const isFile = file => fs.existsSync(file) && fs.statSync(file).isFile();
  const isFolder = file => fs.existsSync(file) && fs.statSync(file).isDirectory();
  const resolved = (from, spec) => {
    const target = path.resolve(path.dirname(from), spec);
    return [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, path.join(target, 'index.js'), path.join(target, 'index.mjs')].find(isFile);
  };
  const deps = file => {
    if (edges.has(file)) return edges.get(file);
    const source = text(file), found = new Set();
    for (const [, spec] of source.matchAll(IMPORTED)) { const hit = resolved(file, spec); if (hit) found.add(hit); }
    for (const [, spec] of source.matchAll(STARTED)) { const hit = path.resolve(path.dirname(file), spec); if (CODE.test(hit) && isFile(hit)) found.add(hit); }
    for (const [, spec] of source.matchAll(NAMED_FILE)) { const hit = path.resolve(root, spec); if (isFile(hit)) found.add(hit); }
    edges.set(file, found);
    return found;
  };
  const reach = start => {
    const seen = new Set(), stack = [start];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file) || !CODE.test(file)) continue;
      seen.add(file);
      stack.push(...deps(file));
    }
    return seen;
  };
  // A read narrows a pick only when it names a real sub-folder: `path.join(here, 'fixtures')` or the repo root stays a scan.
  const named = (file, url, joined) => {
    const target = url ? path.resolve(path.dirname(file), url) : path.resolve(root, joined);
    return inRepo(target) && isFolder(target) ? target : null;
  };
  const folders = file => [...[...text(file).matchAll(FOLDER_READ)].map(([, url, joined]) => named(file, url, joined)), ...[...text(file).matchAll(JOINED_FOLDER)].map(([, joined]) => named(file, '', joined))]
    .filter(Boolean).map(folder => `${rel(folder)}/`);
  const scans = file => SCAN.test(text(file).replace(IMPORT_LINE, '').replace(FOLDER_READ, (read, url, joined) => named(file, url, joined) ? '' : read));
  const names = (source, file) => source.includes(file) || (path.basename(file).length >= 6 && source.includes(path.basename(file)));

  const changedFiles = new Set(changed.map(file => path.resolve(root, file)));
  if (changed.some(file => PAGES.test(file) && !CODE.test(file))) changedFiles.add(path.resolve(root, 'workers/www/index.js'));   // a page's html or css: the Worker serves it by path
  const workflows = changed.some(file => file.startsWith('.github/workflows/'));
  const tests = allTests(path.join(root, 'test')).sort();
  return {tests: tests.filter(test => {
    const source = text(test), reached = [...reach(test)];
    const readers = reached.filter(file => READS_TREE.test(rel(file)) && !HARNESS.test(rel(file)));
    const listed = [...reached.flatMap(folders), ...[...source.matchAll(VALUE_FOLDER)].map(([, folder]) => folder)];
    return reached.some(file => changedFiles.has(file)) || (workflows && WORKFLOW_FOLDER.test(source)) || changed.some(file => names(source, file))
      || scans(test) || readers.some(scans) || changed.some(file => listed.some(folder => file.startsWith(folder)));
  }).map(rel)};
}

function allTests(folder) {
  return fs.readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? allTests(file) : entry.name.endsWith('.test.js') ? [file] : [];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const map = fs.readFileSync(new URL('layout-map.txt', import.meta.url), 'utf8');
  const changed = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(file => joinedPath(file, map));
  const {all, tests} = pick(process.cwd(), changed);
  if (all) {
    console.error(`site-picks: every test (${all})`);
    process.exit(3);
  }
  console.error(`site-picks: ${tests.length} test files of ${changed.length} changed files: what they reach or name, and tests of the whole tree; main runs every test`);
  if (tests.length) console.log(tests.join('\n'));
}
