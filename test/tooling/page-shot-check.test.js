// tools/page-shot-check.mjs: a shot of an unstyled page is refused (owner, 25 Oct 2026, #92: the admin page as raw HTML in a PR). Run: tools/site-run.sh node --test test/tooling/page-shot-check.test.js
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {unstyledReasons} from '../../tools/page-shot-check.mjs';

const STYLED = {status: 200, failed: [], bodyFont: 'Inter, system-ui, sans-serif', bodyBackground: 'rgb(11, 13, 16)', background: 'rgba(0, 0, 0, 0)', sheets: 1};

test('a styled admin page passes', () => assert.deepEqual(unstyledReasons(STYLED), []));

test('the bare page of #92 (serif, white, no layout CSS) is refused', () => {
  const bare = {...STYLED, bodyFont: '"Times New Roman"', bodyBackground: 'rgba(0, 0, 0, 0)', background: 'rgba(0, 0, 0, 0)', sheets: 1};
  const reasons = unstyledReasons(bare);
  assert.ok(reasons.some(r => /browser default/.test(r)) && reasons.some(r => /no background/.test(r)), reasons.join('; '));
});

test('every way a page loses its styles is a reason', () => {
  const cases = {
    'a stylesheet that failed': {failed: [{url: 'http://x/a.css', type: 'stylesheet', reason: 'HTTP 404'}]},
    'a font that failed': {failed: [{url: 'http://x/a.woff2', type: 'font', reason: 'net::ERR_ABORTED'}]},
    'no stylesheet rules': {sheets: 0},
    'the default serif font': {bodyFont: 'serif'},
    'an error page': {status: 404},
  };
  for (const [name, change] of Object.entries(cases)) assert.ok(unstyledReasons({...STYLED, ...change}).length, name);
  assert.deepEqual(unstyledReasons({...STYLED, failed: [{url: 'http://x/a.png', type: 'image', reason: 'x'}]}), [], 'a missing image is not an unstyled page');
});
