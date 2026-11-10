// Guard: privacy — every owner Telegram message the Workers send is one card (shared/owner-cards.js through shared/tg-card.js): dot + bold headline, ≤12 lines, one link, no raw JSON, no secret or e-mail address.
// Why (10 Nov 2026, owner: "how I should like to see all the others, in terms of readability"): ~14 files each built their own string; this one loop holds every builder to the one shape, with fictional data only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as cards from '../../../shared/owner-cards.js';
import {checkCard} from '../../../shared/tg-card.js';

const item = {shortId: 'JOBADABRA-APP-7K', title: "TypeError: Cannot read properties of undefined (reading 'fields')", level: 'error', culprit: 'extension/flow.js in fillStep', count: '14', userCount: 3, firstSeen: '2026-11-09T14:02:11Z', permalink: 'https://job-pilotto.sentry.io/issues/7/'};
const night = {measured: 11, total: 18, need: 12, reasons: ['measured', 'local', 'employer-sites'], local: 31, usual: 52.4, out: 6};
const SAMPLES = {
  'sentry new': cards.sentryCard(item, 'new', {version: '0.9.17'}),
  'sentry crash with a fix': cards.sentryCard({...item, level: 'fatal'}, 'regressed', {fix: {text: 'fix to review', url: 'https://github.com/x/y/pull/9'}}),
  'sentry spike': cards.sentryCard(item, 'spike'),
  'sentry more': cards.sentryMoreCard(6),
  'probe down and up': cards.probeCard([{label: 'Worker health', state: 'down', redSince: '2026-11-09T09:10:00Z', streak: 3, reason: 'HTTP 503 from /health'}, {label: 'Employer index', state: 'up', redSince: '2026-11-09T08:40:00Z'}]),
  'night dropped': cards.nightCard(night),
  'night missing': cards.nightMissingCard(),
  'employers copy failed': cards.employerCard('copy-failed', {day: '2026-11-09'}),
  'employers refused': cards.employerCard('publish-refused', {why: '40% of the employers would be lost'}),
  'employers kinds dropped': cards.employerCard('kinds-dropped', {withKinds: 120, previousKinds: 840}),
  'free ai day': cards.freeAiCard('day', {usd: 2, stop: 5}),
  'free ai month': cards.freeAiCard('month', {usd: 40, stop: 60}),
  'free ai neurons': cards.freeAiCard('neurons', {used: 8000, allowance: 10000}),
  'feedback': cards.feedbackCard({version: '0.9.17', platform: 'Windows', screen: 'Jobs', install: '3f9a21bc77', text: 'The Apply button does nothing after I upload my CV.', attachments: ['Screenshot', 'Logs'], ref: 'fb-2041'}),
  'form reported': cards.formReportedCard({cause: 'The fill failed', requests: 12, who: '3f9a21bc77', time: '14:32'}),
  'forms more': cards.formsMoreCard(),
  'e-mail added': cards.emailCard({changed: false, install: '3f9a21bc77', total: 118}),
  'e-mail changed': cards.emailCard({changed: true, install: '3f9a21bc77', total: 1}),
  'feedback overdue one': cards.overdueCard({ref: 'fb-2041', version: '0.9.17'}),
  'feedback overdue many': cards.overdueCard({count: 5}),
  'impact down': cards.impactDownCard({kind: 'limit', failed: 4, last: 'Workers AI 429: daily limit reached'}),
  'waitlist': cards.waitlistCard({role: 'nurse', fromApp: true}),
  'release mail': cards.releaseMailCard({version: '0.9.17', headline: 'Find jobs tells you what comes next'}),
  'build log': cards.digestCard({day: '9 Nov', count: 7, open: 'the Microsoft Store review', groups: ['🧭', '🔔', '🧪', '🧩', '🔧'].map((emoji, i) => ({emoji, title: `Goal ${i}`, lead: 'A lead', more: i}))}),
  'build log empty': cards.digestCard({day: '9 Nov', count: 0, open: '', groups: []}),
  'admin test': cards.testCard('Engineering'),
};

test('every owner message of the Workers is one card: dot + bold headline, ≤12 lines, one link, no raw JSON, no secret or e-mail', () => {
  assert.ok(Object.keys(SAMPLES).length >= 20, 'positive control: the samples were built');
  for (const [name, payload] of Object.entries(SAMPLES)) assert.deepEqual(checkCard(payload), [], `${name}\n${payload.text}`);
});

test('every builder of owner-cards.js has a sample above, so a new alert cannot skip the shape check', () => {
  const sampled = JSON.stringify(Object.keys(SAMPLES));
  assert.ok(Object.keys(cards).length >= 17, 'positive control: the module exports its builders');
  assert.ok(Object.keys(SAMPLES).length >= Object.keys(cards).length, `${Object.keys(cards).length} builders, ${Object.keys(SAMPLES).length} samples: ${sampled}`);
});

test('a person\'s words are a folded quote, escaped; their address and the markup in them never reach the card as markup', () => {
  const text = cards.feedbackCard({version: '1', platform: 'Mac', screen: '', install: 'abcdef123456', text: '<b>hi</b> & <a href="x">z</a>', attachments: [], ref: 'r1'}).text;
  assert.match(text, /<blockquote expandable>&lt;b&gt;hi&lt;\/b&gt; &amp; &lt;a href="x"&gt;z&lt;\/a&gt;<\/blockquote>/);
  assert.equal((text.match(/<a /g) || []).length, 1);
});
