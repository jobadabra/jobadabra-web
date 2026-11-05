// Every public page names the same facts (site audit, owner 24 Oct 2026: "Start with content consistency"). Home, Compare, FAQ and Terms said "Pro €19"
// while Pricing said Pro €9 / Pro + AI €19; Home and Coverage read two count feeds; Trust said nothing is stored on our servers while Terms described
// hosted storage; Compare said "needs a Mac". One source per fact, one check per class: a new page or a new sentence is checked without a new line here.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {CREDIT, OFFERS} from '../../../shared/pro-packages.js';

const dir = new URL('../../../web/public/', import.meta.url);
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
const read = name => readFileSync(new URL(name, dir), 'utf8');
const text = name => read(name).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const pro = OFFERS.find(offer => offer.id === 'pro');
const amounts = new Set(['0', ...OFFERS.flatMap(offer => [offer.price, offer.list].filter(Boolean)), ...Object.values(CREDIT).map(micro => String(micro / 1_000_000))]);

test('every euro amount a page names is one of the offers, their list price, a credit amount or the free plan (the €1-buys-€1 rate aside)', () => {
  let seen = 0;
  for (const name of pages) for (const [, amount] of text(name).matchAll(/€\s?(\d+)\b(?! of credit buys| of our AI)/g)) {
    seen++;
    assert.ok(amounts.has(amount), `${name} names €${amount}, which is no offer in shared/pro-packages.js (${[...amounts].join(', ')})`);
  }
  assert.ok(seen >= 10, `only ${seen} euro amounts found: the scan is broken`);
});

test('"Pro" with a price names the Pro offer\'s price; the €19 one is always called "Pro + AI"', () => {
  for (const name of pages) for (const [match, , amount] of text(name).matchAll(/\bPro\b(?! \+ AI)([^€.;]{0,30})€(\d+)\b(?! of AI credit)/g)) {
    assert.equal(amount, pro.price, `${name}: "${match.trim()}" gives Pro a price other than €${pro.price}`);
  }
});

test('the price check catches the old single price', () => {
  const old = 'Pro, coming soon: €19 once, no subscription.';
  const hits = [...old.matchAll(/\bPro\b(?! \+ AI)([^€.;]{0,30})€(\d+)\b(?! of AI credit)/g)].map(m => m[2]);
  assert.deepEqual(hits, ['19']);
});

test('every page shows the employer and job counts from one feed, the daily snapshot /coverage also reads', () => {
  const site = read('site.js');
  assert.match(site, /fetch\('\/api\/coverage'\)/);
  assert.doesNotMatch(site, /api\/index\?summary/, 'site.js reads a second count feed');
  for (const name of pages) {
    const page = read(name);
    assert.doesNotMatch(page, /api\/index\?summary/, `${name} reads a second count feed`);
    if (/data-count=/.test(page)) assert.match(page, /<script src="\/?site\.js"/, `${name} has live counts but does not load site.js`);
  }
  assert.match(read('coverage.html'), /fetch\('\/api\/coverage'\)/);
});

test('no page claims that nothing is ever stored on our servers: local, hosted Always on and AI are said apart', () => {
  const ABSOLUTE = [/nothing about you is stored/i, /nothing about you on our servers/i, /no vendor server/i, /never stored on (?:a|our) .{0,20}server/i];
  for (const name of pages) for (const claim of ABSOLUTE) assert.doesNotMatch(text(name), claim, `${name}: an absolute storage claim; hosted Always on stores data when switched on`);
  for (const name of ['trust.html', 'terms.html', 'privacy.html']) assert.match(text(name), /hosted Always on/i, `${name} does not mention hosted Always on`);
});

test('no page says Jobadabra is Mac only: the app runs on Mac and Windows', () => {
  for (const name of pages) {
    assert.doesNotMatch(text(name), /Free Mac app|needs a Mac(?! or Windows)|Mac app \+ Chrome/, `${name} says Mac only`);
  }
});

test('Platforms names the AI the app offers today, and no upcoming item is marked supported', () => {
  const page = read('platforms.html');
  for (const ai of ['Claude', 'ChatGPT', 'Free AI']) assert.match(page, new RegExp(`<b>${ai}</b>`), `Platforms does not list ${ai}`);
  assert.doesNotMatch(text('platforms.html'), /Other AI models[^.]*Claude\./, 'Platforms says other models than Claude are under consideration');
  for (const [, row] of page.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    if (/next app update|coming|not regularly tested/i.test(row)) assert.doesNotMatch(row, /status ok/, `an upcoming item is marked Supported: ${row.replace(/<[^>]+>/g, ' ').trim().slice(0, 80)}`);
  }
});
