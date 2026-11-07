// The features page leads with the whole route, names the four extra features, and every page that names Pro names both packages.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = name => readFileSync(new URL(`../../../web/public/${name}.html`, import.meta.url), 'utf8');

test('features page: the route in order, Submit stays yours', () => {
  const html = page('features');
  const ids = ['find', 'fit', 'apply', 'track', 'improve'].map(id => html.indexOf(`id="${id}"`));
  assert.ok(ids.every((at, i) => at > 0 && (i === 0 || at > ids[i - 1])), 'five sections in route order');
  assert.match(html, /You press Submit/);
});

test('features page: Searches report, Export (Pro), Stop, Windows; no Ready to send', () => {
  const html = page('features');
  for (const word of ['Full report', 'CSV or JSON', 'Stop', 'Windows']) assert.ok(html.includes(word), word);
  assert.doesNotMatch(html, /Ready to send/);
});

test('every page that gives a Pro price names both packages', () => {
  for (const name of ['faq', 'compare', 'pricing', 'index', 'features']) {
    const html = page(name);
    if (!/€\d/.test(html)) continue;
    assert.match(html, /€9/, `${name}: Pro €9`);
    assert.match(html, /€19/, `${name}: Pro + AI €19`);
    assert.doesNotMatch(html, /from €9/, `${name}: no "from €9"`);
  }
});

test('open code is "public for now", never an open-source promise', () => {
  for (const name of ['trust', 'faq', 'pricing', 'compare']) assert.match(page(name), /public for now/, name);
  for (const name of ['trust', 'faq', 'pricing', 'compare', 'features']) assert.doesNotMatch(page(name), /open[- ]source|source available/i, name);
});

// Guard: every language the app ships is named on the site (owner, 7 Nov 2026: "add what languages we support"): Home, Features and FAQ name each one in desktop/i18n's list, so a new language fails here until the pages list it.
test('Home, Features and FAQ name every language the app comes in', async () => {
  const {SUPPORTED_LOCALES, LANGUAGE_NAMES} = await import('../../../desktop/i18n/index.js');
  const names = SUPPORTED_LOCALES.map(code => LANGUAGE_NAMES[code]);
  for (const name of ['index', 'features', 'faq']) {
    const html = page(name);
    for (const each of names) assert.ok(html.includes(each), `${name}: does not name ${each}`);
    if (name !== 'features') assert.match(html, new RegExp(`\\b${names.length} languages\\b`), `${name}: the count ${names.length} is not the list's length`);   // Features lists the names without a count
  }
});
