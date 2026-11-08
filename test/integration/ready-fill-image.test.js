// The containers' own shell (hosted/: the Always on image and the Ready to send image), moved here from the public repo on 1 Nov 2026 (owner: "jobadabra should have no web, no worker").
// The Ready to send image copies the shared night files (public desktop/ready-fill/) and this repo's hosted/ready-fill/ into ONE flat folder, so every `./x.mjs` import must resolve in the union.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = new URL('../../', import.meta.url);
const mjs = dir => (existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root)).filter(file => file.endsWith('.mjs')) : []);
const shared = mjs('desktop/ready-fill/'), own = mjs('hosted/ready-fill/');

test('the Ready to send image copies both folders into one place, the shared files first', () => {
  const docker = readFileSync(new URL('hosted/ready-fill/Dockerfile', root), 'utf8');
  assert.ok(docker.indexOf('COPY desktop/ready-fill/*.mjs ./') > 0, 'the shared night files');
  assert.ok(docker.indexOf('COPY hosted/ready-fill/*.mjs ./') > docker.indexOf('COPY desktop/ready-fill/*.mjs ./'), 'then main.mjs and image-check.mjs');
  assert.match(docker, /COPY hosted\/ready-fill\/package\.json \.\//);
  assert.match(docker, /COPY desktop\/lib\/form-address\.js [^\n]*\/desktop\/lib\/$/m, 'fill-job and stand-in import ../../desktop/lib/form-address.js');
});

// The image's filesystem, as its COPY lines lay it out (WORKDIR /night): image path -> the repo file it comes from. A folder copied whole (extension, app-core/src) is listed by its files but not walked.
function imageFiles(docker) {
  const files = new Map(), walked = new Set();
  for (const [, args] of docker.matchAll(/^COPY (.+)$/gm)) {
    const parts = args.trim().split(/\s+/), dest = parts.pop(), asDir = dest.endsWith('/') || parts.length > 1 || parts.some(part => part.includes('*'));
    const target = path.posix.normalize(dest.startsWith('/') ? dest : path.posix.join('/night', dest));
    for (const source of parts) {
      const full = new URL(source.replace(/\*.*$/, ''), root), glob = source.includes('*');
      if (glob) { const folder = source.slice(0, source.lastIndexOf('/')); for (const file of readdirSync(new URL(`${folder}/`, root)).filter(name => new RegExp(`^${source.slice(folder.length + 1).replace('.', '\\.').replace('*', '.*')}$`).test(name))) { files.set(path.posix.join(target, file), `${folder}/${file}`); walked.add(path.posix.join(target, file)); } }
      else if (existsSync(full) && statSync(full).isDirectory()) { for (const file of readdirSync(full, {recursive: true, withFileTypes: true}).filter(entry => entry.isFile())) files.set(path.posix.join(target, path.relative(fileURLToPath(full), path.join(file.parentPath ?? file.path, file.name))), `${source}/${path.relative(fileURLToPath(full), path.join(file.parentPath ?? file.path, file.name))}`); }
      else { const image = asDir ? path.posix.join(target, path.posix.basename(source)) : target; files.set(image, source); walked.add(image); }
    }
  }
  return {files, walked};
}

test('every relative import a night file makes, down to the files those import, is in the image', () => {
  // Why (8 Nov 2026, cloud runner 2/4; code review of 1/4): this test followed only `./x.mjs` imports, so the read night's `../../desktop/lib/...` imports (and theirs) could be missing from the Dockerfile and nothing failed until a night did.
  // It lays the image out from the COPY lines, then follows every static and dynamic relative import of each file it copied one by one, in the image's own paths.
  assert.ok(shared.length >= 9 && own.includes('main.mjs'), `the shared files are in desktop/ready-fill/ (${shared.length}) and main.mjs here`);
  const {files, walked} = imageFiles(readFileSync(new URL('hosted/ready-fill/Dockerfile', root), 'utf8'));
  const missing = [], seen = new Set();
  const visit = image => {
    if (seen.has(image)) return; seen.add(image);
    const repo = files.get(image);
    if (!repo) return;
    for (const [, spec] of readFileSync(new URL(repo, root), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)'(\.\.?\/[^']+)'/g)) {
      const next = path.posix.join(path.posix.dirname(image), spec);
      if (!files.has(next)) missing.push(`${repo} imports ${spec}: ${next} is not in the image`); else visit(next);
    }
  };
  for (const image of walked) if (/\.m?js$/.test(image)) visit(image);
  assert.deepEqual(missing, []);
  assert.ok([...seen].some(image => image.startsWith('/desktop/lib/')), 'the walk reached the desktop/lib files the image carries');
});

