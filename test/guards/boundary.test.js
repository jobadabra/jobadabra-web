// The folder boundary of the Worker: web, admin, api, shared and workers. Owns: which folder may import which. Guards: {admin,api,shared,workers/www}.
//   admin  -> shared                (the owner's pages and the CI uploads that feed them)
//   api    -> shared                (what the installed apps call; their URLs never change)
//   shared -> shared                (used by both sides, so it can use neither)
//   workers -> every folder         (the router, the cron and the queue: workers/www)
// A folder site/ in the joined tree is refused: the old flat layout must not grow back.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const site = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED = {admin: ['admin', 'shared'], api: ['api', 'shared'], shared: ['shared'], workers: ['admin', 'api', 'shared', 'workers']};
const OURS = new Set(['web', 'admin', 'api', 'shared', 'workers', 'db', 'jobs', 'media']);   // this repo's folders; anything else is the public tree

function files(folder) {
  const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
  return walk(join(site, folder));
}
const importsOf = file => [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => resolve(dirname(file), m[1]));

test('admin, api and shared never import each other the wrong way', () => {
  const wrong = [];
  for (const folder of Object.keys(ALLOWED)) for (const file of files(folder)) for (const target of importsOf(file)) {
    const inSite = relative(site, target);
    const to = inSite.split(sep)[0];
    if (!OURS.has(to)) continue;   // the public repo's validators (extension/, desktop/lib/, app-core/src/, config/)
    if (!ALLOWED[folder].includes(to)) wrong.push(`${relative(site, file)} imports ${inSite}`);
  }
  assert.deepEqual(wrong, [], 'a file may only import its own folder and shared/ (the router in workers/ may import all)');
});

test('the public pages in web/ import nothing from the Worker folders', () => {
  const wrong = files('web').flatMap(file => importsOf(file).filter(t => relative(site, t).split(sep)[0] !== 'web').map(t => `${relative(site, file)} imports ${relative(site, t)}`));   // a page's own modules (a page script importing its own helper) are fine
  assert.deepEqual(wrong, []);
});

test('no site/ folder is left in the joined tree: the website sits at the top level', () => {
  assert.equal(existsSync(join(site, 'site', 'src')), false, 'put a new file in admin/, api/, shared/ or workers/www, never in site/src');
});
