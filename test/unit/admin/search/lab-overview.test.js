// The Lab's Overview (owner, 12 Nov 2026: "also, let's have an overview page" · "For both Job search and Lab"): one number per Lab tab with its tab's own verdict, the cards, and the same
// numbers as Job search → Overview's Lab tiles. Guard for admin/lab-overview.js and admin/lab-overview-data.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PRESS_LIMIT_S, labTabs, overviewSection} from '../../../../admin/lab-overview.js';
import {labData} from '../../../../admin/lab-overview-data.js';
import {HEADLINES} from '../../../../admin/headlines.js';

const now = new Date('2026-11-12T10:00:00Z');
const night = (day, measured, more = {}) => ({night: `2026-11-${day}`, total: 18, measured, dropped: measured < 12, notRun: false, rows: [], ...more});
const draw = (day, more = {}) => ({draw_date: `2026-11-${day}`, family: 'legal', city: 'Porto', country: 'Portugal', state: 'ok', first_s: 40, in_places: 12, scored: 8, fit70: 0, role: 'Patent Clerk', ...more});
const report = (day, first) => ({install: 'i1', day: `2026-11-${day}`, family: 'finance_admin', first_s: first, first_fit70_s: null, in_places: 3, fit70: 0});
const own = (local, kind = 'measured') => ({kind, local, sources: {}});
const data = {nights: [night('11', 5, {eures: 'off', rows: [own(10), own(5), own(0)]}), night('10', 12)], hand: [], real: [report('10', 60), report('11', 120)],
  draws: [draw('11', {fit70: 2}), draw('10'), draw('09', {role: null, in_places: 155})], checks: [{session: 'eu', run_at: '2026-11-05T19:44:00Z'}, {session: 'js', run_at: '2026-11-01T22:00:00Z'}]};

test('each Lab tab gives its number and the verdict its own tab shows', () => {
  const tabs = Object.fromEntries(labTabs(data, now).map(entry => [entry.tab, entry]));
  assert.deepEqual([tabs.night.value, tabs.night.status], ['5 / 18', 'bad'], 'a dropped night is red, as on Night search');
  assert.deepEqual([tabs.finish.value, tabs.finish.status], ['15', 'warn'], 'right jobs from our own sources on the newest EURES-off run; 2 of 3 people');
  assert.deepEqual([tabs.real.value, tabs.real.status], ['1:00', 'good'], `the Real installs tab's median; first job inside the press limit (${PRESS_LIMIT_S} s)`);
  assert.deepEqual([tabs.draws.value, tabs.draws.status], ['1 / 2', 'good'], 'only the robot draws (a made-up role) count; half or more reaching a 70+ job is green, as the Random draws band');
  assert.deepEqual([tabs.checks.status, /quiet 6 days/.test(tabs.checks.sub)], ['warn', true]);
});

test('no data is a grey "no data", never a 0 that looks measured; unreadable nights say so', () => {
  const tabs = labTabs({nights: null, hand: [], real: [], draws: [], checks: []}, now);
  assert.ok(tabs.every(entry => entry.status === 'none' && entry.value === '–'));
  assert.match(tabs[0].sub, /could not be read/);
});

test('the Overview tab draws a band and one card per tab, each with a link to its tab', () => {
  const html = overviewSection(data, now);
  assert.match(html, /Last night 5 of 18 people had a right job/);
  for (const tab of ['night', 'finish', 'real', 'draws', 'checks']) assert.match(html, new RegExp(`href="\\?tab=${tab}"`));
  assert.match(html, /<svg class="vz-cols"/);
});

test('Job search → Overview shows the same four Lab numbers, linked to their tabs', async () => {
  const tiles = await HEADLINES['/admin/job-search/lab']({}, now);
  assert.deepEqual(tiles.map(tile => tile.href), ['night', 'finish', 'real', 'draws'].map(tab => `/admin/job-search/lab?tab=${tab}`));
  assert.deepEqual(await labData({}, now), {nights: [], hand: [], real: [], draws: [], checks: []});
});
