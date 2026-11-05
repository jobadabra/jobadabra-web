// The search robot's alarm (jobs/persona-search/search-alarm.mjs, draw-alarm.mjs; owner 26 Oct 2026): one issue per field × place × path in the Finder's style, a sighting is a
// comment, a pass closes it; the draw's reasons come from 0 relevant jobs, a crash, or floors from the draws' own numbers (admin/search-lab-draws.js judge), never a guessed one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act, body, fingerprint, labels, title} from '../../../jobs/persona-search/search-alarm.mjs';
import {caseOf} from '../../../jobs/persona-search/draw-alarm.mjs';
import {judge} from '../../../admin/search-lab-draws.js';

// The owner's pilot search, 25 Oct 2026 (sketch G8YCgX65wGvK69PKsvd6Qq): 1,025 of 2,907 employers, 1 board, 0 web searches, 81,070 jobs, 0 relevant.
const PILOT_INFO = {seed: '2026-10-25', kind: 'other', role: {title: 'First Officer'}, place_kind: 'region', place: 'Europe', city: 'Milan', country: 'Italy', path: 'first', engine: 'api'};
const PILOT_PRESS = {in_places: 14781, scored_in_places: 3, fit70_in_places: 0, crashes: [], ttfr: {},
  funnel: {employers_picked: 1025, employers_in_places: 2907, kinds: ['finance_admin'], employer_sites_read: 997, boards_read: 1, board_jobs: 0, board_relevant: 0, web_searches: 0, web_found: 0, looked: 81070, matches: 1, ai_usd: 0.4}};

function fakeGh(open = []) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(open);
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/GarryOne/jobadabra/issues/1999';
    return '';
  };
  return {run, calls};
}

test('the pilot run files one high issue named by role, place and path, with its funnel', () => {
  const c = caseOf(PILOT_INFO, [PILOT_PRESS], null);
  assert.deepEqual(c.why, ['0 relevant jobs (fit 70+) in the places']);
  assert.equal(title(c), '[auto-search] First Officer · Europe · first search: 0 relevant jobs');
  assert.equal(fingerprint(c), 'search-other-europe-first');
  assert.deepEqual(labels(c).slice(0, 4), ['auto-search', 'kind:search-gap', 'source:random-draw', 'severity:high']);
  const text = body(c);
  for (const row of ['| Employers picked | 1,025 of 2,907 |', '| … for the kinds | finance_admin |', '| Job boards read | 1 |', '| Web searches · sources found | 0 · 0 |', '| Jobs listed | 81,070 |', '| Relevant (fit 70+) | 0 |']) assert.ok(text.includes(row), row);
  const gh = fakeGh();
  assert.equal(act(c, {run: gh.run}), 'filed #1999');
  assert.ok(gh.calls.some(args => args[1] === 'create' && args.includes('fp:search-other-europe-first')));
});

test('a second sighting comments on the open issue; a pass closes it; a pass with none open does nothing', () => {
  const c = caseOf(PILOT_INFO, [PILOT_PRESS], null);
  let gh = fakeGh([{number: 1999}]);
  assert.equal(act(c, {run: gh.run}), 'seen again #1999');
  assert.ok(!gh.calls.some(args => args[1] === 'create'), 'no duplicate issue');
  gh = fakeGh([{number: 1999}]);
  assert.equal(act(c, {pass: true, run: gh.run}), 'closed #1999');
  assert.equal(act(c, {pass: true, run: fakeGh().run}), 'nothing');
});

test('one fingerprint per field × place × path, whatever role the AI made up', () => {
  const a = caseOf(PILOT_INFO, [PILOT_PRESS], null), b = caseOf({...PILOT_INFO, role: {title: 'Helicopter Pilot'}}, [PILOT_PRESS], null);
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(caseOf({...PILOT_INFO, path: 'field-change'}, [PILOT_PRESS, PILOT_PRESS], null)));
  assert.equal(fingerprint(caseOf({...PILOT_INFO, place_kind: 'remote', place: 'remote'}, [PILOT_PRESS], null)), 'search-other-remote-first');
});

test('the upload answer (every earlier draw) wins over the draw alone', () => {
  const c = caseOf(PILOT_INFO, [{...PILOT_PRESS, fit70_in_places: 4}], {ok: true, alarm: ['4 relevant jobs, under the lowest tenth of 12 draws (5)'], severity: 'medium'});
  assert.deepEqual([c.why.length, c.severity, title(c).endsWith('few relevant jobs')], [1, 'medium', true]);
  assert.equal(caseOf(PILOT_INFO, [{...PILOT_PRESS, fit70_in_places: 4}], null).why.length, 0, 'alone, 4 relevant jobs is no alarm: no guessed floor');
});

const row = (day, more = {}) => ({draw_date: `2026-10-${String(day).padStart(2, '0')}`, family: 'nurse', state: 'ok', fit70: 8, fit_s: 400, in_places: 60, ...more});
test('floors come from the draws: lowest tenth of relevant jobs and slowest tenth to the first, after 10 draws', () => {
  const pool = Array.from({length: 10}, (_, i) => row(i + 1, {fit70: 5 + i, fit_s: 300 + 10 * i}));
  const [last] = judge([row(20, {fit70: 4, fit_s: 900}), ...pool].sort((a, b) => b.draw_date.localeCompare(a.draw_date)));
  assert.equal(last.alarm.length, 2);
  assert.match(last.alarm[0], /4 relevant jobs, under the lowest tenth of 10 draws \(5\)/);
  assert.match(last.alarm[1], /first relevant job at 900 s, slower than the slowest tenth of 10 draws \(390 s\)/);
  assert.equal(judge([row(20, {fit70: 4, fit_s: 900}), ...pool.slice(0, 9)])[0].alarm.length, 0, 'under 10 earlier draws: no data floor yet');
  assert.deepEqual(judge([row(20, {in_places: 3})])[0].alarm, [], 'the fixed 10-jobs floor is shown, never filed');
  assert.equal(judge([row(20, {state: 'failed', failed_step: 'Reading job boards'})])[0].alarm.length, 1);
});

test('the workflow files with an Issues-only app token on main and prints the issue on a branch', async () => {
  const {readFileSync} = await import('node:fs');
  const yml = readFileSync(new URL('../../../.github/workflows/random-draw.yml', import.meta.url), 'utf8');
  assert.match(yml, /repositories: jobadabra\n\s+permission-issues: write/);
  assert.match(yml, /draw-alarm\.mjs "\$RUNNER_TEMP\/draw-out" --verdict "\$RUNNER_TEMP\/verdict\.json" --run "\$RUN_URL" --dry/);
  assert.match(yml, /draw-upload\.mjs .* --answer "\$RUNNER_TEMP\/verdict\.json"/);
});

test('a dry run of a passing draw says it would pass and prints no issue body', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), {spawnSync} = await import('node:child_process');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-alarm-')), folder = path.join(out, 'draw');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'draw.json'), JSON.stringify(PILOT_INFO));
  fs.writeFileSync(path.join(folder, 'presses.jsonl'), `${JSON.stringify({...PILOT_PRESS, fit70_in_places: 3})}\n`);
  const run = spawnSync(process.execPath, [new URL('../../../jobs/persona-search/draw-alarm.mjs', import.meta.url).pathname, out, '--dry'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^WOULD PASS search-other-europe-first/);
  assert.ok(!run.stdout.includes('Below the floor'), 'no empty issue body on a pass');
});
