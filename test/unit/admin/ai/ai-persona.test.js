// /admin/testing/ai-persona: the run list and one run (path, notes, video), drawn from what CI uploaded. The page, the owner-only view, the menu entry and the route; a stored text never becomes markup.
// Guard: privacy — only a signed-in admin opens a run's page, and what the agent saw (a title, a page's words) is escaped, never drawn as HTML.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from '../../../../workers/www/index.js';
import {PAGES} from '../../../../admin/admin.js';
import {METHODS, PLANNED} from '../../../../admin/testing-overview-methods.js';
import {view} from '../../../../admin/ai-persona.js';
import {boxOf, listHtml, mmss, pathOf, runHtml, tidy} from '../../../../admin/ai-persona-page.js';

const note = (extra = {}) => ({goal: 1, title: 'Open question is missing', type: 'ux', kind: 'empty-state', severity: 'medium', view: 'settings', expected: 'a list', observed: 'empty under "1 of 1 open"', why: 'the count says 1',
  judge: 'agrees', judgeReason: 'r', filed: true, shot: 1, videoSec: 94, control: {x: 144, y: 90, w: 72, h: 45, window: {w: 1440, h: 900}}, trail: [], ...extra});
const record = (extra = {}) => ({run: '41857218091', at: '2026-11-04T15:00:00Z', kind: 'replay', commit: 'df66db1', plan: 'learned-questions', persona: 'Ana', seed: 1, stopped: 'goals',
  goals: [{n: 1, group: 'settings', label: 'Open What we learned', verdict: 'could-not-finish', summary: 'it kept doing the same thing', steps: 6}, {n: 2, group: 'jobs', label: 'Open a job', verdict: 'worked', summary: 'ok', steps: 2}],
  notes: [note()], trace: [{goal: 1, n: 1, did: 'Press "Expand all"'}, {goal: 1, n: 2, did: 'Press "Expand all"'}, {goal: 1, n: 3, did: 'Press "Expand all"'}, {goal: 1, n: 4, did: 'Press "Open"', failed: true}, {goal: 2, n: 5, did: 'Open job'}],
  cost: {calls: 14, tokens: 5000, minutes: 2}, video: {secs: 600, bytes: 5000000}, ...extra});
const row = (extra = {}) => ({run: '41857218091', at: '2026-11-04T15:00:00Z', kind: 'replay', commit: 'df66db1', plan: 'learned-questions', worked: '0', bug: '1', doubts: '0', stuck: '1', notes: '2', calls: '14', tokens: '5000', minutes: '2', video: true, videoBytes: 5242880, shots: 1, ...extra});

