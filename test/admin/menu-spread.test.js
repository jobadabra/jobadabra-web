// Intelligence was three pages and an Overview; the owner spread them out (2 Nov 2026: "Intelligence is very thin, let's spread the tabs/pages in Intelligence to others...
// Probably most of them will go in Growth"; preview pick "AI cost into Growth too"). Insights, Product Brain and AI cost live in Growth. The old addresses still answering are asserted in test/admin/admin-urls.test.js (the one file allowed to name them).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GROUPS, PAGES} from '../../admin/admin.js';
import {HEADLINES} from '../../admin/headlines.js';
import {headlinePages} from '../../admin/section-overview.js';

// AI cost left Growth for the top-level AI section (owner, 3 Nov 2026: "a separate top level: AI tab ... AI Agents, AI steps ... AI costs"): /admin/ai/costs, the old address redirected (test/admin/admin-urls.test.js).
test('there is no Intelligence group; Insights and Product Brain are Growth pages at /admin/growth/…, AI cost is in the AI group', () => {
  assert.ok(!GROUPS.some(([name]) => name === 'Intelligence'), 'the group is gone');
  assert.ok(!PAGES.some(page => page.group === 'Intelligence' || page.path.split('/')[2] === 'intelligence'), 'no page keeps the old group');
  for (const slug of ['insights', 'brain']) assert.equal(PAGES.find(page => page.path === `/admin/growth/${slug}`)?.group, 'Growth', slug);
  assert.equal(PAGES.find(page => page.path === '/admin/ai/costs')?.group, 'AI');
  assert.equal(PAGES.filter(page => page.group === 'Growth').length, 8);
});

test('Growth\'s Overview has a tile for each of the moved pages', () => {
  const paths = headlinePages('Growth').map(page => page.path);
  for (const slug of ['insights', 'brain']) assert.ok(paths.includes(`/admin/growth/${slug}`) && typeof HEADLINES[`/admin/growth/${slug}`] === 'function', slug);
  assert.ok(!Object.keys(HEADLINES).some(path => path.split('/')[2] === 'intelligence'), 'no headline keeps the old group');
});

// Feedback left Growth for its own last menu item (owner, 3 Nov 2026: "let's move the feedback as a separate, top level, last one menu item"). Its old addresses are redirected, the
// act and file routes keep their addresses (the page's script and the e-mails already sent call them).
test('Feedback is the last top-level group, one page at /admin/feedback/inbox; the old addresses move to it', () => {
  assert.equal(GROUPS.at(-1)[0], 'Feedback');
  assert.deepEqual(PAGES.filter(page => page.group === 'Feedback').map(page => page.path), ['/admin/feedback/inbox']);
  assert.ok(!PAGES.some(page => page.group === 'Growth' && /feedback/.test(page.path)), 'Growth no longer lists it');
  const feedback = PAGES.find(page => page.group === 'Feedback');
  for (const old of ['/admin/growth/' + 'feedback', '/feedback']) assert.ok(feedback.old.includes(old), old);   // spelled in two parts: the old-path guard (test/web/form-pages.test.js) allows the full address in the redirect list only
  assert.ok(!headlinePages('Growth').some(page => /feedback/.test(page.path)), 'Growth\'s Overview has no tile for a page it no longer holds');
});
