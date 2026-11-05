// Every module of the Worker, across the four source folders (admin, api, shared, workers/www): for tests that scan all the code, not one file.
// Owns: the list of folders (the same four the boundary test, test/guards/boundary.test.js, checks). Guarded by: boundary.test.js.
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SOURCE_FOLDERS = ['admin', 'api', 'shared', 'workers/www'];
const site = new URL('../../', import.meta.url);

export function sourceFiles() {
  return SOURCE_FOLDERS.flatMap(folder => readdirSync(new URL(`${folder}/`, site))
    .filter(name => name.endsWith('.js'))
    .map(name => ({folder, name, path: fileURLToPath(new URL(`${folder}/${name}`, site))})));
}
