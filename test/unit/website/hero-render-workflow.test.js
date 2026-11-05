// Guards the by-hand hero render on GitHub's Mac runners (.github/workflows/hero-render.yml; owner, 25 Oct 2026: "we can have a manually
// triggerable workflow", Mac fonts, never Linux): dispatch only, one Mac runner per clip, every stage clip offered, inputs never pasted into a script.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {VIDEOS} from '../../../media/scenes.mjs';

const root = new URL('../../../', import.meta.url);
const flow = readFileSync(new URL('.github/workflows/hero-render.yml', root), 'utf8');
const slides = Object.entries(VIDEOS).filter(([, piece]) => piece.slide).sort(([, a], [, b]) => a.slide - b.slide).map(([name]) => name);
const job = name => { const rest = flow.slice(flow.indexOf(`\n  ${name}:\n`) + 1), next = rest.search(/\n  [a-z]+:\n/); return next < 0 ? rest : rest.slice(0, next); };

test('the hero render runs by hand only, never on a push, a PR or a schedule', () => {
  const on = flow.slice(flow.indexOf('\non:'), flow.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\b(push|pull_request|schedule|workflow_run):/);
});

test('every clip on the stage is offered by default, and hero.sh records the same four (class: a fifth slide is checked too)', () => {
  const clips = flow.match(/clips:\n(?:\s+.*\n)*?\s+default: '([^']+)'/)[1].split(' ');
  assert.deepEqual(clips, slides);
  assert.match(readFileSync(new URL('tools/hero.sh', root), 'utf8'), new RegExp(`HERO=\\(${slides.join(' ')}\\)`));
});

test('each clip renders on its own Mac runner and comes back as an artifact; placing on a branch is the only write', () => {
  const render = job('render');
  assert.match(render, /runs-on: macos-/);
  assert.match(render, /clip: \$\{\{ fromJSON\(needs\.plan\.outputs\.clips\) \}\}/);
  assert.match(render, /tools\/hero\.sh "\$CLIP"/);
  assert.match(render, /upload-artifact@v6[\s\S]*name: hero-\$\{\{ matrix\.clip \}\}/);
  assert.match(flow.slice(0, flow.indexOf('\njobs:')), /permissions:\n  contents: read/);
  assert.match(job('place'), /if: inputs\.branch != ''[\s\S]*contents: write[\s\S]*tools\/hero\.sh --place set/);
});

test('inputs reach the scripts only through env, never pasted into a run line', () => {
  for (const block of flow.split(/\n\s+- /).filter(step => /\brun:/.test(step))) {
    const run = block.slice(block.search(/\brun:/));
    assert.doesNotMatch(run, /\$\{\{\s*(inputs|matrix|github\.event)\./, `a run line uses an expression directly: ${run.slice(0, 80)}`);
  }
});

test('on a private repo the Mac render refuses to start unless the run accepts the cost (macOS minutes count 10x)', () => {
  const plan = job('plan');
  assert.match(plan, /if: github\.event\.repository\.private && !inputs\.private_cost_ok\n\s+run: [^\n]*exit 1/);
  assert.ok(plan.indexOf('repository.private') < plan.indexOf('id: clips'), 'the cost gate comes first: no clip is planned without it');
  assert.match(flow, /private_cost_ok:\n(?:\s+.*\n)*?\s+default: false/);
});

test('the Mac runner gets an ffmpeg with libwebp first on PATH (run 1: Homebrew\'s slim ffmpeg lacks it and every clip stopped at once)', () => {
  const render = job('render');
  assert.match(render, /brew install ffmpeg-full && echo "\$\(brew --prefix ffmpeg-full\)\/bin" >> "\$GITHUB_PATH"/);
  assert.ok(render.indexOf('ffmpeg-full') < render.indexOf('tools/hero.sh'), 'before the run');
});

test('the runner records one take at a time (run 2: two at once on a 3-core VM stalled the capture and painted late after cuts)', () => {
  assert.match(job('render'), /HERO_TAKES: '1'/);
});

test('the artifact actions run on Node 24 (run 2 warned: Node.js 20 is deprecated for upload-artifact@v4)', () => {
  assert.match(flow, /actions\/upload-artifact@v6/);
  assert.match(flow, /actions\/download-artifact@v7/);
  assert.doesNotMatch(flow, /actions\/(upload|download)-artifact@v[45]\b/);
});
