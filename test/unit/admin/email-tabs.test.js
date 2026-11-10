// The tabs of /admin/growth/email (owner, 5 Nov 2026: "Let's split Emails page in Admin into tabs. We have too many things on one single page"). Each tab is a link; every section lives in exactly one tab;
// a result comes back to the tab it belongs to; a tab loads only what it draws. Fake D1.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {collect} from '../../../admin/email-data.js';
import {page, view} from '../../../admin/email.js';
import {TABS, tabHref, tabOf} from '../../../admin/email-tabs.js';
import {resetSwitchCache} from '../../../shared/mail-switches.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  resetSwitchCache();
  const db = new DatabaseSync(':memory:');
  for (const file of ['0078_test_mail.sql', '0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0085_mail_held.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql', '0135_mail_on.sql', '0137_mail_switch.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values), run: async () => db.prepare(text).run(...args),
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text)};
}
const env = () => ({STATS: d1(), STATS_SALT: 'salt', STATS_KEY: 'k', STATS_API_KEY: 'owner-key', MAIL: 'on', MARKETING_MAIL: 'off', WAITLIST: {list: async () => ({keys: [], list_complete: true})}});
const get = (e, query = '') => view(new Request(`https://www.jobadabra.top/admin/growth/email${query}`, {headers: {Authorization: 'Bearer owner-key'}}), e).then(response => response.text());
const IDS = ['overview', 'settings', 'people', 'releases', 'templates'];
// What each section's heading says, and the only tab that may carry it.
const SECTIONS = {overview: ['Per day', 'By template', 'Why mail was not sent', 'Last 10 refusals and failures'], settings: ['Switches', 'Mail types and rules'],
  people: ['Addresses', 'Stopped (all time)'], releases: ['Release emails'], templates: ['Email previews', 'Test inbox']};
const TILES = {overview: ['Sent', 'Not sent', 'Failed', 'Bounces and complaints', 'Held for the digest'], people: ['Trial accounts', 'Confirmed', 'Unconfirmed', 'Always on paused', 'Converted to Pro']};

test('five tabs, one question each, in the order the owner picked', () => {
  assert.deepEqual(TABS.map(tab => tab.id), IDS);
  assert.ok(TABS.every(tab => tab.name && tab.asks));
});

test('a request opens the tab it names, else the one its result belongs to, else Overview', () => {
  const of = query => tabOf(new URLSearchParams(query));
  assert.equal(of('tab=people'), 'people');
  assert.equal(of('tab=nope'), 'overview');
  assert.equal(of(''), 'overview');
  assert.equal(of('days=30'), 'overview');
  assert.equal(of('test=welcome:sent&destination=inbox'), 'templates');   // a test send comes back to Templates
  assert.equal(of('confirm=MARKETING_MAIL'), 'settings');   // a switch waiting for its second press
  assert.equal(of('tab=releases&test=x'), 'releases');   // an explicit tab wins
  assert.equal(tabHref('overview', 30), '/admin/growth/email?tab=overview&days=30');
  assert.equal(tabHref('people', 90), '/admin/growth/email?tab=people&days=90');   // a chosen window travels with every tab
  assert.equal(tabHref('people', 7), '/admin/growth/email?tab=people');   // the default does not clutter the link
});

test('every tab draws the bar with itself marked as the current page, and only its own sections', async () => {
  const e = env(), data = await collect(e, {days: 7});
  for (const tab of IDS) {
    const html = page(data, null, null, null, [], undefined, tab);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1, tab);
    assert.match(html, new RegExp(`<a href="/admin/growth/email\\?tab=${tab}[^"]*" aria-current="page">`), tab);
    const withTiles = page(data, {trial: 1, confirmed: 1, unconfirmed: 0, paused: 0, converted: 0}, null, null, [], undefined, tab);
    for (const other of IDS) for (const label of TILES[other] || []) assert.equal(withTiles.includes(`<span class="muted">${label}</span>`), other === tab, `tile ${label} belongs to ${other}, seen on ${tab}`);
    for (const other of IDS) for (const heading of SECTIONS[other]) assert.equal(html.includes(`<h2>${heading}</h2>`) || html.includes(`<h2>${heading} `), other === tab, `${heading} belongs to ${other}, seen on ${tab}`);
  }
});

test('the day window is picked on Overview, and every tab link keeps it (Overview, then Settings, then Overview stays on 30 days)', async () => {
  const e = env(), data = await collect(e, {days: 30});
  assert.match(page(data), /<b>30 days<\/b>/);
  assert.match(page(data), /href="\/admin\/growth\/email\?tab=overview&days=7"/);
  for (const tab of IDS) assert.match(page(data, null, null, null, [], undefined, tab), tab === 'overview' ? /href="\/admin\/growth\/email\?tab=settings&days=30"/ : /href="\/admin\/growth\/email\?tab=overview&days=30"/, tab);
  for (const tab of IDS.slice(1)) assert.doesNotMatch(page(data, null, null, null, [], undefined, tab), /<b>30 days<\/b>/, tab);   // the picker itself is only on Overview
});

test('through the real view: each tab loads only what it draws (no address list unless People, no drafts unless Releases)', async () => {
  const e = env();
  let listed = 0;
  e.WAITLIST = {list: async () => { listed++; return {keys: [], list_complete: true}; }};
  for (const tab of IDS) assert.match(await get(e, `?tab=${tab}`), /aria-label="E-mail sections"/, tab);
  assert.equal(listed, 1, 'the waitlist is listed once: for the People tab');
  assert.match(await get(e), /aria-current="page">Overview</);   // no ?tab= opens Overview
  assert.match(await get(e, '?test=welcome:sent&destination=inbox'), /aria-current="page">Templates</);
});

test("the owner's round trip: a test send comes back to Templates, and its 'View the test inbox' link stays on Templates", async () => {
  const e = {...env(), EMAIL: {send: async () => ({messageId: 'm1'})}};
  const sent = await view(new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers: {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams({template: 'welcome'})}), e);
  const back = new URL(sent.headers.get('Location'), 'https://www.jobadabra.top');
  const html = await get(e, back.search);
  assert.match(html, /aria-current="page">Templates</);
  assert.match(html, /id="test-result-welcome"/);
  assert.equal(html.match(/href="([^"]*)">View the test inbox/)?.[1], '/admin/growth/email?tab=templates#test-inbox');
  assert.match(await get(e, '?tab=templates'), /id="test-inbox"/);
});

test('the pages that link into the E-mail page land on the tab that has what they mean', () => {
  const read = file => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
  assert.match(read('admin/release-mail-page.js'), /href="\/admin\/growth\/email\?tab=releases">← All email/);
  assert.match(read('admin/email.js'), /href="\/admin\/growth\/email\?tab=templates">← All email/);
  // Why (10 Nov 2026): the two owner pings are cards built in shared/owner-cards.js (emailCard, waitlistCard); the senders only pass facts.
  assert.match(read('shared/owner-cards.js'), /admin\/growth\/email\?tab=people/);
  assert.match(read('api/account-email.js'), /emailCard/);
  assert.match(read('workers/www/index.js'), /waitlistCard/);
});
