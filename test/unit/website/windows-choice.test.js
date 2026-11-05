// Every Windows download offers a choice (owner, 31 Oct 2026: "offer on the website, a dropdown, to download the Windows version as a binary, or from the Windows Store. Because Windows
// store, every version gets approved in 1-3 days"). The page markup is the Store link (the main click, as before) followed by its own `a.dl-exe` link with the same ?from=; site.js turns
// the pair into a split button. Without the script both links are on the page, so there is no JS-only dead end. The two routes and their counting: test/unit/api/store-downloads.test.js.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
const STORE = /<a class="btn btn-primary" href="\/download\/windows\?from=([\w-]+)"[^>]*>(?:(?!<\/a>)[\s\S])*<\/a>\s*<a class="dl-exe" href="\/download\/windows-exe\?from=([\w-]+)">Direct download \(\.exe\)<\/a>/g;

test('every Windows button is followed by its own direct-download link with the same ?from=', () => {
  let buttons = 0;
  for (const name of pages) {
    const page = read(name);
    const stores = [...page.matchAll(/<a class="btn btn-primary" href="\/download\/windows\?from=([\w-]+)"/g)].map(m => m[1]);
    const pairs = [...page.matchAll(STORE)].map(m => [m[1], m[2]]);
    buttons += stores.length;
    assert.deepEqual(pairs.map(([store]) => store), stores, `${name}: a Windows button has no .exe link right after it`);
    for (const [store, exe] of pairs) assert.equal(exe, store, `${name}: the .exe link must keep the button's from=${store}, so the admin tells Store from .exe by button`);
  }
  assert.ok(buttons >= 7, `positive control: ${buttons} Windows buttons read (hero, footer, compare, intelligence, platforms, pricing, download)`);
});

test('every .exe link belongs to a Store link of the same page and from=, and the one text link (friends) offers both', () => {
  for (const name of pages) {
    const page = read(name);
    const stores = new Set([...page.matchAll(/href="\/download\/windows\?from=([\w-]+)"/g)].map(m => m[1]));
    for (const [, from] of page.matchAll(/href="\/download\/windows-exe\?from=([\w-]+)"/g)) assert.ok(stores.has(from), `${name}: an .exe link (from=${from}) with no Store link beside it`);
    for (const from of stores) assert.match(page, new RegExp(`href="/download/windows-exe\\?from=${from}"`), `${name}: Windows from=${from} offers only the Store`);
  }
  assert.match(read('friends.html'), /href="\/download\/windows\?from=friends">Windows<\/a> \(or <a href="\/download\/windows-exe\?from=friends">/);
});

test('every page with a Windows choice loads the script and the stylesheet that build it', () => {
  const css = read('home.css');
  for (const rule of ['.dl-split', '.dl-menu', '.dl-menu[hidden]', '.dl-caret']) assert.ok(css.includes(rule), `home.css lacks ${rule}`);
  const withChoice = pages.filter(name => read(name).includes('class="dl-exe"'));
  assert.ok(withChoice.length >= 6, `positive control: ${withChoice}`);
  for (const name of withChoice) {
    assert.match(read(name), /<script src="\/?site\.js"/, `${name} does not load site.js`);
    assert.match(read(name), /<link rel="stylesheet" href="home\.css">/, `${name} does not load home.css`);
  }
});

test('site.js makes the pair a split button: the Store stays the main click, the caret opens both, by keyboard and on a phone', () => {
  const site = read('site.js');
  assert.match(site, /querySelectorAll\('a\[href\^="\/download\/windows\?"\]'\)/);
  assert.match(site, /store\.nextElementSibling/);
  assert.match(site, /exe\.matches\('a\.dl-exe'\)/);
  assert.match(site, /wrap\.append\(store, caret, menu\)/, 'the original Store link is moved, so its href and from= stay as written');
  assert.match(site, /type: 'button'/);
  for (const attribute of ['aria-label', 'aria-haspopup', 'aria-expanded', 'aria-controls']) assert.ok(site.includes(`setAttribute('${attribute}'`), `the caret lacks ${attribute}`);
  assert.match(site, /event\.key === 'Escape'/);
  assert.match(site, /'focusout'/);
  assert.match(site, /document\.addEventListener\('click'/);
  assert.match(site, /innerWidth/, 'the menu never runs past the screen edge on a phone');
  // #243 (Gitar): measuring with the last open's .right still on made the menu alternate left/right on every open; measure from the default position.
  assert.ok(site.indexOf("menu.classList.remove('right')") > 0 && site.indexOf("menu.classList.remove('right')") < site.indexOf("classList.toggle('right'"), 'the .right class is cleared before the edge is measured');
});

test('the two choices say what each gives, and the Store is the first one', () => {
  const site = read('site.js');
  const choices = site.slice(site.indexOf('const CHOICES'), site.indexOf('const splits'));
  assert.ok(choices.indexOf('Microsoft Store') < choices.indexOf('Direct download (.exe)'), 'the main click (the Store) is listed first');
  assert.match(choices, /no warning/);
  assert.match(choices, /1–3 days/);
  assert.match(choices, /newest version now/);
  assert.match(choices, /Windows asks once/);
  assert.match(choices, /updates itself in the app/);
});
