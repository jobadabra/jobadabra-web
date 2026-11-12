// No public page says Jobadabra never submits while the app offers "Automatically" (owner, 12 Nov 2026: "I don't think we should sell this as 'never submits'... we offer different level of automations and review. This is what we can sell").
// Why (12 Nov 2026, [27-pane-al]): the app's third level fills AND submits once the person's checks pass, and 11 public pages still said "never presses Submit" / "always your click".
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';

// CI runs this inside the joined tree: the public repo's app files and this repo's pages sit side by side.
const root = new URL('../../', import.meta.url);
const PAGES = new URL('web/public/', root);
// The claim in its spoken forms; each is false once Automatically exists. A helper that truly never clicks (a wait page, a data fix) is worded without these.
const NEVER_SUBMITS = /never\s+(?:presses|press|clicks?|submits?|sends?)\b[^.<]{0,20}\bsubmit|never\s+submits?\b|no,\s+never\b|submitting\s+is\s+always\s+your\s+click|you\s+always\s+press\s+submit/i;

const appOffersAutomatically = () => /id:\s*'auto'/.test(readFileSync(new URL('desktop/renderer/apply-settings-model.js', root), 'utf8'));

test('the app still offers the third ("auto") level, so the guards below are in force', () => {
  assert.ok(appOffersAutomatically(), 'desktop/renderer/apply-settings-model.js lists the "auto" mode; if it was removed on purpose, retire this guard with the owner\'s yes');
});

test('no public page claims it never submits', () => {
  const bad = [];
  for (const file of readdirSync(PAGES).filter(name => name.endsWith('.html'))) {
    readFileSync(new URL(file, PAGES), 'utf8').split('\n').forEach((line, i) => {
      const hit = line.match(NEVER_SUBMITS);
      if (hit) bad.push(`${file}:${i + 1}: "${hit[0]}"`);
    });
  }
  assert.deepEqual(bad, [], 'sell the levels (In Chrome → In the background → Full automation), not "never submits":\n' + bad.join('\n'));
});

test('the guard catches the old claim in each of its forms', () => {
  for (const old of ['It never presses Submit', 'Fills job forms fast and never presses Submit.', 'No, never. It finds', 'Jobadabra never submits an application for you', 'Submitting is always your click', 'You always press Submit', 'never press Submit or applies in bulk']) {
    assert.match(old, NEVER_SUBMITS, old);
  }
  assert.doesNotMatch('it never clicks, types or solves anything there', NEVER_SUBMITS, 'a wait-page helper that truly never clicks is not the claim');
});

test('the homepage sells the three levels in the app\'s order', () => {
  const html = readFileSync(new URL('index.html', PAGES), 'utf8');
  const scale = (html.match(/<ol class="levels"[\s\S]*?<\/ol>/) || [''])[0];
  assert.deepEqual([...scale.matchAll(/<b>([^<]+)<\/b>/g)].map(m => m[1]), ['In Chrome', 'In the background', 'Full automation']);
  assert.match(scale, /Off until you turn it on/, 'Full automation is said to be off by default');
});

// Why (12 Nov 2026, owner, asked via AskUserQuestion: chose "Full automation" so the site follows the app; the Terms line changes only that one word): the app names its third level "Full automation" (helperMore.fullAutomation),
// the site said "Automatically" on 7 pages. The name is a tag, a quote or "turn on …", never the adverb of an ordinary sentence, so only those forms are banned.
const OLD_LEVEL_NAME = /(?:<b>|“|")Automatically(?:<\/b>|”|")|\b(?:on|to|with|in|and|or)\s+Automatically\b|\bAutomatically(?:\s+is\s+off|,\s+a\s+hidden)/;
test('a public page names the third level "Full automation" like the app, never "Automatically"', () => {
  const bad = [], seen = new Set();
  for (const file of readdirSync(PAGES).filter(name => name.endsWith('.html'))) {
    readFileSync(new URL(file, PAGES), 'utf8').split('\n').forEach((line, i) => {
      if (/Full automation/.test(line)) seen.add(file);
      const hit = line.match(OLD_LEVEL_NAME);
      if (hit) bad.push(`${file}:${i + 1}: "${hit[0]}"`);
    });
  }
  assert.ok(['index.html', 'how-it-works.html', 'terms.html'].every(file => seen.has(file)), `positive control: the level is named in the homepage, how-it-works and the Terms (found in ${[...seen].join(', ') || 'none'})`);
  assert.deepEqual(bad, [], 'the third level is called "Full automation", as in the app:\n' + bad.join('\n'));
});

test('the guard catches the old level name in each form the pages used, and lets the adverb through', () => {
  for (const old of ['<b>Automatically</b>', '“Automatically” is off until', 'you turned on Automatically.', 'switch on Automatically and it submits', 'Automatically is off until you turn it on', 'Automatically, a hidden browser fills']) assert.match(old, OLD_LEVEL_NAME, old);
  for (const fine of ['It automatically fills the form.', 'Automatically saved drafts are kept.', '<b>Full automation</b>']) assert.doesNotMatch(fine, OLD_LEVEL_NAME, fine);
});
