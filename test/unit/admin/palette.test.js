// ⌘K on /admin (admin/palette.js): the ranking, the ids headings get, and that every admin page carries it. The owner's own example comes first
// (27 Oct 2026: "For example I want to search for \"Promo Code\""). The browser check of every page is test/integration/palette-pages.test.js.
// Run: tools/site-run.sh node --test test/unit/admin/palette.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nav, PAGES, withNav} from '../../../admin/admin.js';
import {PALETTE_SCRIPT, rank, slug, words} from '../../../admin/palette.js';

// The page entries as the browser reads them: the ☰ list of the real menu (every page by group).
function menuEntries() {
  const list = nav(at('Website'), {role: 'superadmin'}).match(/<div class="list">(.*)<\/div><\/details>/s)[1];
  const out = [];
  let group = '';
  for (const m of list.matchAll(/<h3>([^<]*)<\/h3>|<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
    if (m[1]) group = m[1].replace(/^\W+/, '');
    else out.push({kind: 'Page', title: m[3], where: group, href: m[2]});
  }
  return out;
}
const at = name => PAGES.find(p => p.name === name).path;   // paths from PAGES: they move (/admin/{group}/{page}, web#184)
const SECTIONS = [
  {kind: 'Section', title: '🎟️ Promo codes', where: 'Overview', href: '/admin#promo-codes'},
  {kind: 'Section', title: 'Make a code', where: 'Growth › Promo codes', href: `${at('Promo codes')}#make-a-code`, keywords: 'An AI-credit code adds its euros of AI credit'},
  {kind: 'Section', title: 'Codes', where: 'Growth › Promo codes', href: `${at('Promo codes')}#codes`},
  {kind: 'Section', title: '🚧 Closed sites · 276', where: 'Job search › Scouting', href: `${at('Scouting')}#closed-sites`},
];

test('the owner\'s example: "Promo Code", any case, or "promo" lands on the Promo codes page, its cards next', () => {
  const entries = [...SECTIONS, ...menuEntries()];
  const page = at('Promo codes');
  for (const query of ['Promo Code', 'promo code', 'PROMO CODES', 'promo', 'prom']) {
    const found = rank(entries, query);
    assert.equal(found[0].href, page, `"${query}" → ${found[0].href}`);
    assert.ok(found.slice(1, 4).some(e => e.href.startsWith(`${page}#`)), `"${query}" lists the page's cards next`);
  }
  assert.equal(rank(entries, 'credit')[0].href, `${page}#make-a-code`, 'a card is found by its first line');
});

test('every word typed must match; filler words are dropped; recent picks come first', () => {
  const entries = [...SECTIONS, ...menuEntries()];
  assert.deepEqual(rank(entries, 'closed sites').map(e => e.href), [`${at('Scouting')}#closed-sites`]);
  assert.deepEqual(rank(entries, 'promo zebra'), []);
  assert.equal(rank(entries, 'open the scouting page')[0].title.includes('Scouting'), true);
  const recent = [`${at('Scouting')}#closed-sites`];
  assert.equal(rank(entries, '', recent)[0].href, recent[0], 'an empty box lists the recent picks first');
  assert.equal(rank(entries, '', recent).length, entries.length);
});

test('every menu page is an entry, so a new page is searchable without a list kept by hand', () => {
  const hrefs = menuEntries().map(e => e.href);
  for (const page of PAGES) assert.ok(hrefs.includes(page.path), `${page.path} is in the ☰ list the palette reads`);
});

test('a heading\'s id comes from its words: no emoji, no counts, so links survive new numbers', () => {
  assert.equal(slug('🚧 Closed sites · 276'), 'closed-sites');
  assert.equal(slug('🚧 Closed sites · 0'), 'closed-sites');
  assert.equal(slug('Last 10 refusals and failures'), 'last-refusals-and-failures');
  assert.equal(slug('Réponses: AI-credit'), 'reponses-ai-credit');
  assert.equal(slug('📊'), 'section');
  assert.deepEqual(words('Lab Form Filling › Sites'), ['lab', 'form', 'filling', 'sites']);
});

test('every admin page gets the palette: its style, its script, and 🔍 in both menu bars', () => {
  assert.doesNotThrow(() => new Function(PALETTE_SCRIPT), 'the browser script parses');
  for (const page of PAGES) {
    const html = withNav('<html><head></head><body><main><h1>x</h1></main></body></html>', page.path, {role: 'superadmin'});
    assert.ok(html.includes('.admin-palette{'), `${page.path}: style`);
    assert.ok(html.includes(PALETTE_SCRIPT), `${page.path}: script`);
    assert.equal((html.match(/class="admin-find/g) || []).length, 2, `${page.path}: 🔍 in the computer row and the phone bar`);
  }
});
