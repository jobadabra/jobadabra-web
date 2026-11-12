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

test('the app still offers the Automatically level, so the guard below is in force', () => {
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
  assert.deepEqual(bad, [], 'sell the levels (In Chrome → In the background → Automatically), not "never submits":\n' + bad.join('\n'));
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
  assert.deepEqual([...scale.matchAll(/<b>([^<]+)<\/b>/g)].map(m => m[1]), ['In Chrome', 'In the background', 'Automatically']);
  assert.match(scale, /Off until you turn it on/, 'Automatically is said to be off by default');
});
