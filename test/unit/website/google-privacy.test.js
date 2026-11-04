// The privacy page says what Google requires for Gmail and Calendar data (verification of the Google app): read-only scopes, Limited Use, no selling or AI training, how to revoke.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../../../web/public/privacy.html', import.meta.url), 'utf8');

test('the privacy page has the Google data section Google asks for', () => {
  assert.match(page, /<h2>Google data: Gmail and Calendar<\/h2>/);
  assert.match(page, /gmail\.readonly/);
  assert.match(page, /calendar\.events\.readonly/);
  assert.doesNotMatch(page, /calendar\.readonly/);   // the page, the console and the app name the same narrow scope (30 Oct 2026)
  assert.match(page, /api-services-user-data-policy#limited-use/);
  assert.match(page, /used to train AI models/);
  assert.match(page, /myaccount\.google\.com\/permissions/);
  assert.match(page.replace(/<[^>]*>/g, ''), /The use of raw or derived user data received from Workspace APIs will adhere to the Google User Data Policy, including the Limited Use requirements\./);
});

test('the Google section names who receives the data, how it is protected, and how long it is kept', () => {
  const section = page.slice(page.indexOf('<h2>Google data: Gmail and Calendar</h2>'), page.indexOf('<h2>Website</h2>'));
  assert.match(section, /<b>Shared with:<\/b>[^]*Anthropic[^]*OpenAI[^]*Cloudflare/);
  assert.match(section, /<b>How it is protected:<\/b>[^]*keychain[^]*encrypted/i);
  assert.match(section, /<b>Kept and deleted:<\/b>/);
});
