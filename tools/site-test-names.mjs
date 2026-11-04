// Every test file this repo keeps in a folder it shares with the public repo carries the site's prefix (public docs/site-test-names.json), so it can
// never land at a public test's path: in CI's joined tree that replaced the public file and turned main red 3 times (24-26 Oct 2026, last web#163).
// Public's tests/test_names_kept_for_the_site.py keeps public files out of these prefixes. Usage: node tools/site-test-names.mjs <public-dir> <site-dir>
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// folders: {folder: [prefixes]}; files: {folder: [paths relative to it]} -> the site files that carry none of their folder's prefixes
export function misnamed(folders, files) {
  return Object.entries(files).flatMap(([folder, names]) => {
    const prefixes = folders[folder];
    if (!prefixes) return names.map(name => `${folder}/${name} (no rule for this folder in docs/site-test-names.json)`);
    return names.filter(name => !prefixes.some(prefix => name.startsWith(prefix))).map(name => `${folder}/${name}`);
  });
}

// Why (layout 3/3, 2 Nov 2026): public's folders are JOINED-tree paths (tests, desktop/test); this repo keeps them elsewhere (tools/layout-map.txt: test/python, test/media).
// A raw folder that holds a mapped one (test) leaves that one out: its files belong to the other joined folder.
function mapPairs(dir) {
  return readFileSync(path.join(dir, 'tools/layout-map.txt'), 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/));
}
export function tracked(dir, folder) {
  const pairs = mapPairs(dir);
  const raw = (pairs.find(([, joined]) => joined === folder) || [folder])[0];
  const nested = pairs.map(([from]) => from).filter(from => from !== raw && from.startsWith(`${raw}/`));
  const out = execFileSync('git', ['ls-files', '--', raw], {cwd: dir, encoding: 'utf8'});
  return out.split('\n').filter(Boolean).filter(line => !nested.some(from => line.startsWith(`${from}/`))).map(line => line.slice(raw.length + 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [publicDir, siteDir] = process.argv.slice(2);
  const {folders} = JSON.parse(readFileSync(path.join(publicDir, 'docs/site-test-names.json'), 'utf8'));
  const files = Object.fromEntries(Object.keys(folders).map(folder => [folder, tracked(siteDir, folder)]));
  const wrong = misnamed(folders, files);
  if (wrong.length) {
    console.log(`::error::these tests of this repo lack the site's prefix (public docs/site-test-names.json: ${JSON.stringify(folders)}), so a public test may take their path: ${wrong.join(' ')}`);
    process.exit(1);
  }
  console.log(`site-test-names: every site test carries its folder's prefix (${Object.values(files).flat().length} files)`);
}
