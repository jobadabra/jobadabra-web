// Every name the media pipeline uses is defined (round 9, 24 Oct 2026: a refactor of media.mjs dropped `let wordsFrom`, and the run died with
// "wordsFrom is not defined" only after the overlay was built; the tests never import media.mjs, whose recorders need a browser). ESLint's
// no-undef over media/, with Node and browser names (page.evaluate code runs in the page), finds it in a second.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {test} from 'node:test';

const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(desktop, 'package.json'));

// CI installs desktop's modules (tests.yml npm ci) and runs it; a local overlay without them skips it, never CI.
let lint = null;
try { require.resolve('eslint'); lint = true; } catch { lint = false; }
test('no file in media/ uses a name it never defines', {skip: !lint && !process.env.CI && 'desktop modules not installed here (CI runs it)'}, async () => {
  const {ESLint} = require('eslint'), globals = require('globals');
  const eslint = new ESLint({cwd: path.resolve(desktop, '..'), overrideConfigFile: true, overrideConfig: {
    languageOptions: {ecmaVersion: 2024, sourceType: 'module', globals: {...globals.node, ...globals.browser}}, rules: {'no-undef': 'error'}}});
  const results = await eslint.lintFiles(['media/*.mjs']);
  const found = results.flatMap(result => result.messages.map(m => `${path.basename(result.filePath)}:${m.line} ${m.message}`));
  assert.ok(results.length >= 20, `linted ${results.length} files`);
  assert.deepEqual(found, []);
});
