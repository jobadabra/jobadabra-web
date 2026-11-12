// Public benchmark rendering keeps poor results, denominator labels, absent observations and unjudged newer runs visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {renderResults} from '../../../web/public/benchmark.js';
const data = JSON.parse(readFileSync(new URL('../../../web/public/benchmark-results.json', import.meta.url)));

test('renders all scored form contestants in score order including our second place', () => {
  const {forms} = renderResults(data);
  assert.ok(forms.indexOf('Browser Use') < forms.indexOf('Jobadabra'));
  for (const score of ['84.3%', '78.2%', '52.8%', '31.5%']) assert.ok(forms.includes(score), score);
  assert.match(forms, /Not estimated/);
  assert.match(forms, /ffb105dd6/);
  assert.match(forms, /not scored/);
  assert.doesNotMatch(forms, /97%/);
});

test('renders search denominators and missing observations without inventing zero results', () => {
  const {search, personas} = renderResults(data);
  for (const tool of data.search.tools) assert.ok(search.includes(tool.name));
  assert.match(search, /82 \/ 113/);
  assert.match(search, /43 \/ 113/);
  assert.match(personas, /No returned rows in saved data/);
  assert.match(personas, /Not observed/);
});

test('source text is escaped rather than executable HTML', () => {
  const dirty = structuredClone(data);
  dirty.search.tools[0].name = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(renderResults(dirty).search, /<img src=x/);
  assert.match(renderResults(dirty).search, /&lt;img/);
});

test('a location count the round did not record reads "not recorded", never "null"', () => {
  // Why (12 Nov 2026, owner: "null remote · null no · null unknown"): a published search round carries role and place counts only.
  const sparse = structuredClone(data);
  for (const t of sparse.search.tools) Object.assign(t, {remote: null, no: null, unknown: null});
  for (const p of sparse.search.personas) p.judgedJobs = null;
  const {search, personas} = renderResults(sparse);
  for (const html of [search, personas]) assert.doesNotMatch(html, /null/);
  assert.match(search, /\d+ yes · other verdicts not recorded/);
  assert.match(search, /Remote: not recorded/);
  assert.match(personas, /Judged jobs not recorded/);
});
