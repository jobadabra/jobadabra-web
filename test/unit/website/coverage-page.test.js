// /coverage shows the owner's kind × country heatmap (27 Oct 2026: "let's publish this graph ... mention that users job search are not limited
// to this, but this is just the app internal database"): the note sits right above the chart, the table comes from /api/coverage (the admin's
// renderer, public cut), and the per-field bars it repeats are gone, so no number shows twice.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../../../web/public/coverage.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../web/public/pages.css', import.meta.url), 'utf8');

test('the note says the list is not the limit of a search, right above the chart', () => {
  const note = page.indexOf('class="heat-note"'), chart = page.indexOf('data-cov-heat');
  assert.ok(note > 0 && chart > note && chart - note < 800, 'the note comes just before the chart');
  const text = page.slice(note, chart);
  for (const words of [/not the limit of your search/, /already knows and checks every day/, /job boards/, /across the web/, /employers you add/]) assert.match(text, words);
});

test('the table comes from the coverage API, drawn by the shared renderer; the per-field bars it repeats are gone', () => {
  assert.match(page, /heat\.innerHTML = data\.heat\.table/);
  assert.doesNotMatch(page, /data-cov-bars="kinds"|data-cov-other/);
  assert.match(page, /data-cov-bars="countries"/, 'the country totals are not in the table, so their bars stay');
});

test('the table scrolls inside its card and every colour step is painted from the site\'s tokens', () => {
  assert.match(css, /\.heat-card \.scroll \{ overflow-x: auto;/);
  for (const step of ['0', '1', '2', '3', '4', '5', '6', 'n']) assert.match(css, new RegExp(`\\.heat-card \\.h${step} \\{ background: (var|color-mix)\\(`));
});

test('job boards across Europe: after the employers, before "on top of the list"; filled from /api/coverage; no method words (owner, 12 Nov 2026: IP stays private)', () => {
  const boards = page.indexOf('id="boards"'), countries = page.indexOf('id="countries"'), yours = page.indexOf('id="yours"');
  assert.ok(countries > 0 && boards > countries && yours > boards);
  const section = page.slice(boards, yours);
  assert.match(section, /hidden data-cov-boards/, 'hidden until the API has boards');
  assert.doesNotMatch(section, /scout|3\+|measured|discovery|brand/i);
  assert.match(page, /map\.innerHTML = b\.map/);
  assert.match(css, /\.reach-map \{ display: grid; grid-template-columns: repeat\(8,/);
});
