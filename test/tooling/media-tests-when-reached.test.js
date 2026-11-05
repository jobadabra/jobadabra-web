// A pull request runs the media tests and installs ffmpeg/Electron only when it changes a media file; main and the daily run always do (owner's "a PR
// runs only what its changes reach"; 26 Oct 2026: a stalled Ubuntu mirror failed migration-only web #154 four times on the ffmpeg install).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/tests.yml', root), 'utf8');
const guards = readFileSync(new URL('tools/site-guards.sh', root), 'utf8');
const step = name => workflow.split('\n      - name: ').find(part => part.startsWith(name)) || '';

test('only a pull request decides, from its own changed files', () => {
  const decide = step('Does this PR touch media?');
  assert.match(decide, /if: github\.event_name == 'pull_request'/, 'main and the daily run never skip');
  assert.match(decide, /pulls\/.*\/files/);
  assert.match(decide, /\|\| files='ops\/media\/'/, 'a failed lookup runs the media tests');
  for (const reached of ['ops/media/', 'test/media/media-', 'apt-install', 'site-guards']) assert.ok(decide.includes(reached), reached);
});

test('ffmpeg and Electron are installed whenever the media tests run: every push and daily run, and a PR that reaches media', () => {
  for (const name of ['ffmpeg for the hero media tests', 'Electron and a display for the hero render test']) {
    assert.match(step(name), /if: github\.event_name != 'pull_request' \|\| env\.MEDIA_TOOLS == '1'/, name);
  }
});

// GitHub's `if:` turns null and '0' both into the number 0, so an unset env.X reads as '0': `env.MEDIA_TOOLS != '0'` skipped
// ffmpeg and Electron on every push to main while site-guards (unset = run) still ran the media tests (red main 9908c69, 26 Oct 2026).
test('no workflow `if:` compares an env value with 0 (an unset value reads as 0 there)', () => {
  const dir = new URL('.github/workflows/', root);
  const bad = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).flatMap(f => readFileSync(new URL(f, dir), 'utf8').split('\n')
    .map((line, i) => [`${f}:${i + 1}`, line])
    .filter(([, line]) => /\bif:/.test(line) && (/\benv\.\w+\s*[!=]=\s*'?0'?(?![\w.])/.test(line) || /'?0'?\s*[!=]=\s*env\./.test(line))));
  assert.deepEqual(bad.map(([at, line]) => `${at} ${line.trim()}`), [], "compare with '1' (or check github.event_name) instead");
});

test('site-guards leaves out only the media tests, and says so', () => {
  assert.match(guards, /if \[ "\$\{MEDIA_TOOLS:-1\}" = 0 \]/, 'unset means run them');
  assert.match(guards, /grep -v '\^test\/media-'/);
  assert.match(guards, /media tests not run here/);
});
