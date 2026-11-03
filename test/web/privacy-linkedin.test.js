// The privacy page covers LinkedIn twice: importing the person's own profile data (Member Data Portability), and the opt-in LinkedIn jobs read that ships since 0.8.60 (owner, 2 Nov 2026: "Merge as is, add jobs later").
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page = readFileSync(new URL('../../web/public/privacy.html', import.meta.url), 'utf8');
const text = page.replace(/<[^>]*>/g, '');

test('the privacy page has a LinkedIn profile import section: what is read, where it is kept, how to delete it', () => {
  const section = text.slice(text.indexOf('Import your LinkedIn profile'), text.indexOf('LinkedIn jobs (off until you turn it on)'));
  assert.match(section, /positions, education, skills and name/);
  assert.match(section, /Member Data Portability API/);
  assert.match(section, /only when you press Import/);
  assert.match(section, /kept in your own store[^]*not on our servers/);
  assert.match(section, /built-in Free AI, through our server to Cloudflare Workers AI[^]*We do not keep the text or the answer/);   // as the Google section says (Gitar, 2 Nov 2026): the text is not "only on your computer"
  assert.match(section, /never sell it[^]*train AI models/);
  assert.match(section, /delete it in the app[^]*withdraw your consent on LinkedIn/);
});

test('the sentence that refuses LinkedIn belongs to the refused-sites button', () => {
  assert.match(text, /This button never reads LinkedIn, Indeed,/);
});

test('the privacy page describes the opt-in LinkedIn jobs read: off by default, one switch, 3 searches, the session only in the keychain and deleted on off', () => {
  const section = text.slice(text.indexOf('LinkedIn jobs (off until you turn it on)'), text.indexOf('Shared fixes from our service'));
  assert.match(section, /does not read LinkedIn jobs[^]*Settings → Connections → LinkedIn[^]*one switch, after one warning/);
  assert.match(section, /each time you press Find jobs[^]*up to 3 of your own LinkedIn job searches/);
  assert.match(section, /keychain, never sends it to us[^]*deleted when you turn the switch off/);
  assert.match(section, /never solves a captcha or check[^]*does not disguise its browser/);
  assert.match(section, /Free AI, through our server to Cloudflare Workers AI, and we keep no copy/);
});
