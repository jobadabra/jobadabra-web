// A phone never gets a page wider than its screen from a decoration (21 Oct 2026): the nav bar's "inset: 0 -100vmax" made the page 390 + 844 px
// wide on a phone and the hero glow's "-10%" another 10 px, both pinchable sideways although body clips the overflow. A ::before or ::after may
// reach sideways past its box only by exactly the screen's edge (the full-bleed band, calc(50% - 50vw)); a wider paint uses border-image outset.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const sheets = readdirSync(dir).filter(name => name.endsWith('.css'));
const FULL_BLEED = 'calc(50% - 50vw)';

// The horizontal parts of an inset: "a", "a b", "a b c", "a b c d" → [right, left].
const sides = value => {
  const parts = value.match(/calc\([^)]*\)|[^\s]+/g) || [];
  return parts.length === 1 ? [parts[0], parts[0]] : parts.length < 4 ? [parts[1], parts[1]] : [parts[1], parts[3]];
};
const reachesOut = part => part !== FULL_BLEED && (/^-/.test(part) || /vmax/.test(part));

test('no decoration widens the page: a ::before or ::after stays inside its box sideways, or bleeds to the screen\'s edge exactly', () => {
  let checked = 0;
  for (const name of sheets) {
    const css = readFileSync(new URL(name, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/::?(before|after)/.test(selector)) continue;
      checked++;
      const inset = body.match(/(?:^|;)\s*inset:\s*([^;]+)/);
      if (inset) for (const part of sides(inset[1].trim())) assert.ok(!reachesOut(part), `${name} ${selector.trim()}: inset ${inset[1].trim()} reaches past the page's side`);
      for (const [, side, value] of body.matchAll(/(?:^|;)\s*(left|right):\s*([^;]+)/g)) {
        assert.ok(!reachesOut(value.trim()), `${name} ${selector.trim()}: ${side}: ${value.trim()} reaches past the page's side`);
      }
    }
  }
  assert.ok(checked >= 15, `checked only ${checked} pseudo-elements: the scan is broken`);
});

test('the scan catches the two shapes that widened the page on 21 Oct 2026', () => {
  assert.ok(sides('0 -100vmax').some(reachesOut));
  assert.ok(sides('-18% -10% -10% 0').some(reachesOut));
  assert.ok(!sides('0 calc(50% - 50vw)').some(reachesOut));
  assert.ok(!sides('-12px 0 auto').some(reachesOut));
});
