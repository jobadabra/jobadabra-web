// Public pages send people to contact@jobadabra.top for questions, problems and deletion requests, never to GitHub issues (owner, 27 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const OWN = ['web/public'];   // the site's own page folders only
const pages = dir => readdirSync(join(ROOT, dir), {recursive: true}).filter(f => String(f).endsWith('.html')).map(f => join(dir, String(f)));
const GITHUB_CONTACT = /github\.com\/(GarryOne|jobadabra)\/[\w-]+\/(issues|security\/policy)|open an issue/i;

test('no public page points people at GitHub issues or its security page', () => {
  const hits = OWN.flatMap(pages).filter(file => GITHUB_CONTACT.test(readFileSync(join(ROOT, file), 'utf8')));
  assert.deepEqual(hits, []);
});

test('the privacy page asks for questions and deletion requests by e-mail', () => {
  const page = readFileSync(join(ROOT, 'web/public/privacy.html'), 'utf8');
  const contact = page.slice(page.indexOf('<h2>Contact</h2>'), page.indexOf('</main>'));
  assert.match(contact, /<a href="mailto:contact@jobadabra\.top">contact@jobadabra\.top<\/a>/);
});
