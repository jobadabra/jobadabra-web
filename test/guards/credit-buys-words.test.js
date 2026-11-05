// The public pages say what each AI credit amount buys, from the one shared function (owner, 27 Oct 2026; the app reads the same renderer/credit-buys.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {applicationsFor} from '../../desktop/renderer/credit-buys.js';

const PAGES = ['web/public/pricing.html', 'web/public/faq.html', 'web/public/terms.html'];
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('every "€N of AI credit" on a page says what it buys, with the number the shared function gives', () => {
  let seen = 0;
  for (const file of PAGES) {
    for (const [, amount, after] of read(file).matchAll(/€(\d+) of (?:AI )?credit([^<.;]{0,60})/g)) {
      if (/^ (?:adds|buys)/.test(after) || /^,? and you can/.test(after) || /^ of our AI/.test(after) || /^\)/.test(after)) continue;   // "€5 adds €5 of credit", "€1 of credit buys €1 of our AI": a rate, not an amount bought
      if (/^ (?:\(|included \()/.test(after)) { assert.match(after, new RegExp(`\\(about ${applicationsFor(Number(amount))} applications\\)`), `${file}: €${amount} says the wrong number`); seen++; }
      else assert.fail(`${file}: "€${amount} of AI credit${after}" does not say what it buys`);
    }
  }
  assert.ok(seen >= 6, 'the pages name the Pro + AI credit in several places');
});

test('the top-up list on each page gives the number for each amount', () => {
  for (const file of PAGES) {
    const text = read(file);
    assert.ok(text.includes(`€5 (about ${applicationsFor(5)} applications), €10 (about ${applicationsFor(10)}) or €20 (about ${applicationsFor(20)})`), `${file}: the top-up amounts do not say what they buy`);
  }
});
