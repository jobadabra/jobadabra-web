// /admin/testing/overview: a method line that only runs by hand (debugging) is labelled that way and its last run never paints the card red.
// Incident (1 Nov 2026, owner: "let's fix this"): the Real-site pool card was red from "Offline replays · with the nightly run ✗ red · 5 days ago", a by-hand run of site-replays.yml,
// a workflow that has had no schedule since 17 Oct 2026 (owner: "Replays stay for debugging only").
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from '../../../admin/testing-overview-data.js';
import {lastChip} from '../../../admin/testing-overview.js';

const now = new Date('2026-11-01T12:00:00Z'), repo = 'GarryOne/jobadabra';
const run = (conclusion, at, n) => ({at, conclusion, mins: 3, url: `https://github.com/${repo}/actions/runs/${n}`});
const job = (file, name, recent, crons = []) => ({repo, file, name, about: '', crons, source: 'github', manual: true, disabled: false, ai: false, weeklyMin: 0, billedMin: 0, recent});
const data = () => ({repo, now, schedules: {jobs: [job('site-replays.yml', 'CI · Replay check', [run('failure', '2026-10-27T10:00:00Z', 7)]),
  job('record-sites.yml', 'CI · Record sites', [run('success', '2026-11-01T07:00:00Z', 8)], ['0 7 * * *'])]}});
const pool = model => model.rings.flatMap(ring => ring.cards).find(card => card.id === 'pool');

test('the offline replays line says "by hand", keeps its last run as information, and does not make the card red', () => {
  const model = resolve(data()), card = pool(model), replays = card.lines[0];
  assert.equal(replays.label, 'Offline replays');
  assert.equal(replays.when, 'by hand, for debugging');
  assert.deepEqual([replays.last.state, replays.last.was, replays.last.at], ['hand', 'red', '2026-10-27T10:00:00Z']);
  assert.equal(replays.last.url, `https://github.com/${repo}/actions/runs/7`, 'the run is still one click away');
  assert.equal(card.state, 'green', 'the daily Recording run decides the card');
  assert.ok(!model.red.includes(card.title), 'and the red list does not name it');
  assert.ok(!card.days.some(day => day.state === 'red'), 'a by-hand run paints no red day');
});

test('the chip reads "by hand · last run" in grey, says what it ended as, and never "red"', () => {
  const html = lastChip(pool(resolve(data())).lines[0].last, now);
  assert.match(html, /by hand · last run 5 days ago/);
  assert.match(html, /class="chip off"/);
  assert.doesNotMatch(html, /✕ red/);
  assert.match(html, /ended red/);
});
