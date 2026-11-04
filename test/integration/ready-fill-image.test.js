// The containers' own shell (hosted/: the Always on image and the Ready to send image), moved here from the public repo on 1 Nov 2026 (owner: "jobadabra should have no web, no worker").
// The Ready to send image copies the shared night files (public desktop/ready-fill/) and this repo's hosted/ready-fill/ into ONE flat folder, so every `./x.mjs` import must resolve in the union.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const mjs = dir => (existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root)).filter(file => file.endsWith('.mjs')) : []);
const shared = mjs('desktop/ready-fill/'), own = mjs('hosted/ready-fill/');

test('the Ready to send image copies both folders into one place, the shared files first', () => {
  const docker = readFileSync(new URL('hosted/ready-fill/Dockerfile', root), 'utf8');
  assert.ok(docker.indexOf('COPY desktop/ready-fill/*.mjs ./') > 0, 'the shared night files');
  assert.ok(docker.indexOf('COPY hosted/ready-fill/*.mjs ./') > docker.indexOf('COPY desktop/ready-fill/*.mjs ./'), 'then main.mjs and image-check.mjs');
  assert.match(docker, /COPY hosted\/ready-fill\/package\.json \.\//);
  assert.match(docker, /COPY desktop\/lib\/form-address\.js \/desktop\/lib\/form-address\.js/, 'fill-job and stand-in import ../../desktop/lib/form-address.js');
});

test('every relative import of a night file resolves to a file the image has beside it', () => {
  assert.ok(shared.length >= 9 && own.includes('main.mjs'), `the shared files are in desktop/ready-fill/ (${shared.length}) and main.mjs here`);
  const flat = new Set([...shared, ...own]);
  const missing = [];
  for (const [dir, files] of [['desktop/ready-fill/', shared], ['hosted/ready-fill/', own]]) {
    for (const file of files) {
      for (const [, spec] of readFileSync(new URL(dir + file, root), 'utf8').matchAll(/from\s+'(\.\/[^']+\.mjs)'/g)) if (!flat.has(spec.slice(2))) missing.push(`${dir}${file} imports ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
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
