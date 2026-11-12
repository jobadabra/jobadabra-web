// /how-it-works lists exactly the live AI steps of the public export (docs/about-you-readers.json) and marks a part read only where the export says so; "the site has everything public lists" (owner, 21 Oct 2026).
// The table is drawn by tools/readers-page.mjs from that one export. It lived on /about-you too until the owner folded that page in (12 Nov 2026: "I think we can
// delete '/about-you' since we have it explained in 'how it works'"); /about-you now 301s to /how-it-works#ai-reads (shared/hosts.js MOVED_PAGES).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {readersTable} from '../../../tools/readers-page.mjs';

const pub = new URL('../../../web/public/', import.meta.url);
const tables = readdirSync(pub).filter(name => name.endsWith('.html')).map(name => [name, readFileSync(new URL(name, pub), 'utf8')]).filter(([, html]) => html.includes('<!-- readers:start -->'));
const data = JSON.parse(readFileSync(new URL('../../../docs/about-you-readers.json', import.meta.url), 'utf8'));
const live = data.readers.filter(reader => reader.live);

test('the table lives on /how-it-works, in its "What the AI reads" section, and nowhere else', () => {
  assert.deepEqual(tables.map(([name]) => name), ['how-it-works.html']);
  const html = tables[0][1];
  assert.ok(html.indexOf('id="ai-reads"') < html.indexOf('<!-- readers:start -->'), 'the table sits in #ai-reads, where /about-you now lands');
});

// Why (owner, 21 Oct 2026, "the site lands first, and its tests check 'the site has everything public lists' instead of an exact match"; 28 Oct 2026): a step that goes live in the app
// must not turn the site's CI red before the page is redrawn, so a live step the page lacks is allowed; what is never allowed is a row the export does not give, or a dot it does not.
test('every row on each page is a live step of the public export with exactly its dots (run tools/readers-page.mjs after a step ships)', () => {
  assert.ok(live.length >= 2, 'positive control: the export has live steps');
  for (const [name, page] of tables) {
    const rows = [...page.matchAll(/<tr data-step="([a-z_]+)">([\s\S]*?)<\/tr>/g)];
    assert.ok(rows.length >= 2, `${name} has its rows`);
    for (const [, key, body] of rows) {
      const reader = live.find(each => each.key === key);
      assert.ok(reader, `${name}: ${key} is a live step of the export`);
      const on = [...body.matchAll(/aria-label="Reads ([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(on, data.parts.filter(part => reader.through.includes(part.key)).map(part => part.label), `${name}: ${key}`);
    }
    for (const reader of data.readers.filter(each => !each.live)) assert.ok(!page.includes(`data-step="${reader.key}"`), `${name}: ${reader.key} is not live`);
  }
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

const read = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');

test('Intelligence and Trust link to the table where it now lives, and no page links to /about-you', () => {
  for (const name of ['intelligence.html', 'trust.html']) assert.match(read(name), /href="\/how-it-works#ai-reads"/, name);
  for (const name of readdirSync(pub).filter(each => each.endsWith('.html'))) assert.doesNotMatch(read(name), /href="\/about-you/, name);
});

// What /about-you said beside its table moved with it: sensitive answers reach no step, and where the AI runs.
test('/how-it-works says, beside the table, that sensitive answers reach no step and where the AI runs', () => {
  const section = read('how-it-works.html').match(/<section[^>]*id="ai-reads"[\s\S]*?<\/section>/)[0];
  assert.match(section, /Sensitive answers[^<]*never/i);
  assert.match(section, /Where the AI runs/);
  assert.match(section, /Free AI[^<]*nothing is stored/);
});