test('the list labels a replay, counts goals that reached an answer and says when no run is kept', () => {
  const html = listHtml([row(), row({run: '41860000001', kind: 'night', plan: '', stuck: '0', worked: '2', bug: '0', video: false})]);
  assert.match(html, /2 runs kept, 3 of 4 goals reached an answer/);
  assert.match(html, /<a href="\?run=41857218091">/);
  assert.match(html, /chip warn">replay</);
  assert.match(html, /chip good">night</);
  assert.match(html, /▶ 5\.0 MB/);
  assert.match(html, /chip off">none</);
  assert.match(listHtml([]), /No run is kept yet/);
});

test('a run shows its path with repeats counted, the failed step, a marker per note and the control boxed in percent of the window', () => {
  assert.deepEqual(pathOf(record().trace, 1), [{did: 'Press "Expand all"', times: 3, failed: false}, {did: 'Press "Open"', times: 1, failed: true}]);
  const html = runHtml(record(), {video: true});
  assert.match(html, /×3/);
  assert.match(html, /<li class="failed">/);
  assert.match(html, /<video id="run-video"[^>]*name=video\.webm/);
  assert.match(html, /class="dot" data-t="94" style="left:15\.7%"/);
  assert.match(html, /data-t="94">▶ 1:34</);
  assert.match(html, /name=shot-1\.png/);
  assert.equal(boxOf(record().notes[0].control), '<i class="box" style="left:10%;top:10%;width:5%;height:5%"></i>');
  assert.equal(boxOf(null), '');
  assert.equal(boxOf({x: 1, y: 1, w: 0, h: 5, window: {w: 10, h: 10}}), '');
  assert.equal(mmss(61), '1:01');
  assert.equal(mmss(NaN), '');
});

test('without a video or a screenshot there is no player, no marker and no picture, and the page says so', () => {
  const html = runHtml(record({video: null, notes: [note({shot: 0, videoSec: null, control: null})]}), {});
  assert.match(html, /No video was kept/);
  assert.doesNotMatch(html, /<video|class="dot"|<img|class="jump"/);
});

test('what the agent saw is escaped: a title or a step with markup is text, never HTML', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = runHtml(record({notes: [note({title: evil, observed: evil})], trace: [{goal: 1, did: evil}], goals: [{n: 1, group: evil, label: evil, verdict: 'bug', summary: evil, steps: 1}]}), {video: true});
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(listHtml([row({commit: evil, plan: evil})]), /<img src=x/);
});

test('only the owner opens the page; an unknown run is a 404 page, a run id that is not a number is the list', async () => {
  const kept = new Map([['agent/41857218091/run.json', JSON.stringify(record())], ['agent/41857218091/video.webm', 'v']]);
  const bucket = {head: async name => (kept.has(name) ? {size: 1} : null), get: async name => (kept.has(name) ? {text: async () => kept.get(name)} : null),
    list: async () => ({objects: [{key: 'agent/41857218091/run.json', customMetadata: row()}], truncated: false})};
  const env = {LAB_FILLS: bucket, STATS_API_KEY: 'owner-key', STATS_KEY: 'k'};
  const ask = (query, auth = 'owner-key') => view(new Request(`https://x.test/admin/testing/ai-persona${query}`, {headers: auth ? {Authorization: `Bearer ${auth}`} : {}}), env);
  assert.equal((await ask('', '')).status, 404);
  assert.equal((await ask('?run=41857218091', 'wrong')).status, 404);
  assert.match(await (await ask('')).text(), /1 run kept/);
  assert.match(await (await ask('?run=41857218091')).text(), /Open question is missing/);
  assert.equal((await ask('?run=41999999999')).status, 404);
  assert.match(await (await ask('?run=../../x')).text(), /1 run kept/);
});

test('the tab is in the Testing menu, answers on its route, and the Overview card for it is live (no longer planned)', async () => {
  const entry = PAGES.find(page => page.path === '/admin/testing/ai-persona');
  assert.equal(entry?.group, 'Testing');
  assert.equal(METHODS.find(method => method.id === 'agents')?.href, entry.path);
  assert.equal(PLANNED.some(card => card.id === 'agents'), false);
  assert.equal((await worker.fetch(new Request('https://www.jobadabra.top/admin/testing/ai-persona'), {})).status, 404);
});

test('a record written by another repo\'s job never breaks the page: odd shapes and prototype words are drawn as unknown, not as a 500', () => {
  for (const odd of [{goals: [null], notes: [null], trace: 'x'}, {goals: {}, notes: 'x', trace: null}, {goals: [{n: 1, verdict: 'constructor', label: 'x'}], notes: [{judge: '__proto__', severity: 'constructor', shot: 'abc', videoSec: -5, title: 't'}]},
    {goals: [{n: 1, verdict: 'skipped'}], notes: [{shot: 1.5}, {shot: 150}], trace: [null, {goal: '1', action: 'click'}, {goal: '1', action: 'click'}]}]) {
    const html = runHtml(record(odd), {video: true});
    assert.match(html, /Run 41857218091/);
    assert.doesNotMatch(html, /shot-(NaN|150|1\.5)|undefined|NaN%/);
  }
  assert.deepEqual(pathOf([{goal: '1', action: 'click'}, {goal: '1', action: 'click'}], 1), [{did: 'click', times: 2, failed: false}]);
  assert.match(listHtml([{run: '1', worked: undefined, bug: 'x', stuck: null, doubts: '', notes: '0'}]), /1 run kept, 0 of 0 goals/);
});

test('a jump button and a dot exist only for a note whose second lies inside a video that is kept', () => {
  const rec = record({video: {secs: 100}, notes: [note({videoSec: 50}), note({videoSec: 150, title: 'late'}), note({videoSec: -5, title: 'early'})]});
  assert.deepEqual(tidy(rec, true).notes.map(each => each.playable), [true, false, false]);
  assert.equal((runHtml(rec, {video: true}).match(/class="dot"/g) || []).length, 1);
  assert.equal((runHtml(rec, {video: true}).match(/class="jump"/g) || []).length, 1);
  assert.doesNotMatch(runHtml(rec, {video: false}), /class="dot"|class="jump"/, 'the record names a video that was not kept: no button that does nothing');
});

test('a goal with a verdict we do not know is on neither page\'s count, so the list and the run agree', () => {
  const html = runHtml(record({goals: [{n: 1, group: 'g', label: 'a', verdict: 'worked', steps: 1}, {n: 2, group: 'g', label: 'b', verdict: 'skipped', steps: 1}]}), {});
  assert.match(html, /1 of 1 goal reached an answer/);
});
