// The Grey card has no suite x reason ledger any more (owner, 31 Oct 2026: "A: retire it, one-line note"): a suite past its budget is red, so the public repo writes no
// "grey-<suite>" artifacts; the card says what grey means now, in the page and nowhere as a count. Replaces e2e-grey-trend.test.js and e2e-grey-ledger.test.js (gt, #237).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GREY_NOTE, greyData, greyLines, greySummary} from '../../../../admin/e2e-grey.js';
import {page} from '../../../../admin/e2e-page.js';
import {telegramText, weekly} from '../../../../tools/ci-intel/lib/e2e-weekly.mjs';

const now = new Date('2026-11-02T07:23:00Z');
const base = {at: now.toISOString(), days: [], fails: [], latest: [], quality: [], breaks: [], caught: [], work: [], workFiles: [], lanes: {suites: {quality: {lane: 'tolerant', input: 'ai', since: '2026-10-29', why: 'fixture'}}}};
const legacy = [{runId: 101, day: '2026-11-01', kind: 'pr', suite: 'apply', reason: 'timing'}];

test('positive control: the lane rows of the Grey card are still drawn, with the one-line note under them', () => {
  const card = page(base, {now}).split('<h2>Grey</h2>')[1].split('</section>')[0];
  assert.match(card, /<code>quality<\/code>/);
  assert.ok(card.includes(GREY_NOTE), 'the note is on the card');
  assert.match(GREY_NOTE, /red or green: its one try is the verdict/);
});

test('no suite x reason table is drawn or told, even when an old snapshot still holds a ledger', () => {
  const old = {...base, greyJobs: legacy};
  for (const text of [page(old, {now}), telegramText(weekly(old, now)), greyLines(greySummary(old, now)).join('\n')]) {
    assert.doesNotMatch(text, /Greys, last 7 days|suite × reason|No grey jobs recorded/);
  }
  assert.equal(greySummary(old, now).trend, undefined);
});

test('the stored snapshot drops a legacy ledger on its next update and never keeps one from a collector', () => {
  assert.equal(greyData({greyJobs: legacy}, {}, now).greyJobs, undefined);
  assert.equal(greyData({}, {greyJobs: legacy}, now).greyJobs, undefined);
});
