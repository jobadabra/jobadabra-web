// Guard: release — a web PR's Site tests run only what tools/site-picks.mjs picks, so a test it misses goes red on main instead of on the PR.
// Why (5 Nov 2026, owner: "We run "site tests" (which are all tests) no matter what's the PR change"): these are the ways a site test reaches code with no import line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {joinedPath, pick} from '../../tools/site-picks.mjs';

const TREE = {
  'admin/page.js': 'export const page = 1;\n',
  'admin/page.css': 'body {}\n',
  'shared/deep.js': 'export const deep = 1;\n',
  'shared/top.js': "import {deep} from './deep.js';\nexport const top = deep;\n",
  'db/migrations/0001_a.sql': 'select 1;\n',
  'web/public/index.html': '<html></html>\n',
  'workers/www/index.js': "import '../../admin/page.js';\n",
  'tools/worker-server.mjs': "import fs from 'node:fs';\nimport path from 'node:path';\nfs.readdirSync(path.join(root, 'db/migrations'));\nawait import(path.join(root, 'workers/www/index.js'));\n",
  'tools/walk-pages.mjs': "import './worker-server.mjs';\n",
  'tools/phone-width.mjs': "import path from 'node:path';\nconst web = path.resolve(path.join(repo, 'web/public'));\n",
  'test/admin/walker.test.js': "const tool = new URL('../../tools/walk-pages.mjs', import.meta.url).pathname;\n",
  'test/web/phone.test.js': "const tool = new URL('../../tools/phone-width.mjs', import.meta.url).pathname;\n",
  'test/admin/seeded.test.js': "import {readdirSync} from 'node:fs';\nreaddirSync(new URL('../../db/migrations/', import.meta.url));\n",
  'test/admin/deep.test.js': "import {top} from '../../shared/top.js';\n",
  'test/admin/by-value.test.js': "import {readFileSync} from 'node:fs';\nreadFileSync(`admin/${name}.js`);\n",
  'test/admin/whole-tree.test.js': "import {execFileSync} from 'node:child_process';\nexecFileSync('git', ['ls-files']);\n",
  'test/admin/own-fixtures.test.js': "import {readdirSync} from 'node:fs';\nimport path from 'node:path';\nreaddirSync(path.join(here, 'fixtures'));\n",
  'test/admin/repo-root.test.js': "import {readdirSync} from 'node:fs';\nreaddirSync(new URL('../../', import.meta.url));\n",
  'test/admin/reads-readme.test.js': "import {readFileSync} from 'node:fs';\nreadFileSync('README.md');\n",
  'test/shared/kit.js': "import {readFileSync} from 'node:fs';\nexport const seed = name => readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url));\n",
  'test/shared/named-kit.js': "export const seeds = ['0002_named.sql'];\n",
  'test/admin/kit-user.test.js': "import {seed} from '../shared/kit.js';\n",
  'test/admin/named-kit-user.test.js': "import {seeds} from '../shared/named-kit.js';\n",
  'test/admin/alone.test.js': 'export const nothing = 1;\n',
  // the browser and route walks, at their real paths (WALKS in tools/site-picks.mjs)
  'tools/admin-check.mjs': "import './worker-server.mjs';\n",
  'tools/page-shot.mjs': "import './worker-server.mjs';\n",
  'test/integration/palette-pages.test.js': "const tool = new URL('../../tools/admin-check.mjs', import.meta.url).pathname;\n",
  'test/integration/no-sideways.test.js': "const tool = new URL('../../tools/phone-width.mjs', import.meta.url).pathname;\n",
  'test/tooling/page-shot.test.js': "import {execFileSync} from 'node:child_process';\nexecFileSync('node', ['tools/page-shot.mjs']);\n",
  'test/unit/workers/www/site-routes.test.js': "import worker from '../../../../workers/www/index.js';\n",
};
const BROWSER_WALKS = ['palette-pages', 'admin-no-sideways', 'table-tools', 'email-template-view', 'no-sideways'].map(name => `test/integration/${name}.test.js`).concat('test/tooling/page-shot.test.js');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'site-picks-')));
for (const [name, text] of Object.entries(TREE)) {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
  fs.writeFileSync(path.join(root, name), text);
}
test.after(() => fs.rmSync(root, {recursive: true, force: true}));
const picked = (...changed) => pick(root, changed).tests;

test('a page walker reaches the Worker through the tool it starts', () => {
  assert.ok(picked('admin/page.js').includes('test/admin/walker.test.js'));
});

test('a page file that is not code runs what reaches the Worker', () => {
  assert.ok(picked('admin/page.css').includes('test/admin/walker.test.js'));
});

test('a tool that serves a folder runs for a file in it', () => {
  assert.ok(picked('web/public/index.html').includes('test/web/phone.test.js'));
});

test('a test that seeds from a folder runs only for that folder', () => {
  assert.ok(picked('db/migrations/0001_a.sql').includes('test/admin/seeded.test.js'));
  assert.ok(!picked('admin/page.js').includes('test/admin/seeded.test.js'));
});

