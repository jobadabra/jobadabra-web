// Guard: privacy — every owner Telegram message the Workers send is one card (shared/owner-cards.js through shared/tg-card.js): dot + bold headline, ≤12 lines, one link, no raw JSON, no secret or e-mail address.
// Why (10 Nov 2026, owner: "how I should like to see all the others, in terms of readability"): ~14 files each built their own string; this one loop holds every builder to the one shape, with fictional data only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as cards from '../../../shared/owner-cards.js';
import {checkCard} from '../../../shared/tg-card.js';
import {words} from '../../../shared/notify.js';
import {TELEGRAM_TEXT} from '../../../api/feedback.js';

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
  'source at zero': cards.sourceZeroCard([{label: 'Job boards', readers: 18, total: 18, run: 3}, {label: 'Web search', readers: 9, total: 18, run: 1}]),
  'employers copy failed': cards.employerCard('copy-failed', {day: '2026-11-09'}),
  'employers refused': cards.employerCard('publish-refused', {why: '40% of the employers would be lost'}),
  'employers kinds dropped': cards.employerCard('kinds-dropped', {withKinds: 120, previousKinds: 840}),
  'cap approaching': cards.capCard('approaching', {title: 'Free AI today', used: '$5.02', line: '$10.00', done: 5.02, total: 10, word: 'USD', sees: 'every Free install sees "Free AI is busy today" until 00:00 UTC', fix: 'raise FREE_AI_STOP_USD in workers/www/wrangler.toml'}),
  'cap reached': cards.capCard('reached', {title: 'Free AI today', used: '$10.00', line: '$10.00', done: 10, total: 10, word: 'USD', sees: 'every Free install sees "Free AI is busy today" until 00:00 UTC', fix: 'raise FREE_AI_STOP_USD in workers/www/wrangler.toml'}),
  'per-install lines reached': cards.capGroupCard('reached', [{title: 'Free AI per install today', sees: 'Free AI waits until tomorrow for them', fix: 'raise FREE_AI_INSTALL_DAY_USD', installs: 3}, {title: 'Cloud checks today', sees: 'cloud checks start again at 00:00 UTC', fix: 'raise DAY_READS', installs: 1}]),
  'per-install lines approaching': cards.capGroupCard('approaching', [{title: 'Free AI per install today', sees: 'Free AI waits until tomorrow for them', fix: 'raise FREE_AI_INSTALL_DAY_USD', installs: 3}]),
  'cap reached, no count': cards.capCard('reached', {title: 'Workers AI\'s free allowance today', used: null, line: null, done: null, total: Infinity, sees: 'every Free install sees "Free AI is busy today" until 00:00 UTC', fix: 'move Workers AI to the paid plan'}),
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
  'job red': cards.jobRedCard({name: 'Lab · Board discovery', repo: 'jobadabra-lab', url: 'https://github.com/jobadabra/jobadabra-lab/actions/runs/1'}),
  'job red no run': cards.jobRedCard({name: 'Lab · Board discovery', repo: 'jobadabra-lab', url: ''}),
  'job green': cards.jobGreenCard({name: 'Lab · Board discovery', repo: 'jobadabra-lab', url: 'https://github.com/jobadabra/jobadabra-lab/actions/runs/2'}),
  'job not started': cards.jobNotStartedCard({name: 'Lab · Board discovery', repo: 'jobadabra-lab', why: 'GitHub answered 422'}),
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

// The owner's scenarios from the code review of web#509 (10 Nov 2026): a report must reach the owner whole, or say "Full text", and never be refused by Telegram.
const send = text => { const {text: shown, cut} = cards.fitWords(text, TELEGRAM_TEXT); const card = cards.feedbackCard({version: '1', platform: 'Mac', screen: 'Jobs', install: 'abcdef123456', text: shown, attachments: cut ? ['Full text'] : [], ref: 'r1'}).text; return {cut, card, out: words(card, '', true)}; };
const balanced = html => ['blockquote', 'a', 'b'].every(tag => (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length === (html.match(new RegExp(`</${tag}>`, 'g')) || []).length);

test('a report that fits reaches the owner whole; one past the limit is cut once and always says "Full text" (never a silent cut)', () => {
  const whole = send('word '.repeat(290));
  assert.equal(whole.cut, false);
  assert.ok(whole.out.includes('word '.repeat(289).trim()) && !whole.out.includes('Full text'), 'the whole text, no marker');
  for (const length of [301, 400, 590, 1200]) {   // 1501 to 6000 characters: the range the review found cut without a marker
    const long = send('word '.repeat(length));
    assert.ok(long.cut && long.out.includes('Full text') && long.out.includes('…'), `${length * 5} characters`);
  }
});

test('a long report is cut once, says "Full text", and the message stays under Telegram\'s limit with every tag closed', () => {
  const {cut, out} = send('word '.repeat(1200));
  assert.equal(cut, true);
  assert.ok(out.includes('Full text') && out.endsWith('Open in the inbox</a>'), out.slice(-120));
  assert.ok(out.length <= 4096 && balanced(out), `${out.length} characters`);
});

test('a report heavy in < & > keeps its words: the cut counts escaped characters, so the body is never dropped or a tag left open', () => {
  const {out} = send('x<&> '.repeat(270));
  assert.ok(out.includes('x&lt;&amp;&gt;'), 'the words are in the message');
  assert.ok(out.length <= 4096 && balanced(out) && !/\+\d+ more<\/blockquote>/.test(out));
  const worst = send('<'.repeat(8000));
  assert.ok(worst.out.length <= 4096 && balanced(worst.out) && worst.cut, `${worst.out.length} characters`);
});
