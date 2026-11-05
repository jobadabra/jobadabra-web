// The What's new page: channel tabs, the newest release as a card, highlights of the next, compact rows for the rest, "View all N changes",
// plain category labels instead of an emoji per line (owner, 24 Oct 2026, site audit: "long expanded releases, an emoji on almost every line").
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');
const page = read('changelog.html'), script = read('changelog.js'), css = read('changelog.css');

test('the page loads its own script and styles, with the tab strip outside the list that is re-rendered', () => {
  assert.match(page, /href="changelog\.css"/);
  assert.match(page, /<script src="changelog\.js" defer>/);
  assert.match(page, /id="release-tabs"[^>]*role="tablist"/);
  assert.match(page, /id="release-list"/);
  assert.doesNotMatch(page, /<style>/, 'no one-off CSS in the page');
});

test('no emoji is drawn: the labels are New / Improved / Fixed and the data\'s per-line emoji is ignored', () => {
  assert.match(script, /\['features', 'New'\], \['improvements', 'Improved'\], \['fixes', 'Fixed'\]/);
  assert.doesNotMatch(script, /item\.emoji|\\u\{1F/);
});

test('a long release folds under "View all N changes", older ones are compact rows, more load on demand', () => {
  assert.match(script, /View all \$\{all\.length\} changes/);
  assert.match(script, /'release row'/);
  assert.match(script, /Load earlier releases/);
});

test('text is set as text, never as HTML', () => {
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML/);
});

test('the phone layout stacks the labels over the text and wraps the date', () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.changes li \{ grid-template-columns: 1fr/);
});
