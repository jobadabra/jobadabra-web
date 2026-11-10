// The Scoreboard card of the Night search tab (owner, 10 Nov 2026, via [sa]: "Scoreboard first"): the numbers per night, the grey "not measured" band that a blind night never hides behind, the EURES break at 11 Nov,
// the one-word engine, and the by-hand run stored apart. Guard for admin/search-night-scoreboard.js, search-night-hand.js, the by_hand path of search-night.js and the muted/hand/label forms of admin/viz-time.js.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {clean, engineOf, ingestRoute, nights} from '../../../../admin/search-night.js';
import {handRuns} from '../../../../admin/search-night-hand.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {breakDay, scoreOf, scoreboardSection, series} from '../../../../admin/search-night-scoreboard.js';
import {line} from '../../../../admin/viz-time.js';
import {nightSection} from '../../../../admin/search-night-page.js';

const KEY = 'search-lab-key-0123456789', NOW = new Date('2026-11-19T09:00:00Z');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../../../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args), all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args) ?? null});
  return {prepare: sql => statement(sql)};
}
const put = (env, verdict, query) => ingestRoute(new Request(`https://x/search-check/night?${query}`, {method: 'PUT', headers: {Authorization: `Bearer ${KEY}`}, body: JSON.stringify(verdict)}), env, NOW);
// `seconds` is the press's whole wall time (150 s here), `counters.firstS` the seconds to the first job (the chart reads this one).
const row = (kind, local, firstS = 60, engine = undefined) => ({kind, local, seconds: 150, counters: {firstS}, found: 10, why: '', label: 'p', ...(engine ? {engine} : {})});
// 18 people: 6 with 5+ right jobs, 5 with 1-4, 3 measured but none right, 2 not measured (errored, too slow), 2 where the press found nothing.
const night = (day, extra = {}) => ({night: day, state: 'success', head: 'measured 11 of 18', rows: [...Array(6).fill(0).map(() => row('measured', 6)), ...Array(5).fill(0).map(() => row('measured', 2, 80)), ...Array(3).fill(0).map(() => row('none-right', 0)), row('unmeasured', 0, null), row('fault', null, null), ...Array(2).fill(0).map(() => row('nothing', 0))], ...extra});

test('a night is counted per person: right job, five or more, not measured (never "none right"), right jobs in all, first job as stored', () => {
  const score = scoreOf(night('2026-11-12'));
  assert.deepEqual([score.total, score.right, score.five, score.blind, score.rightJobs, score.first], [18, 11, 6, 2, 6 * 6 + 5 * 2, 60], 'first = the first-job seconds (60), not the press wall time (150)');
  const odd = scoreOf({night: 'x', rows: [row('fault', 7, null), row('measured', 5)]});
  assert.deepEqual([odd.right, odd.five, odd.blind, odd.rightJobs], [1, 1, 1, 5], 'a person who is not measured is in no other band: a fault row with local 7 adds nothing to 5+ or right jobs');
  assert.equal(score.engine, 'unknown', 'a night stored before the engine word reads unknown');
  assert.equal(scoreOf({night: '2026-11-12', rows: [row('none-right', 0), row('nothing', 0)]}).blind, 0, 'a person scored with no right job is a measured bad result, grey is only for "could not measure"');
});

test('the engine is ONE word from the rows: the most used row, engine and model, lower case; unknown when no row names one', () => {
  assert.equal(engineOf([{engine: 'codex (gpt-6-luna)'}, {engine: 'codex (gpt-6-luna)'}, {engine: 'claude (claude-haiku-5-5; codex ran-out)'}]), 'codex-gpt-6-luna');
  assert.equal(engineOf([{engine: 'claude (claude-haiku-5-5; codex ran-out)'}]), 'claude-haiku-5-5', 'a model that starts with the engine is not said twice');
  assert.equal(engineOf([{engine: 'Claude'}, {}]), 'claude');
  assert.equal(engineOf([{engine: 'claude (codex ran-out)'}]), 'claude', 'a fell-back label without a model is not a model');
  assert.equal(engineOf([{engine: 'codex (openai/gpt-5)'}]), 'codex-openai-gpt-5');
  assert.equal(engineOf([{engine: 'n/a'}]), 'unknown');
  assert.equal(engineOf([{engine: 'claude (claude-haiku-5-5) + codex (gpt-6-luna)'}, {engine: 'codex (gpt-6-luna)'}]), 'codex-gpt-6-luna', 'every answer counts, the most used wins');
  assert.equal(engineOf([{}, {engine: '(((' }]), 'unknown');
  assert.equal(engineOf(undefined), 'unknown');
  assert.equal(clean({rows: [{engine: 'codex (gpt-6-luna)'}]}, {night: '2026-11-06'}, NOW).engine, 'codex-gpt-6-luna', 'the stored night carries it');
});

test('the span is continuous: a day with no night is a gap, a by-hand run on a day with none extends it, other candidate counts are left out', () => {
  const kept = [night('2026-11-14'), night('2026-11-12'), {night: '2026-11-13', rows: [row('measured', 3)]}];   // newest first; 13 Nov is a night of another set
  const {total, span} = series(kept.sort((a, b) => b.night.localeCompare(a.night)).filter(item => item.night !== '2026-11-13').concat([{night: '2026-11-13', rows: [row('measured', 3)]}]).sort((a, b) => b.night.localeCompare(a.night)), [{day: '2026-11-15', at: '2026-11-15T14:20:00.000Z', rows: night('x').rows}]);
  assert.equal(series(kept, [{day: '2016-11-12', at: 'x', rows: night('x').rows}]).span.length, 3, 'a by-hand run older than the stored nights does not stretch the span');
  assert.equal(breakDay(span), null, 'no night stored eures off: no break');
  assert.equal(breakDay(series([{...night('2026-11-12'), eures: 'off'}, night('2026-11-11')]).span), '2026-11-12');
  assert.equal(total, 18);
  assert.deepEqual(span.map(item => [item.day, !!item.night, item.hand.length]), [['2026-11-12', true, 0], ['2026-11-13', false, 0], ['2026-11-14', true, 0], ['2026-11-15', false, 1]]);
});

