// The Finder scorecard, Judged noise and Verdict audit cards of the Bug loop page, and the Red main tab: what each draws from its stored data, who sees buttons, and that stored text is escaped.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {page as redMain} from '../../../admin/red-main-page.js';
import {auditSection} from '../../../admin/selfheal-cards.js';
import {noiseSection} from '../../../admin/selfheal-cards.js';
import {scoreSection} from '../../../admin/selfheal-cards.js';

const card = {at: '2026-11-05', yield: {thisWeek: {real: 4, falsePositive: 2}, lastWeek: {real: 3, falsePositive: 5}}, totals: {filed: 40, real: 20, falsePositive: 10, open: 3, precision: 67},
  detectors: [{source: 'ai-review', detector: 'AI screenshot review', filed: 20, real: 12, falsePositive: 8, open: 0, precision: 60, causes: {'fp:stale-build': 3, 'by-design': 2}, severityChanged: {judged: 4}},
    {source: 'layout-check', detector: 'Layout <b>checks</b>', filed: 9, real: 1, falsePositive: 8, open: 0, precision: 11, causes: {}, severityChanged: {}}]};

test('positive control: the scorecard draws a row per detector with its precision chip, the why-false causes and the weekly yield', () => {
  const html = scoreSection(card);
  assert.match(html, /AI screenshot review/);
  assert.match(html, /chip warn">60%/);
  assert.match(html, /chip bad">11%/);
  assert.match(html, /stale-build 3, by-design 2/);
  assert.match(html, /this week: 4 real · 2 false/);
  assert.doesNotMatch(html, /<b>checks<\/b>/);
});

test('the scorecard shows the change against the previous snapshot, and nothing without a scorecard', () => {
  const was = {detectors: [{source: 'ai-review', precision: 50}, {source: 'layout-check', precision: 20}]};
  const html = scoreSection(card, was);
  assert.match(html, /▲ 10/);
  assert.match(html, /▼ 9/);
  assert.equal(scoreSection(null), '');
  assert.equal(scoreSection({}), '');
});

const entries = Array.from({length: 20}, (_, i) => ({id: `f${i}`, date: '2026-11-04', view: 'profile', title: i === 19 ? 'A <script>x</script> finding' : `finding ${i}`, word: 'false-positive', why: 'because'}));

test('the noise card lists the newest 15, escapes them, and shows Forget only to the owner', () => {
  const owner = noiseSection({entries}, true), admin = noiseSection({entries}, false);
  assert.equal((owner.match(/value="forget"/g) || []).length, 15);
  assert.doesNotMatch(admin, /Forget/);
  assert.doesNotMatch(owner, /<script>/);
  assert.match(owner, /20 remembered, the latest 15/);
  assert.equal(noiseSection(null), '');
  assert.match(noiseSection({entries: []}), /nothing remembered/);
});

const audits = [{week: '2026-11-07', closed: null, items: [{key: 'i1', word: 'false-positive', what: 'Gmail status', why: 'x', where: '#1', tick: 'right'}, {key: 'i2', word: 'needs-human', what: 'Calendar', why: 'y', where: '#2', tick: null}]},
  {week: '2026-10-31', closed: '2026-11-07', score: {right: 4, wrong: 1, size: 5}, items: []}];

test('the audit card: the owner gets 👍/👎 buttons with the ticked one pressed, an admin sees the ticks, the closed audits show their score', () => {
  const owner = auditSection({audits}, true), admin = auditSection({audits}, false);
  assert.match(owner, /1 of 2 ticked/);
  assert.match(owner, /aria-pressed="true"/);
  assert.equal((owner.match(/value="tick"/g) || []).length, 4);
  assert.doesNotMatch(admin, /type="submit"/);
  assert.match(admin, /👍 right/);
  assert.match(owner, /4 of 5 right/);
  assert.equal(auditSection({audits: []}, true), '');
});

test('Red main: a red suite shows its state, breaking PR and bisect; green and no-data are said in words; a link that is not GitHub is not drawn', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const html = redMain({at: '2026-11-05T11:00:00Z', reds: [{suite: 'focusdismiss', status: 'found', since: '8fc460d1111', sinceAt: '2026-11-01T12:00:00Z', run: 'https://github.com/jobadabra/jobadabra/actions/runs/1', pr: {number: 2795, branch: 'a8-wizard-standin', title: 'AI replay key'}, good: 'd1495ce0000', tested: [['59b9a0c1', 'failure']]},
    {suite: 'settings', status: 'bisecting', since: 'abc1234', sinceAt: '2026-11-05T06:00:00Z', run: 'javascript:alert(1)'}]}, now);
  assert.match(html, /2 red/);
  assert.match(html, /#2795/);
  assert.match(html, /a8-wizard-standin/);
  assert.match(html, /4 d ago/);
  assert.match(html, /6 h ago/);
  assert.match(html, /bisecting/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(redMain({at: 'x', reds: []}, now), /main is green/);
  assert.match(redMain(null, now), /no data yet/);
});
