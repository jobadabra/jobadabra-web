// Testing → Scheduled's graph (admin/schedules-graph.js): the starts of a cron in the next 24 hours, the status bar and the timeline built from the decorated snapshot, only on the Testing tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decorate, page} from '../../../admin/schedules.js';
import {graph, startsIn} from '../../../admin/schedules-graph.js';

const now = new Date('2026-10-20T17:30:00Z');
const run = (hoursAgo, conclusion) => ({at: new Date(now - hoursAgo * 3600000).toISOString(), conclusion, mins: 2, url: ''});
const job = (file, name, crons, extra = {}) => ({repo: 'GarryOne/jobadabra', file, name, about: '', crons, source: 'github', manual: false, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent: [run(2, 'success')], ...extra});
const snapshot = {at: now.toISOString(), repos: [], jobs: [
  job('e2e.yml', 'CI · E2E', ['0 4 * * *'], {recent: [run(2, 'failure'), run(26, 'success')]}),
  job('mutation.yml', 'CI · Mutation', ['30 3 * * 1']),
  job('page-cases.yml', 'Page <b>cases</b>', ['15 * * * *']),
  job('desktop.yml', 'CI · Desktop', ['0 4 * * *'], {disabled: true}),
  job('windows-smoke.yml', 'CI · Windows smoke', ['*/30 * * * *'], {recent: []})]};

test('startsIn lists every start in the next 24 hours and no other', () => {
  assert.equal(startsIn(['15 * * * *'], now).length, 24, 'hourly = 24 starts');
  assert.equal(startsIn(['*/15 * * * *'], now).length, 96);
  assert.deepEqual(startsIn(['0 4 * * *'], now).map(date => date.toISOString()), ['2026-10-21T04:00:00.000Z']);
  assert.deepEqual(startsIn(['0 4 * * *', '0 4 * * *'], now).length, 1, 'two crons on one minute are one start');
  assert.deepEqual(startsIn(['0 18 * * *'], new Date('2026-10-20T18:00:00Z')).map(date => date.toISOString()), ['2026-10-21T18:00:00.000Z'], 'a start at this very minute is not "next"; one exactly 24 h on is');
  assert.deepEqual(startsIn(['30 3 * * 1'], now), [], 'a weekly job whose Monday is later has none');
  assert.deepEqual(startsIn(['nonsense'], now), []);
});

test('the graph shows a bar and a timeline: one row per running job, glyphs on the labels, escaped names', () => {
  const html = graph(decorate(snapshot, now).filter(item => item.crons.length), now);
  assert.match(html, /5 scheduled jobs · by their last run/);
  assert.match(html, /aria-label="[^"]*1 red[^"]*"/);
  assert.match(html, /1 disabled/);
  assert.equal((html.match(/class="tl-row(?: is-red)?"/g) || []).length, 3, 'e2e, page cases and the half-hourly smoke run; the disabled and the Monday job have no row');
  assert.match(html, /<b class="gl">✕<\/b>[^]*?CI · E2E/, 'a red job is marked ✕, not by colour alone');
  assert.match(html, /<b class="gl">◷<\/b>[^]*?CI · Windows smoke/);
  assert.match(html, /start later than 24 hours from now: CI · Mutation/);
  assert.ok(!html.includes('<b>cases</b>') && html.includes('Page &lt;b&gt;cases&lt;/b&gt;'), 'a job name is escaped');
  assert.equal((html.match(/class="t t-green" style=/g) || []).length, 24, 'one tick per hourly start');
});

test('only the Testing area of Scheduled carries the graph', () => {
  assert.match(page(snapshot, {area: 'testing', now}), /Next 24 hours · when each job starts/);
  assert.ok(!page(snapshot, {now}).includes('Next 24 hours'), 'the aggregate keeps its area tiles');
});
