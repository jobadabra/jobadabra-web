// The site explains the Free/Pro AI quality distinction (the final sketch that lived in preview/ went with the next website, 2 Nov 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {purchaseCreditWords} from '../../shared/credit-purchase-words.js';
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const pages = ['pricing', 'faq', 'index', 'download', 'intelligence', 'platforms', 'compare', 'trust', 'friends', 'terms'];

test('each Free tier explanation names the weaker AI quality', () => {
  for (const page of pages) assert.ok(read(`web/public/${page}.html`).includes('a bit weaker than Pro AI'), page);
});

test('the primary upgrade explanations tie smarter in-house AI to available credit', () => {
  for (const page of ['pricing', 'faq', 'index', 'download', 'intelligence']) {
    assert.match(read(`web/public/${page}.html`), /smarter in-house AI while you have credit/i, page);
  }
  assert.match(purchaseCreditWords('pro-ai'), /smarter in-house AI while you have credit/i);
  assert.equal(purchaseCreditWords('pro'), '', 'Pro alone does not grant AI credit');
});