test('the card: three charts, the grey band named, the EURES break with its reason, the AI chips, the by-hand mark, point and table; nothing for no night', () => {
  const kept = [];
  for (let i = 0; i < 6; i++) kept.push(clean({...night('x'), eures: i < 3 ? 'on' : 'off', rows: night('x').rows.map(item => ({...item, engine: i < 4 ? undefined : 'claude (claude-haiku-5-5)'}))}, {night: `2026-11-${String(8 + i).padStart(2, '0')}`}, NOW));
  const judged = judgeAll(kept.reverse());
  const hand = [{day: '2026-11-14', at: '2026-11-14T14:20:00.000Z', engine: 'claude-haiku-5-5', eures: 'off', rows: night('x').rows}, {day: '2026-11-15', at: '2026-11-15T09:40:00.000Z', engine: 'claude-haiku-5-5', eures: 'off', rows: night('x').rows}];
  const html = scoreboardSection(judged, hand);
  assert.match(html, /id="night-scoreboard"/);
  assert.equal((html.match(/<svg/g) || []).length, 3, 'people, right jobs, seconds to the first job');
  assert.match(html, /Not measured/, 'the grey band is in the legend');
  assert.match(html, /var\(--off\)/, 'and drawn grey, never in a result colour');
  assert.match(html, />EURES off</, 'the break pill sits on the first night that stored eures off (11 Nov in the real data)');
  assert.match(html, /another series[^"]*never one line falling/);
  assert.match(html, /AI unknown/);
  assert.match(html, /AI claude-haiku-5-5/);
  assert.match(html, />by hand</, 'a by-hand run is marked');
  assert.match(html, /By-hand runs \(2\)/);
  assert.match(html, /first job in their places/, 'the label as stored');
  assert.equal(scoreboardSection([], []), '');
  assert.equal(scoreboardSection(null, []), '');
  assert.match(nightSection(judged, {}, hand), /id="night-scoreboard"/, 'the tab draws it');
});

test('a line: grey and unjoined across an era, a by-hand point hollow and unjoined; a pill can carry words', () => {
  const points = [{day: '2026-11-09', value: 80, muted: true}, {day: '2026-11-10', value: 82, muted: true}, {day: '2026-11-11', value: 20}, {day: '2026-11-12', value: 25}, {day: '2026-11-13', value: 40, hand: true, mark: {label: 'by hand', tip: 't'}}];
  const svg = line(points, {tone: 's2', percent: false, whole: true});
  assert.equal((svg.match(/<polyline/g) || []).length, 2, 'two eras, two lines, no line from 82 down to 20');
  assert.match(svg, /<polyline[^>]*stroke="var\(--off\)"/);
  assert.match(svg, /<polyline[^>]*stroke="var\(--s2\)"/);
  assert.match(svg, /<circle[^>]*fill="var\(--vz-card[^>]*stroke="var\(--s2\)"/, 'the by-hand dot is hollow');
  assert.match(svg, />by hand</);
});

test('a by-hand upload is stored apart: it never replaces a night of its date, is never judged or alerted, the same run replaces itself, the newest first', async () => {
  const env = {STATS: d1(), REPLAYS_PUBLISH_KEY: KEY};
  assert.equal((await put(env, night('x', {state: 'success', head: 'h'}), 'night=2026-11-12&run=111')).status, 200);
  const first = await put(env, night('x'), 'night=2026-11-12&run=222&by_hand=1');
  assert.deepEqual(await first.json(), {ok: true, byHand: true, day: '2026-11-12', stored: 1});
  await put(env, night('x'), 'night=2026-11-12&run=222&by_hand=1');
  await put(env, {...night('x'), rows: night('x').rows.slice(0, 17)}, 'night=2026-11-13&run=333&by_hand=1');
  const stored = await nights(env), hand = await handRuns(env);
  assert.deepEqual(stored.map(item => [item.night, item.run]), [['2026-11-12', '111']], 'the night is still the night run, not the by-hand one');
  assert.deepEqual(hand.map(item => [item.day, item.run, item.rows.length]), [['2026-11-13', '333', 17], ['2026-11-12', '222', 18]], 'two runs, the repeated upload of 222 is one');
  assert.equal((await put(env, {rows: []}, 'night=2026-11-12&by_hand=1')).status, 400, 'the same checks as a night');
  for (const flag of ['by_hand=true', 'by_hand=0', 'by_hand=', 'by_hand=yes']) assert.equal((await put(env, night('x'), `night=2026-11-12&run=444&${flag}`)).status, 400, `${flag} never reaches the night path`);
  assert.deepEqual((await nights(env)).map(item => item.run), ['111'], 'the real night is untouched');
  assert.equal((await put(env, night('x'), 'night=2026-02-30&by_hand=1')).status, 400, 'a day that does not exist is refused');
  assert.equal((await ingestRoute(new Request('https://x/search-check/night?by_hand=1', {method: 'PUT', body: '{}'}), env, NOW)).status, 404, 'no key, no write');
});
