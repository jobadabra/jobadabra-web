// /about-you lists exactly the live AI steps of the public export (docs/about-you-readers.json) and marks a part read only where the export says so; "the site has everything public lists" (owner, 21 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {readersTable} from '../../../tools/readers-page.mjs';

const page = readFileSync(new URL('../../../web/public/about-you.html', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(new URL('../../../docs/about-you-readers.json', import.meta.url), 'utf8'));
const live = data.readers.filter(reader => reader.live);

// Why (owner, 21 Oct 2026, "the site lands first, and its tests check 'the site has everything public lists' instead of an exact match"; 28 Oct 2026): a step that goes live in the app
// must not turn the site's CI red before the page is redrawn, so a live step the page lacks is allowed; what is never allowed is a row the export does not give, or a dot it does not.
test('every row on the page is a live step of the public export with exactly its dots (run tools/readers-page.mjs after a step ships)', () => {
  assert.ok(live.length >= 2, 'positive control: the export has live steps');
  const rows = [...page.matchAll(/<tr data-step="([a-z_]+)">([\s\S]*?)<\/tr>/g)];
  assert.ok(rows.length >= 2, 'the page has its rows');
  for (const [, key, body] of rows) {
    const reader = live.find(each => each.key === key);
    assert.ok(reader, `${key} is a live step of the export`);
    const on = [...body.matchAll(/aria-label="Reads ([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(on, data.parts.filter(part => reader.through.includes(part.key)).map(part => part.label), key);
  }
  for (const reader of data.readers.filter(each => !each.live)) assert.ok(!page.includes(`data-step="${reader.key}"`), `${reader.key} is not live`);
});

test('the table the tool draws from the export holds every live step with exactly its dots, and no step that is not live', () => {
  const table = readersTable(data);
  for (const reader of live) {
    const row = table.match(new RegExp(`<tr data-step="${reader.key}">([\\s\\S]*?)</tr>`));
    assert.ok(row, reader.key);
    const on = [...row[1].matchAll(/aria-label="Reads ([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(on, data.parts.filter(part => reader.through.includes(part.key)).map(part => part.label), reader.key);
  }
  for (const reader of data.readers.filter(each => !each.live)) assert.ok(!table.includes(`data-step="${reader.key}"`), `${reader.key} is not live`);
});

test('the Intelligence page links to it', () => {
  assert.match(readFileSync(new URL('../../../web/public/intelligence.html', import.meta.url), 'utf8'), /href="\/about-you"/);
});

// Search Console, 12 Nov 2026: /about-you was "Crawled - currently not indexed" (~170 words, one inbound link, a bare table). It stays in the sitemap, so it needs real text and more than one page linking to it.
test('/about-you has text beside its table and is linked from two pages (Intelligence and Trust)', () => {
  const read = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');
  const words = read('about-you.html').replace(/<script[\s\S]*?<\/script>|<table[\s\S]*?<\/table>|<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 250, `${words} words outside the table`);
  for (const name of ['intelligence.html', 'trust.html']) assert.match(read(name), /href="\/about-you"/, name);
});
