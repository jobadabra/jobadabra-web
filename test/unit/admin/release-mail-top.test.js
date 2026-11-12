// The release mail's top changes (shared/mail-release.js highlightsOf) and one change per title across a stable window (admin/release-mail.js stableWindow):
// owner, 12 Nov 2026, on the 0.9.23 mail ("hard to read", "not welcoming", "Faster job searches" twice). Fake D1/KV and sender; no real address.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {releaseData, draft} from '../../../admin/release-mail.js';
import {releaseView} from '../../../admin/release-mail-page.js';
import {compose} from '../../../shared/mail.js';
import {now, setup} from './release-mail-fixture.js';

test('a change a beta and the stable both name shows once, with the newest text (owner, 12 Nov 2026: "Faster job searches" twice in the 0.9.23 mail)', async () => {
  const {e} = setup();
  e.STATS.db.exec('DELETE FROM changelog_entries');
  const add = (version, channel, items) => e.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,0,?,?)')
    .run(version, '2026-11-12', channel, JSON.stringify([{kind: 'improvements', items}]), 'x');
  add('0.9.21', 'stable', [{emoji: '🔎', lead: 'Find nearby jobs first', text: 'Older stable.'}]);
  add('0.9.22', 'beta', [{emoji: '⚡', lead: 'Faster job searches', text: 'Find jobs gets known-location results sooner.'}, {emoji: '📍', lead: 'More precise locations', text: 'Keeps your town.'}]);
  add('0.9.23', 'stable', [{emoji: '🔎', lead: 'faster job searches.', text: 'Find jobs starts checking job boards right away.'}]);
  const data = await releaseData(e, {version: '0.9.23'});
  assert.deepEqual(data.sections.map(section => [section.version, section.title, section.emoji]), [['0.9.22', 'More precise locations', '📍'], ['0.9.23', 'faster job searches.', '🔎']]);
  assert.equal(data.sections[1].text, 'Find jobs starts checking job boards right away.', 'the newest version\'s text is the one kept');
  const {html, text} = compose('release', data);
  assert.equal(html.match(/aster job searches/g).length, 1);
  assert.equal(text.match(/aster job searches/g).length, 1);
});

test('the owner ticks up to three top changes on the review page; the mail and its test show them first; none ticked is the automatic pick', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  const headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'};
  const page = async () => (await releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {headers}), e)).text();
  const ticked = html => [...html.matchAll(/name="top" value="([^"]+)" checked/g)].map(found => found[1]);
  assert.deepEqual(ticked(await page()), ['features|Faster jobs', 'features|Calendar'], 'the automatic pick is ticked; a fix is not');
  const post = top => releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {method: 'POST', headers, body: new URLSearchParams([['action', 'highlights'], ...top.map(title => ['top', title])])}), e);
  const saved = await post(['fixes|A fix', 'features|Calendar', 'features|Faster jobs', 'features|Extra']);
  assert.match(decodeURIComponent(saved.headers.get('Location')), /Top changes saved: A fix, Calendar, Faster jobs\./, 'at most three are kept');
  assert.deepEqual(ticked(await page()), ['features|Faster jobs', 'features|Calendar', 'fixes|A fix']);
  await releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {method: 'POST', headers, body: new URLSearchParams({action: 'test', to: 'reviewer@example.com'})}), e);
  assert.ok(sent[0].html.indexOf('A fix') < sent[0].html.indexOf('Open Jobadabra App'), 'the test mail shows the ticked fix first');
  await post([]);
  assert.deepEqual(ticked(await page()), ['features|Faster jobs', 'features|Calendar'], 'none ticked: back to the automatic pick');
  const stranger = await releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {method: 'POST', headers: {Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams({action: 'highlights', top: 'A fix'})}), e);
  assert.equal(stranger.status, 404);
  assert.equal(JSON.parse(e.STATS.db.prepare("SELECT data FROM release_mail WHERE version='0.8.42'").get().data).highlights.length, 0);
});
