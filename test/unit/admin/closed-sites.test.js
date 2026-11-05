// /admin/job-search/scouting closed sites table (site/src/closed-sites.js): reasons, agreement, retry dates, served flag and the page wiring.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AGREE, REASONS, deadEndRow, factRow} from '../../../shared/closed-sites.js';
import {retryOn, section} from '../../../admin/closed-sites.js';
import {page} from '../../../admin/scoutingadmin.js';

const today = new Date('2026-10-20T10:00:00Z');
test('a dead end takes the word enough installs gave, and is served only when they agree', () => {
  const base = {company: 'Nord', host: 'nord.example', first: '2026-09-01', last: '2026-10-18'};
  assert.deepEqual([deadEndRow({...base, refused: 3}).reason, deadEndRow({...base, refused: 3}).served], ['refused', true]);
  assert.deepEqual([deadEndRow({...base, refused: 2}).reason, deadEndRow({...base, refused: 2}).served], ['refused', false], 'two installs: an opinion, not served');
  assert.deepEqual([deadEndRow({...base, unreachable: 3, refused: 1}).reason], ['unreachable']);
  assert.deepEqual([deadEndRow({...base, none: 1}).reason, deadEndRow({...base, none: 1}).served], ['no_feed', true], 'no feed is served after one');
});
test('site facts: refused and browser-only routes, browser and gone pages; other routes are not closed', () => {
  const r = {host: 'a.example', installs: AGREE, first: '2026-10-01', last: '2026-10-10'};
  assert.equal(factRow({...r, kind: 'route', body: '"refused"'}).reason, 'refused');
  assert.equal(factRow({...r, kind: 'route', body: '"browser_only"'}).reason, 'browser_only');
  assert.equal(factRow({...r, kind: 'browser'}).reason, 'browser_only');
  assert.equal(factRow({...r, kind: 'dead'}).reason, 'page_gone');
  assert.equal(factRow({...r, kind: 'route', body: '"api"'}), null);
  assert.equal(factRow({...r, kind: 'route', body: '"refused"', installs: 2}).served, false);
});
test('the retry date is last seen plus the reason\'s rest, or "due now"', () => {
  assert.equal(retryOn({reason: 'refused', last: '2026-10-18'}, today), '2026-11-17');
  assert.equal(retryOn({reason: 'unreachable', last: '2026-10-19'}, today), '2026-10-26');
  assert.equal(retryOn({reason: 'unreachable', last: '2026-10-10'}, today), 'due now');
});
test('the section lists every reason as a filter chip with its count and links to /admin/job-search/installs', () => {
  const rows = Object.keys(REASONS).map((reason, i) => ({site: `s${i}.example`, label: '', reason, installs: 3, first: '2026-10-01', last: '2026-10-18', served: true, source: 'dead end'}));
  const html = section(rows, today);
  for (const key of Object.keys(REASONS)) assert.match(html, new RegExp(`data-closed="${key}"[^>]*>${REASONS[key].label} · 1`), key);
  for (const row of rows) assert.match(html, new RegExp(`data-reason="${row.reason}"`));
  assert.match(html, /href="\/admin\/job-search\/installs"/);
  assert.match(section([], today), /Nothing reported yet/);
});
test('the scouting page draws the section and escapes names', () => {
  const html = page({feeds: [], daily: [], sharing7: 0, sharing30: 0, shared: 0, routes: [], useful: [], dead: [], deadTotal: 0, central: null,
    closed: [{site: '<b>x</b>.example', label: '', reason: 'refused', installs: 3, first: '2026-10-01', last: '2026-10-18', served: true, source: 'site route'}]}, undefined, today);
  assert.match(html, /Closed sites · 1/);
  assert.doesNotMatch(html, /<b>x<\/b>\.example/);
});
