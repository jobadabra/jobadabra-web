// The SDLC tab of the agent coding page (admin/agent-coding-sdlc.js, the `sdlc` upload in admin/agent-coding.js): ingest clamps, the four corners of the Checks grid, checks with too few runs, the path and phases, the tab link.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanGate, cleanSdlc} from '../../../admin/agent-coding.js';
import {page} from '../../../admin/agent-coding-page.js';
import {checkId, checksCard, checksOf, cornerOf, sdlcPage} from '../../../admin/agent-coding-sdlc.js';

const now = new Date('2026-11-01T12:00:00Z');
const row = (kind, day, card) => ({kind, day, card: JSON.stringify(card), updated_at: `${day}T05:00:00Z`});
const catches = (extra = {}) => ({product: 0, test: 0, ci: 0, form: 0, flaky: 0, rebase: 0, nofix: 0, ...extra});
const sdlcDay = (layers, extra = {}) => ({layers: {pr: {}, main: {}, night: {}, ...layers}, phases: {merged: 10, nospec: 3, unmerged: 1, prCommits: 30, fixAfter: 2, reverts: 0, redMain: 0}, bugs: 2, ...extra});
const gateDay = steps => ({pushes: 5, secs: 100, stopped: {form: 1, real: 1, other: 0}, stoppedSecs: {form: 10, real: 90, other: 0}, steps});

test('the upload keeps only counts, seconds and check names: clamped, cut, unknown layers and classes dropped', () => {
  const clean = cleanSdlc({layers: {pr: {'CI · Tests<script>': {runs: -4, fails: 1e12, secs: 'x', catches: {product: 2, evil: 9}}}, hack: {a: {runs: 1}}}, phases: {merged: 5, branch: 'secret'}, bugs: 3, branch: 'secret'});
  assert.deepEqual(Object.keys(clean.layers), ['pr', 'main', 'night']);
  const [name, check] = Object.entries(clean.layers.pr)[0];
  assert.ok(!name.includes('<'), 'the label is cut to its charset');
  assert.deepEqual([check.runs, check.fails <= 1e7, check.secs, check.catches.product, 'evil' in check.catches], [0, true, 0, 2, false]);
  assert.equal(clean.phases.merged, 5);
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.equal(cleanSdlc(null), null);
});

test('the four corners: slow x valuable, with a plain rule; a check with under 20 runs is not placed', () => {
  const base = {runs: 100, secs: 0, real: 0};
  assert.equal(cornerOf({...base, perRun: 5, real: 5}), 'keep');
  assert.equal(cornerOf({...base, perRun: 300, real: 5}), 'faster');
  assert.equal(cornerOf({...base, perRun: 300, real: 0}), 'remove');
  assert.equal(cornerOf({...base, perRun: 2, real: 0}), 'quiet');
  assert.equal(cornerOf({...base, perRun: 300, real: 0, runs: 19}), 'few');
  assert.equal(cornerOf({...base, perRun: 2, real: 1, runs: 1000}), 'quiet', 'one catch in 1000 runs is under 1 in 100');
});

test('checks come from both uploads: a push-check stop that is not a form check is real; on other layers a real catch is a product or test fix; form and flaky stay apart', () => {
  const week = {gate: [gateDay({'file size': {runs: 50, fails: 5, secs: 40, cls: 'form'}, 'desktop (clean checkout)': {runs: 30, fails: 4, secs: 2400, cls: 'real'}})],
    sdlc: [sdlcDay({pr: {'CI · Tests · python': {runs: 40, fails: 9, secs: 8000, catches: catches({product: 3, test: 1, form: 2, flaky: 2, nofix: 1})}}})]};
  const by = Object.fromEntries(checksOf([week]).map(check => [check.name, check]));
  assert.deepEqual([by['file size'].real, by['file size'].form, by['desktop (clean checkout)'].real], [0, 5, 4]);
  assert.deepEqual([by['CI · Tests · python'].real, by['CI · Tests · python'].form, by['CI · Tests · python'].flaky, by['CI · Tests · python'].layer], [4, 2, 2, 'pr']);
  assert.equal(cornerOf(by['file size']), 'quiet');
  assert.equal(cornerOf(by['desktop (clean checkout)']), 'faster');
});

