// The phone menu (site audit, owner 24 Oct 2026): every page with the top bar gets a Menu button from site.js that opens its links below the bar,
// usable by keyboard and screen reader. A page that hand-writes its own nav without .links would lose the menu: this fails then.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));

test('every page with the top bar has its links in .links and loads site.js, which adds the menu', () => {
  let checked = 0;
  for (const name of pages) {
    const page = read(name);
    if (!/class="topnav/.test(page)) continue;
    checked++;
    assert.match(page, /<nav class="topnav[^"]*" id="topnav">[\s\S]*?<div class="links">/, `${name}: the top bar has no .links for the menu to open`);
    assert.match(page, /<script src="\/?site\.js"/, `${name} does not load site.js`);
  }
  assert.ok(checked >= 12, `only ${checked} pages with the top bar: the scan is broken`);
});

test('the menu button says what it controls and whether it is open, and Escape closes it', () => {
  const site = read('site.js');
  assert.match(site, /className: 'menu-btn'/);
  assert.match(site, /setAttribute\('aria-expanded'/);
  assert.match(site, /setAttribute\('aria-controls', links\.id\)/);
  assert.match(site, /event\.key === 'Escape'/);
  assert.match(site, /type: 'button'/);
});

test('the button shows only at phone width, where the links are hidden', () => {
  const css = read('styles.css');
  assert.match(css, /\.topnav \.menu-btn \{ display: none;/);
  assert.match(css, /@media \(max-width: 800px\) \{\s*\.topnav \.menu-btn \{ display: inline-flex; \}/);
  assert.match(css, /\.topnav \.menu-btn:focus-visible/);
});