test('the Always on image copies only folders the public tree has', () => {
  const docker = readFileSync(new URL('hosted/Dockerfile', root), 'utf8');
  // Why (1 Nov 2026, Gitar on web#280): every token but the last (the destination) of a COPY line is a source; the first regex checked only the first one.
  for (const [, args] of docker.matchAll(/^COPY (.+)$/gm)) for (const part of args.trim().split(/\s+/).slice(0, -1)) assert.ok(existsSync(new URL(part, root)), `${part} is in the joined tree`);
  assert.match(docker, /CMD \["python", "-m", "src", "hosted", "--serve"\]/);
});

test('the runner Workers point at the Dockerfiles that live here', () => {
  assert.match(readFileSync(new URL('workers/ready-runner/wrangler.jsonc', root), 'utf8'), /"image": "\.\.\/\.\.\/hosted\/ready-fill\/Dockerfile"/);
  assert.match(readFileSync(new URL('workers/hosted-runner/wrangler.jsonc', root), 'utf8'), /"image": "\.\.\/\.\.\/hosted\/Dockerfile"/);
});

test('a change to any file the Ready to send image copies redeploys the runner', () => {
  // Why (5 Nov 2026, hr): #280 moved hosted/ready-fill here from the public repo, but no trigger moved with it, so a fix to the container (#403) never deployed.
  // This repo's sources (hosted/ in the joined tree is ops/hosted/ here) start the release on push; public ones start it through public-watch.yml.
  const docker = readFileSync(new URL('hosted/ready-fill/Dockerfile', root), 'utf8');
  const release = readFileSync(new URL('.github/workflows/release-ready-runner.yml', root), 'utf8'), watch = readFileSync(new URL('.github/workflows/public-watch.yml', root), 'utf8');
  const watched = (watch.match(/public-watch\.sh "\$GITHUB_WORKSPACE" ready ([^)]+)\)/) || [])[1]?.split(/\s+/) || [];
  const missing = [];
  for (const [, args] of docker.matchAll(/^COPY (.+)$/gm)) {
    for (const source of args.trim().split(/\s+/).slice(0, -1)) {
      const folder = source.replace(/\/[^/]*\*[^/]*$/, '');   // hosted/ready-fill/*.mjs -> hosted/ready-fill
      const own = folder.split('/').slice(0, 2).join('/');   // hosted/ready-fill/package.json -> hosted/ready-fill
      if (folder.startsWith('hosted/')) { if (!release.includes(`'ops/${own}/**'`)) missing.push(`release-ready-runner.yml paths lack 'ops/${own}/**'`); }
      else if (source === 'desktop/package.json') continue;   // Why (5 Nov 2026): only its "type": "module" is used; a version bump at each release must not redeploy the runner
      else if (!watched.some(path => folder === path || folder.startsWith(`${path}/`))) missing.push(`public-watch.yml's ready list lacks ${folder}`);
    }
  }
  assert.deepEqual(missing, []);
});

// Moved from the public repo's tests/test_hosted_run.py (1 Nov 2026, rs 5c/6): the Dockerfile lives here now, so the checks on its text do too.
test('the Always on image starts the server and bakes in no secret', () => {
  const docker = readFileSync(new URL('hosted/Dockerfile', root), 'utf8');
  assert.match(docker, /CMD \["python", "-m", "src", "hosted", "--serve"\]/);
  assert.doesNotMatch(docker, /(token|key|secret)\s*=\s*\S/i);
});

test('the Always on image has the headless browser for script-built pages', () => {
  // Why (19 Oct 2026, owner): script-built job boards are read headlessly wherever the search runs, Cloudflare hosted included.
  const docker = readFileSync(new URL('hosted/Dockerfile', root), 'utf8');
  assert.ok(docker.includes('requirements-render.txt'));
  assert.match(docker, /playwright install --with-deps chromium/);
});