test('shared/ is followed past its first file', () => {
  assert.ok(picked('shared/deep.js').includes('test/admin/deep.test.js'));
});

test('a file named by a value counts its folder', () => {
  assert.ok(picked('admin/page.js').includes('test/admin/by-value.test.js'));
});

test('a helper a test imports counts: its value-built folder and the files it names', () => {
  assert.ok(picked('db/migrations/0001_a.sql').includes('test/admin/kit-user.test.js'));
  assert.ok(picked('db/migrations/0002_named.sql').includes('test/admin/named-kit-user.test.js'));
  assert.ok(!picked('admin/page.js').includes('test/admin/kit-user.test.js'));
});

test('a read that names no real sub-folder stays a scan', () => {
  for (const name of ['test/admin/own-fixtures.test.js', 'test/admin/repo-root.test.js']) assert.ok(picked('admin/page.js').includes(name), name);
});

test('a test of the whole tree runs for any change', () => {
  assert.ok(picked('.github/workflows/other.yml').includes('test/admin/whole-tree.test.js'));
});

test('a root doc runs only the tests that name it', () => {
  const tests = picked('README.md');
  assert.ok(tests.includes('test/admin/reads-readme.test.js'));
  assert.ok(!tests.includes('test/admin/alone.test.js'));
});

test('an unrelated test is left out', () => {
  assert.ok(!picked('admin/page.js').includes('test/admin/alone.test.js'));
});

test('dependencies and an unknown path run every test', () => {
  for (const file of ['workers/www/package.json', 'somewhere/new.js']) assert.ok(pick(root, [file]).all, file);
});

test('the test workflow and the test tools run only what they reach, not every test (owner, 6 Nov 2026: "Only what it reaches")', () => {
  for (const file of ['tools/layout-map.txt', 'tools/site-picks.mjs', 'tools/site-tests.sh', 'tools/site-test-reporter.mjs', '.github/workflows/tests.yml']) {
    const out = pick(root, [file]);
    assert.ok(!out.all && out.tests.length > 0 && out.tests.length < Object.keys(TREE).filter(name => name.endsWith('.test.js')).length, `${file}: ${JSON.stringify(out)}`);
  }
  assert.ok(!picked('tools/site-test-reporter.mjs').includes('test/admin/alone.test.js'));
});

test('a path of this repo becomes its joined-tree path; the longest folder wins', () => {
  const map = '# comment\nwebsite web\nops/db db\ntest/desktop desktop/test\n';
  assert.equal(joinedPath('website/a.js', map), 'web/a.js');
  assert.equal(joinedPath('ops/db/migrations/1.sql', map), 'db/migrations/1.sql');
  assert.equal(joinedPath('test/desktop/y.test.js', map), 'desktop/test/y.test.js');
  assert.equal(joinedPath('admin/z.js', map), 'admin/z.js');
});

// Why (6 Nov 2026, owner: "Yes, walks on main only (Recommended)"; the walks had stopped 3 of 273 PRs since 27 Oct, all demo-data crashes): a PR never picks the six browser walks, except by editing the walk's own test file.
// The fixtures stand in for them at their real paths; the tree has no walk named email-template-view or table-tools, so add them as empty files first.
for (const walk of BROWSER_WALKS) if (!fs.existsSync(path.join(root, walk))) { fs.mkdirSync(path.dirname(path.join(root, walk)), {recursive: true}); fs.writeFileSync(path.join(root, walk), "const tool = new URL('../../tools/admin-check.mjs', import.meta.url).pathname;\n"); }

test('no change a PR can make picks a browser walk', () => {
  for (const change of [['admin/page.js'], ['admin/page.css'], ['web/public/home.css', 'web/public/download.html'], ['tools/page-shot.mjs'], ['tools/worker-server.mjs'], ['tools/admin-check.mjs'], ['workers/www/index.js'], ['tools/site-picks.mjs']]) {
    const tests = picked(...change);
    for (const walk of BROWSER_WALKS) assert.ok(!tests.includes(walk), `${walk} picked by ${change}`);
  }
});

test('a PR that edits a walk\'s own test file runs that walk, and only that one', () => {
  for (const walk of BROWSER_WALKS) {
    const tests = picked(walk);
    assert.ok(tests.includes(walk), walk);
    for (const other of BROWSER_WALKS.filter(name => name !== walk)) assert.ok(!tests.includes(other), `${other} picked by ${walk}`);
  }
});

test('a public page change still runs the rest of the web rule, without the sitemap phone walk', () => {
  const tests = picked('test/unit/website/landing.test.js', 'web/public/home.css', 'web/public/index.html', 'web/public/privacy.html', 'web/public/trust.html');
  assert.ok(!tests.includes('test/integration/no-sideways.test.js'));
  assert.ok(tests.includes('test/web/phone.test.js'), 'the rest of the rule is unchanged');
});

test('an admin code change still runs the route walk (not a browser)', () => {
  assert.ok(picked('admin/page.js').includes('test/unit/workers/www/site-routes.test.js'));
  assert.ok(picked('workers/www/index.js').includes('test/unit/workers/www/site-routes.test.js'));
});
