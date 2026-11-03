// The site's result pages (mail confirm, unsubscribe, email settings, the Notion and LinkedIn sign-in returns) are one card in the app's look, like the app's
// Google sign-in page (owner, 26 Oct 2026: "let's improve the UI. Use the Google App connection (localhost) design/UI page"). The class: no api/ file builds its own page.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {cardHtml} from '../../shared/card-page.js';
import {page} from '../../api/mail-unsub.js';

const API = new URL('../../api/', import.meta.url);

test('no api/ file builds its own HTML page: every one goes through shared/card-page.js', () => {
  const own = readdirSync(API).filter(f => f.endsWith('.js') && /<!doctype html/i.test(readFileSync(new URL(f, API), 'utf8')));
  assert.deepEqual(own, [], 'build the page with cardPage() from shared/card-page.js');
  const users = readdirSync(API).filter(f => f.endsWith('.js') && readFileSync(new URL(f, API), 'utf8').includes('cardPage('));
  assert.ok(['linkedin.js', 'linkedin-import.js', 'mail-unsub.js', 'notion.js'].every(f => users.includes(f)), `positive control: ${users}`);
});

test('the card has the logo, the title, light and dark, and no outside loads', async () => {
  const html = cardHtml({title: 'Email <confirmed>', body: '<p>x</p>', tone: 'ok'});
  assert.ok(html.includes('aria-label="Jobadabra"') && html.includes('<h1 class="ok">Email &lt;confirmed&gt;</h1>') && html.includes('prefers-color-scheme:dark'));
  assert.doesNotMatch(html, /(src|href)="https?:/, 'self-contained');
  const response = page('This link does not work', '<p>It may be cut off.</p>', 400);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /<h1 class="bad">/);
});
