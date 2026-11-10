// A night that did not run (cr 2/6, 10 Nov 2026): every person's press AI was refused by both Codex and Claude, so the row kind is 'not-run' and the verdict state 'not-run'. It is no result: never a drop (no alert),
// never 0 jobs on a chart, never in a baseline. Guard for the not-run paths of admin/search-night.js, search-night-judge.js, search-night-page.js, search-night-trend.js, search-night-scoreboard.js, product-quality-search.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KINDS, NOT_MEASURED, clean} from '../../../../admin/search-night.js';
import {judgeAll, notRunOf} from '../../../../admin/search-night-judge.js';
import {nightSection} from '../../../../admin/search-night-page.js';
import {groupHtml, groups} from '../../../../admin/search-night-trend.js';
import {scoreOf, scoreboardSection, series} from '../../../../admin/search-night-scoreboard.js';

const NOW = new Date('2026-11-19T09:00:00Z');
const ok = persona => ({persona, label: `p${persona} Role, Place`, kind: 'measured', why: '', local: 3, found: 9, seconds: 100});
const refused = persona => ({persona, label: `p${persona} Role, Place`, kind: 'not-run', why: 'not run: subs: codex 429, claude 529', local: null, found: null, seconds: null});
const night = (day, rows, state = 'success') => clean({state, head: state === 'not-run' ? '⚪ not run: codex 429, claude 529' : 'measured', rows}, {night: day}, NOW);
const eighteen = make => Array.from({length: 18}, (_, i) => make(i + 1));

test('the kind and the state are kept; not-run counts as not measured, never as a result', () => {
  assert.ok(KINDS.includes('not-run'));
  assert.ok(NOT_MEASURED.includes('not-run'));
  const stored = night('2026-11-18', eighteen(refused), 'not-run');
  assert.equal(stored.state, 'not-run');
  assert.equal(stored.rows[0].kind, 'not-run', 'not mapped to unknown');
  assert.equal(notRunOf(stored), true);
  assert.equal(notRunOf(night('2026-11-17', [ok(1), refused(2)])), false, 'one refused person is a not measured person, not a not-run night');
  assert.deepEqual([scoreOf(stored).right, scoreOf(stored).blind], [0, 18], 'the Scoreboard counts them as not measured (grey)');
});

test('a not-run night is not a drop (no alert), is no baseline for the nights after it, and the tab says "not run"', () => {
  const history = [3, 4, 5, 6, 7, 8, 9].map(i => night(`2026-11-0${i}`, eighteen(ok)));
  const nights = [night('2026-11-18', eighteen(refused), 'not-run'), ...history.reverse()];
  const [verdict] = judgeAll(nights);
  assert.deepEqual([verdict.notRun, verdict.dropped, verdict.reasons], [true, false, []], 'measured 0 of 18 is not a drop here');
  assert.match(nightSection(judgeAll(nights), {}, []), /not run \(no AI answered\)/);
  const next = judgeAll([night('2026-11-19', eighteen(ok)), ...nights])[0];
  assert.equal(next.dropped, false, 'the night after it is judged against the real nights only');
});

test('a chart never draws a not-run night as zero: the Day by day card and the Scoreboard show a gap that says why', () => {
  const nights = judgeAll([night('2026-11-18', eighteen(refused), 'not-run'), night('2026-11-17', eighteen(ok)), night('2026-11-16', eighteen(ok))]);
  const html = groupHtml(groups(nights)[0]);
  assert.match(html, /not run \(no AI answered\): not a zero/);
  assert.doesNotMatch(html, /found 0 of 18/);
  assert.equal(series(nights, []).span.length, 2, 'the Scoreboard span ends at the last night that ran');
  assert.match(scoreboardSection(nights, []), /id="night-scoreboard"/);
});
