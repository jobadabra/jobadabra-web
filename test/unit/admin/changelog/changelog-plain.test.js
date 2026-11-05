// admin/changelog-plain.js: the entry built without the AI is grouped, short, checked like any entry and marked plain.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {problems} from '../../../../admin/changelog.js';
import {cleanSubject, plainEntry} from '../../../../admin/changelog-plain.js';

const work = {version: '0.8.27', date: '2026-10-24', channel: 'stable'};

test('subjects are grouped by kind, cleaned, and the entry is marked plain and passes the checks', () => {
  const entry = plainEntry(work, ['[50] Fix required dropdowns that stayed empty (#812)', 'feat: Add a Compare view for two jobs', 'Faster search results on big lists', 'Faster search results on big lists', 'Tune the CI cache for the test suite', 'wip', 'Pro plan costs $29 a month']);
  assert.equal(entry.plain, true);
  assert.deepEqual(problems(entry), []);
  assert.deepEqual(entry.groups.map(group => [group.kind, group.items.map(item => item.text)]), [['features', ['Add a Compare view for two jobs.']], ['improvements', ['Faster search results on big lists.']], ['fixes', ['Fix required dropdowns that stayed empty.']]]);
  assert.equal(entry.groups[2].items[0].lead, 'Fix required dropdowns that stayed empty');
});

test('at most 6 per kind; nothing fit to show gives null, never an empty or rule-breaking entry', () => {
  const many = Array.from({length: 9}, (_, i) => `Fix problem number ${i} in the form`);
  assert.equal(plainEntry(work, many).groups[0].items.length, 6);
  assert.equal(plainEntry(work, ['wip', 'CI only change for the tests', 'Pro costs $9']), null);
  assert.equal(plainEntry(work, []), null);
  assert.equal(cleanSubject('fix(ui): Align the header (#12)'), 'Align the header');
});
