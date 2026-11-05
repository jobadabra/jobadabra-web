// The privacy page names the legal entity that runs Jobadabra, as LinkedIn's API vetting checks it against the trade register (denied 27 Oct 2026 without it).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../../../web/public/privacy.html', import.meta.url), 'utf8');
const text = page.replace(/<[^>]*>/g, '');

test('the privacy page names the operator with its register numbers and registered office', () => {
  assert.match(page, /<h2>Who runs Jobadabra<\/h2>/);
  assert.match(text, /SEVEN CODE DEVELOPMENT SRL/);
  assert.match(text, /CUI 38088795/);
  assert.match(text, /J12\/5277\/2017/);
  // The registered office from the register (ANAF), not an office address from a company website.
  assert.match(text, /Str\. Soporului 8B/);
});
