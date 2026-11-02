// The privacy page covers LinkedIn only for importing the person's own profile data (Member Data Portability), and says nothing about reading LinkedIn jobs (owner, 2 Nov 2026: "linkedin should know nothing about this for now").
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../../web/public/privacy.html', import.meta.url), 'utf8');
const text = page.replace(/<[^>]*>/g, '');

test('the privacy page has a LinkedIn profile import section: what is read, where it is kept, how to delete it', () => {
  const section = text.slice(text.indexOf('Import your LinkedIn profile'), text.indexOf('Shared fixes from our service'));
  assert.match(section, /positions, education, skills and name/);
  assert.match(section, /Member Data Portability API/);
  assert.match(section, /only when you press Import/);
  assert.match(section, /kept in your own store[^]*not on our servers/);
  assert.match(section, /never sell it[^]*train AI models/);
  assert.match(section, /delete it in the app[^]*withdraw your consent on LinkedIn/);
});

test('the sentence that refuses LinkedIn belongs to the refused-sites button, and the page does not describe reading LinkedIn jobs', () => {
  assert.match(text, /This button never reads LinkedIn, Indeed,/);
  assert.doesNotMatch(text, /LinkedIn jobs|your LinkedIn (job )?searches|LinkedIn sign-in cookies|hidden browser/i);
});