test('the tab draws the grid, the path and the phases from the three uploads; every corner has a word, not only a colour', () => {
  const rows = [row('gate', '2026-10-30', gateDay({'file size': {runs: 50, fails: 5, secs: 40, cls: 'form'}, 'python (clean checkout)': {runs: 40, fails: 6, secs: 3200, cls: 'real'}})),
    row('sdlc', '2026-10-30', sdlcDay({pr: {'CI · Tests · python': {runs: 40, fails: 9, secs: 8000, catches: catches({product: 3})}, 'CI · Pull request': {runs: 90, fails: 8, secs: 5400, catches: catches({form: 8})}}, main: {'CI · Tests': {runs: 30, fails: 2, secs: 600, catches: catches({nofix: 2})}}})),
    row('sdlc', '2026-10-23', sdlcDay({}, {phases: {merged: 10, nospec: 3, unmerged: 1, prCommits: 30, fixAfter: 3, reverts: 0, redMain: 0}})),
    row('sdlc', '2026-10-16', sdlcDay({}, {phases: {merged: 10, nospec: 1, unmerged: 0, prCommits: 20, fixAfter: 1, reverts: 0, redMain: 0}}))];
  const html = sdlcPage(rows, now);
  for (const word of ['Checks: value and cost', 'The path', 'The four phases', 'Make faster', 'Remove?', 'Cheap, quiet', 'Agent hooks', 'not measured yet', 'worse than the week before', 'CI · Tests · python', 'file size']) assert.ok(html.includes(word), word);
  assert.match(html, /<svg class="ac-scatter"[^>]*role="group" aria-label="Every check by/);   // Why (2 Nov 2026): not role="img": that hides the circles' links from keyboard and screen-reader users
  assert.ok(html.includes('/admin/agents/agent-coding?tab=sdlc') && html.includes('aria-current="page"'));
  assert.ok(page(rows, now).includes('SDLC · the whole path'), 'the weekly page links to the tab');
});

test('with no upload the tab says so, draws no scatter, and names nothing that is not there', () => {
  const html = sdlcPage([], now);
  assert.ok(html.includes('No upload yet') && html.includes('No SDLC upload yet'));
  assert.ok(!html.includes('<svg class="ac-scatter"'));
});

test('a check name from the upload is escaped', () => {
  const rows = [row('sdlc', '2026-10-30', sdlcDay({pr: {'a<img src=x>': {runs: 40, fails: 1, secs: 100, catches: catches()}}}))];
  assert.ok(!sdlcPage(rows, now).includes('<img src=x>') && sdlcPage(rows, now).includes('a&lt;img src=x&gt;'));
});

test('the phases compare the last two COMPLETE weeks, never a half-finished one: this week alone says nothing, and a full week is not read as better because this week has few days yet', () => {
  const thisWeekOnly = [row('sdlc', '2026-10-27', sdlcDay({}))];
  assert.ok(sdlcPage(thisWeekOnly, now).includes('No SDLC upload yet for a full week'));
  const rows = [row('sdlc', '2026-10-27', sdlcDay({}, {phases: {merged: 1, nospec: 0, unmerged: 0, prCommits: 1, fixAfter: 0, reverts: 0, redMain: 0}})),   // this week: one day, tiny counts
    row('sdlc', '2026-10-21', sdlcDay({})), row('sdlc', '2026-10-14', sdlcDay({}))];
  const html = sdlcPage(rows, now);
  assert.ok(!html.includes('better than the week before'), 'a half week with small counts must not read as an improvement');
  assert.ok(html.includes('same as the week before'));
});

// Owner's yes, 1 Nov 2026 (layer 0): the Agent hooks row shows blocks per hook once the upload carries them, and says "not measured yet" before.
test('the gate upload keeps hook counts only for the four fixed labels; the Agent hooks row is "not measured yet" until a block is seen, then shows blocks per hook', () => {
  const clean = cleanGate({pushes: 1, hooks: {'session-cap': 2, 'foreground-long-run': 1e12, 'rm -rf /': 5, secret: 'x'}});
  assert.deepEqual(Object.keys(clean.hooks), ['guard-primary-checkout', 'background-tee', 'foreground-long-run', 'session-cap']);
  assert.equal(clean.hooks['session-cap'], 2);
  assert.ok(!JSON.stringify(clean).includes('rm -rf') && !JSON.stringify(clean).includes('secret'));
  assert.equal('hooks' in cleanGate({pushes: 1}), false, 'a day without blocks carries no hooks field');
  const without = [row('gate', '2026-10-30', gateDay({}))];
  assert.ok(sdlcPage(without, now).includes('not measured yet: no hook has blocked anything'));
  const withBlocks = [row('gate', '2026-10-30', {...gateDay({}), hooks: {'session-cap': 2, 'background-tee': 1}})];
  const html = sdlcPage(withBlocks, now);
  assert.ok(html.includes('session-cap <b>2</b>') && html.includes('background-tee <b>1</b>'));
  assert.ok(!html.includes('not measured yet: no hook'));
});

// Owner, 2 Nov 2026: "make this graph's circles clickable or with tooltips; bring it, smaller, to the overview of Agent Coding".
const chartRows = [row('sdlc', '2026-10-30', sdlcDay({pr: {'CI · Tests · python': {runs: 40, fails: 9, secs: 8000, catches: catches({product: 3, test: 1})}, 'CI · Lint': {runs: 60, fails: 0, secs: 120, catches: catches()}}})),
  row('gate', '2026-10-30', gateDay({'desktop (clean checkout)': {runs: 30, fails: 4, secs: 2400, cls: 'real'}}))];

test('every circle is a link to its row in the table with the shared tooltip: name, layer, time per run, real catches per 100 runs and runs; no native <title>; focusable', () => {
  const html = sdlcPage(chartRows, now), svg = html.slice(html.indexOf('<svg class="ac-scatter'), html.indexOf('</svg>'));
  const dots = [...svg.matchAll(/<a class="ac-dot" href="(#[^"]+)" data-tip="([^"]+)" aria-label="([^"]+)">/g)];
  assert.equal(dots.length, 3, 'one per check with enough runs');
  assert.ok(!svg.includes('<title>'));
  for (const [, href, tip, label] of dots) {
    assert.ok(html.includes(`<tr id="${href.slice(1)}">`), `${href} is a row of the table`);
    assert.equal(tip, label);
    assert.match(tip, /· (Push gate|PR checks|Main|Beta \/ nightly) · .+ per run · [\d.]+ real catches per 100 runs · \d+ runs$/);
  }
  assert.ok(dots.some(([, , tip]) => tip.startsWith('CI · Tests · python · PR checks · 3.3 min per run · 10 real catches per 100 runs · 40 runs')), dots.map(d => d[2]).join(' | '));
  assert.ok(html.includes('<div id="tip" role="tooltip" hidden></div>'), 'the page has the shared tooltip');
  assert.equal(checkId({layer: 'pr', name: 'CI · Tests · python'}), 'check-pr-ci-tests-python');
});

test('the Overview card is the same chart, smaller, each circle going to its row on the SDLC tab, and the card links to the full chart; nothing to show means no card', () => {
  const html = checksCard(chartRows, now), full = sdlcPage(chartRows, now);
  assert.match(html, /<svg class="ac-scatter ac-small"/);   // Why (Gitar on #299): not `small`: the Overview's own `.small{margin-left:18px}` rule would shift the chart
  assert.ok(!/class="([^"]* )?small[ "]/.test(html.slice(html.indexOf('<svg'), html.indexOf('</svg>'))), 'no generic small class on the chart');
  const links = [...html.matchAll(/<a class="ac-dot" href="([^"]+)"/g)].map(m => m[1]), fullLinks = [...full.matchAll(/<a class="ac-dot" href="#([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, fullLinks.map(id => `/admin/agents/agent-coding?tab=sdlc#${id}`));
  assert.ok(html.includes('href="/admin/agents/agent-coding?tab=sdlc">Open the full chart and table'));
  assert.equal(checksCard([], now), '');
  assert.equal(checksCard([row('sdlc', '2026-10-30', sdlcDay({pr: {'CI · Few': {runs: 5, fails: 0, secs: 10, catches: catches()}}}))], now), '', 'under 20 runs is not placed');
});
