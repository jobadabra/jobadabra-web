// The homepage's benchmark summary reads the same published data as /benchmark: forms and search cards, ours marked, never the word null, escaped names.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {summary} from '../../../web/public/home-bench.js';
const data = JSON.parse(readFileSync(new URL('../../../web/public/benchmark-start.json', import.meta.url)));

test('shows the starting snapshot: every scored form tool by score, and relevant jobs found per search tool, with dates', () => {
  const html = summary(data);
  assert.match(html, /Form filling/);
  assert.match(html, /Job search/);
  assert.match(html, /27 Oct 2026/);
  for (const t of data.forms.tools.filter(t => t.score != null)) assert.ok(html.includes(t.score + '%'), t.name);
  assert.ok(html.indexOf('Browser Use') < html.indexOf('Jobadabra'), 'sorted by score, ours not forced first');
  assert.match(html, /class="bench-own"/);
  assert.match(html, /Relevant jobs found for the same \d+ fictional job seekers/);
  const best = [...data.search.tools].filter(t => t.relevant != null).sort((a, b) => b.relevant - a.relevant);
  assert.ok(html.includes('<b class="hb-score">' + best[0].relevant + '</b>'), 'counts, not percentages');
});

test('a published section without dates or counts never prints null, and names are escaped', () => {
  const sparse = structuredClone(data);
  delete sparse.date;
  sparse.search.tools[0].name = '<img src=x>';
  sparse.search.tools[1].relevant = null;
  sparse.search.personas = undefined;
  const html = summary(sparse);
  assert.doesNotMatch(html, /null|undefined|NaN/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('no data, no cards', () => {
  assert.equal(summary({}), '');
});
