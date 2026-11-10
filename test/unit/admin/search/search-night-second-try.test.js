// A person graded "AI slow" or "AI queue full" presses once more at the end of the night (cr 3/6, 10 Nov 2026; sa: "draw it as measured on the 2nd try, never silently as the better of two").
// The row keeps `again` (0 or 1) and the first try's reason; the night's table says so beside the kind. Guard for admin/search-night.js (clean) and admin/search-night-page.js (personaRow).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean} from '../../../../admin/search-night.js';
import {judgeAll} from '../../../../admin/search-night-judge.js';
import {nightSection} from '../../../../admin/search-night-page.js';

const NOW = new Date('2026-11-19T09:00:00Z');
const row = (persona, extra = {}) => ({persona, label: `p${persona} Role, Place`, kind: 'measured', why: '', local: 3, found: 9, seconds: 100, ...extra});
const night = rows => clean({state: 'success', head: 'measured', rows}, {night: '2026-11-18'}, NOW);

test('the second try is kept in fixed shape: again is 0 or 1, the first try\'s reason is one line of plain text', () => {
  const [plain, second, odd] = night([row(1), row(2, {again: 1, first_try: 'AI slow (a call took 25 s on average)'}), row(3, {again: 7, first_try: `a\nb${'x'.repeat(300)}`})]).rows;
  assert.deepEqual([plain.again, plain.firstTry], [0, ''], 'a person pressed once says nothing');
  assert.deepEqual([second.again, second.firstTry], [1, 'AI slow (a call took 25 s on average)']);
  assert.deepEqual([odd.again, odd.firstTry.includes('\n'), odd.firstTry.length], [0, false, 160], 'only 1 counts; text is cut and has no line break');
});

test('the night table says "measured on the 2nd try" and the first try\'s reason; a person pressed once has neither', () => {
  const html = nightSection(judgeAll([night([row(1), row(2, {again: 1, first_try: 'AI queue full (3 waited)'})])]), {}, []);
  assert.equal(html.match(/measured on the 2nd try/g).length, 1, 'one person pressed twice');
  assert.match(html, /1st try: AI queue full \(3 waited\)/);
  assert.ok(!/2nd try/.test(nightSection(judgeAll([night([row(1)])]), {}, [])));
});
