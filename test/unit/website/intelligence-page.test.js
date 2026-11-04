// The AI page (/intelligence): a journey strip of six sections, every step shown, a quiet "Data used" line per card, "your AI" not "Claude",
// every anchor working, and the next-page card clear of the section above it (owner, 24 Oct 2026: "looks cooler", "a bit of spacing").
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = name => readFileSync(new URL(`../../../web/public/${name}`, import.meta.url), 'utf8');
const page = read('intelligence.html');
const SECTIONS = ['find', 'prepare', 'apply', 'track', 'learn', 'trust'];

test('the journey strip links to all six sections, and each section exists (the app README links #find .. #trust)', () => {
  const strip = page.match(/<ol class="ai-journey">([\s\S]*?)<\/ol>/)[1];
  assert.deepEqual([...strip.matchAll(/href="#([a-z]+)"/g)].map(m => m[1]), SECTIONS);
  for (const id of SECTIONS) assert.match(page, new RegExp(`<section[^>]* id="${id}"`), id);
});

test('every step is a card: a title, a promise line, and its long text folded under "How it works"', () => {
  const cards = [...page.matchAll(/<article class="ai-step"[^>]*>([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.ok(cards.length >= 47, `${cards.length} cards`);
  for (const card of cards) {
    assert.match(card, /<h3>[^<]{3,}<\/h3><p class="promise-line">[^<]{10,}<\/p>/);
    assert.match(card, /<details><summary>.*How it works.*<\/summary><p>[^<]{20,}/s, 'the long text is kept, folded');
  }
});

test('every step stays on the page, none hidden behind a fold (owner, 24 Oct 2026: "I want to show them all")', () => {
  assert.doesNotMatch(page, /class="ai-all"/);
  assert.ok([...page.matchAll(/<article class="ai-step"[^>]*>/g)].length >= 47);
});

test('the privacy lines stay visible: a card that says what the AI never sees shows it in its Data used line, outside the fold', () => {
  const cards = [...page.matchAll(/<article class="ai-step"[^>]*>([\s\S]*?)<\/article>/g)].map(m => m[1]);
  for (const card of cards) {
    const folded = card.match(/<\/summary><p>[\s\S]*<\/details>/)[0];
    const visible = card.replace(folded, '');
    if (/(?:Claude|your AI) sees [^.]*never/i.test(folded)) assert.match(visible, /class="never"/, `a card that says what the AI never sees shows it: ${card.match(/<h3>(.*?)<\/h3>/)[1]}`);
  }
  assert.ok((page.match(/class="never"/g) || []).length >= 20, 'the never lines are there');
  assert.doesNotMatch(page, /class="sees"/, 'the repeated pills are gone');
});

test('"Claude" means one provider only where it names a Claude-only feature or plan; otherwise the page says "your AI"', () => {
  const text = page.replace(/<[^>]+>/g, ' ');
  for (const [, context] of text.matchAll(/(.{0,30}Claude.{0,12})/g)) assert.match(context, /Apply with Claude|Claude Code|Claude plan|Claude or (?:OpenAI|ChatGPT)/, context);
});

test('the NEW badges are gone, the page title tells the real count, and the page links its own stylesheet', () => {
  assert.doesNotMatch(page, /class="new"/);
  assert.doesNotMatch(page, /29 ways/);
  assert.match(page, /href="intelligence\.css"/);
});

test('the end-of-page card has room above it on every page that uses it', () => {
  const rule = read('pages.css').match(/\.next-page \{[^}]*margin-block: (\d+)px/);
  assert.ok(rule && Number(rule[1]) >= 40, 'margin above .next-page');
});

test('the title and og:title give the real step count (the page is the one source), and the end card names both platforms', () => {
  const count = [...page.matchAll(/<article class="ai-step"[^>]*>/g)].length;
  assert.match(page, new RegExp(`<title>[^<]*\\b${count} steps`));
  assert.match(page, new RegExp(`og:title" content="[^"]*\\b${count} steps`));
  assert.match(page, /Free app for Mac and Windows/);
  assert.doesNotMatch(page, /Free Mac app/);
});
