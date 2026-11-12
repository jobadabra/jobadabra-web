// The motion layer borrowed from the owner's ChatGPT redesign (21 Oct 2026: "the nice css effects on cards, the effect that follows the cursor as
// a magic wand"): every kind of card glows (a new boxed card must join site.js CARDS or say here why not), every page loads effects.css, the
// effects stop with reduced motion and on touch, and the landing's whole-journey panel keeps both rows, the way back and one panel per step.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../../web/public/', import.meta.url);
const read = name => readFileSync(new URL(name, dir), 'utf8');
const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
const CARDS = JSON.parse(read('site.js').match(/const CARDS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));

// Boxed things that do not glow, each with its reason.
const LEFT_OUT = {
  '.stop-tab .tile': 'a tab\'s icon, inside a panel that glows',
  '.journey-row .node': 'a step\'s circle, inside a panel that glows',
  '.consent-note': 'a notice to read, not a card to pick',
  '.mac-window': 'a screenshot frame: light over it would wash out the picture',
  '.car-frame': 'a screenshot frame: light over it would wash out the picture',
  '.stage-screen': 'the hero\'s video frame: light over it would wash out the picture',
  '.access-wrap': 'a wide table that scrolls sideways',
  '.heat-card': 'a wide table that scrolls sideways (/coverage heatmap)',
  '.alt-download': 'a button',
  '.car-btn': 'a button',
  '.dl-menu': 'the Windows button\'s dropdown (Store or .exe): a menu that opens over the page, not a card',
};

// Every rule that draws a boxed card: a 1px border and a surface background.
const boxed = () => ['styles.css', 'pages.css', 'home.css'].flatMap(file => {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /(^|;)\s*border:\s*1px/.test(body) && /background:[^;]*var\(--(surface|raised|band)\)/.test(body))
    .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
});

test('every kind of card glows under the pointer, or says why not (one list for the whole site)', () => {
  const found = boxed();
  assert.ok(found.length >= 20, `found only ${found.length} boxed rules: the scan is broken`);
  for (const selector of found) {
    const glows = CARDS.includes(selector) || CARDS.some(card => card.startsWith(selector + ' '));   // the card itself, or its items (.numbers li)
    assert.ok(glows || LEFT_OUT[selector], `${selector} draws a card: add it to CARDS in site.js, or to LEFT_OUT here with the reason`);
  }
  for (const selector of Object.keys(LEFT_OUT)) assert.ok(found.includes(selector), `LEFT_OUT lists ${selector}, which no longer draws a card`);
});

test('every page with the shared look loads the effects, right after styles.css', () => {
  for (const name of pages) {
    const html = read(name);
    if (!html.includes('href="styles.css"')) continue;
    assert.match(html, /<link rel="stylesheet" href="styles\.css">\n<link rel="stylesheet" href="effects\.css">/, name);
  }
});

test('the effects stop with reduced motion and never follow a finger', () => {
  const css = read('effects.css'), js = read('site.js');
  const calm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(calm, /\.spark \{ animation: none; \}/);
  assert.match(calm, /\.glow:hover \{ transform: none; \}/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\n {2}\.glow \{ transition/, 'the lift and the light only where there is a pointer');
  assert.match(js, /if \(calm\) continue;/, 'no pointer tracking with reduced motion');
  assert.match(js, /pointerType === 'touch'\) return/);
  assert.match(read('home.css'), /@media \(prefers-reduced-motion: reduce\) \{ \.journey-loop path \{ animation: none; \} \}/);
});

test('the whole journey: up to Submit, then after it, then back to the start; one panel per step, the first one shown', () => {
  const html = read('index.html');
  const panel = html.match(/<section class="block reveal" id="journey">[\s\S]*?<\/section>/)[0];
  const rows = [...panel.matchAll(/<ol class="journey-row"[\s\S]*?<\/ol>/g)].map(match => match[0]);
  assert.equal(rows.length, 2);
  const labels = row => [...row.matchAll(/<b>([^<]+)<\/b>/g)].map(match => match[1]);
  assert.deepEqual(labels(rows[0]), ['Find a match', 'Prepare the kit', 'Fill the form', 'Checks and terms', 'Review and Submit']);
  assert.deepEqual(labels(rows[1]), ['Read the replies', 'Prepare the interview', 'Keep the calendar', 'Record and review', 'Next job, smarter']);
  assert.match(rows[0], /<li role="none" class="you"><button[^>]*>[\s\S]*?<b>Review and Submit<\/b>/, 'Submit is the person\'s step');
  const tabs = [...panel.matchAll(/role="tab" id="(j-[\w-]+)" aria-controls="(jp-[\w-]+)" aria-selected="(true|false)"/g)];
  assert.equal(tabs.length, 10);
  assert.deepEqual(tabs.map(tab => tab[3]), ['true', ...Array(9).fill('false')]);
  for (const [, tab, controls] of tabs) {
    const shown = panel.match(new RegExp(`role="tabpanel" id="${controls}" aria-labelledby="${tab}"( hidden)?>`));
    assert.ok(shown, `${tab}: no panel`);
    assert.equal(Boolean(shown[1]), tab !== tabs[0][1], `${tab}: only the first panel shows before a click`);
  }
  assert.match(panel, /<svg class="journey-loop" aria-hidden="true">[\s\S]*Again, for the next job/);
  assert.match(panel, /Looks like you\? Then send it\./);
  assert.match(panel, /<ol class="levels"[\s\S]*In Chrome[\s\S]*In the background[\s\S]*Full automation/, 'the three levels, in the order of the app');
  assert.match(html, /<script src="journey\.js" defer><\/script>/);
  assert.match(read('home.css'), /\.journey-detail\[hidden\] \{ display: none; \}/, 'a panel\'s display: grid must not undo hidden');
  // Phones (owner, 21 Oct 2026: "vertical list on phones"): the script and the stylesheet switch at the same width.
  const width = read('journey.js').match(/matchMedia\('\(max-width: (\d+)px\)'\)/)[1];
  assert.match(read('home.css'), new RegExp(`@media \\(max-width: ${width}px\\) \\{\\n  \\.journey-row \\{ --node: \\d+px; grid-template-columns: minmax\\(0, 1fr\\)`), 'one step per line on a phone');
  assert.match(read('journey.js'), /narrow\.matches \? tabs\[i\]\.parentElement\.append\(panel\)/, 'a step\'s words open right under it on a phone');
});

test('the landing\'s three cards: icon, kicker, title, words, and a footer line to the detail', () => {
  const steps = read('index.html').match(/<ol class="steps">[\s\S]*?<\/ol>/)[0];
  const cards = [...steps.matchAll(/<li>[\s\S]*?<\/li>/g)].map(match => match[0]);
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.match(card, /<span class="tile-icon[^"]*"><svg/);
    assert.match(card, /<span class="kicker">/);
    assert.match(card, /<a class="card-foot arrow-link" href="\/how-it-works#(find|fill|track)">/);
  }
});
