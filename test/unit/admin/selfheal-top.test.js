// The "Top issues" card of the Self-healing page (admin/selfheal-cards.js): the ranking a snapshot carries, drawn for the owner; it replaces the pinned GitHub issue #1892.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {liveSection} from '../../../admin/selfheal.js';
import {topIssuesSection} from '../../../admin/selfheal-cards.js';

const ranking = {open: 3, counts: {P0: 0, P1: 1, P2: 0, P3: 2}, rows: [
  {number: 3158, title: 'desktop/renderer: Disabled choice hides running server controls', priority: 'P1', platform: 'Mac', score: 8, needsPerson: true, clean: false, build: '3cdc003', days: 0, url: 'https://github.com/jobadabra/jobadabra/issues/3158'},
  {number: 3242, title: 'src: Page town lost <b>without</b> structured location', priority: 'P3', platform: 'Windows', score: 2, needsPerson: false, clean: true, build: '97f518d', days: 8, url: 'javascript:alert(1)'},
  {number: 3084, title: 'desktop/lib: CLI excluded', priority: 'P9', platform: 'Mac', score: 1, build: '', days: null}]};

test('positive control: the card draws the counts, one row per finding, the person and clean notes, and the age', () => {
  const html = topIssuesSection({ranking});
  assert.match(html, /<h2>🔥 Top issues<\/h2>/);
  assert.match(html, /P1 · 1/);
  assert.equal((html.match(/<tr><td class="n">/g) || []).length, 3);
  assert.match(html, /<a href="https:\/\/github\.com\/jobadabra\/jobadabra\/issues\/3158">#3158<\/a>/);
  assert.match(html, /needs a person/);
  assert.match(html, /clean last run/);
  assert.match(html, /8 d ago ⚠️/);
  assert.match(html, /· today/);
});

test('the snapshot is another repo\'s data: titles are escaped, a link that is not a GitHub issue is not a link, an unknown priority is P3', () => {
  const html = topIssuesSection({ranking});
  assert.doesNotMatch(html, /<b>without<\/b>/);
  assert.match(html, /&lt;b&gt;without&lt;\/b&gt;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /P9/);
});

test('no ranking in the snapshot (published before 5 Nov 2026): no card; nothing open: a green "nothing open" line', () => {
  assert.equal(topIssuesSection({}), '');
  assert.equal(topIssuesSection(null), '');
  assert.match(topIssuesSection({ranking: {open: 0, counts: {}, rows: []}}), /nothing open/);
});

test('the Self-healing page puts the card under the tiles', () => {
  const html = liveSection({at: '2026-11-05T12:00:00Z', totals: {}, byDetector: [], ranking});
  assert.ok(html.indexOf('id="top-issues"') > html.indexOf('class="tiles"'));
});
