// The release mail (admin/release-mail.js, shared/mail-release.js): a version is drafted once from its What's new entry, goes to every address not stopped (accounts and the waitlist),
// never twice, never to an unsubscribed or bounced address, never before the owner sends it and MARKETING_MAIL is on; every promotional template carries the unsubscribe link. Fake sender and fake D1/KV; no real address.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {dataFrom, draft, sendAll, audience, ingest, releaseData, releaseRoute} from '../../../admin/release-mail.js';
import {resetRuleCache, setRule} from '../../../shared/mail-registry.js';
import {ingest as changelogIngest} from '../../../admin/changelog-store.js';
import {SAMPLES} from '../../../admin/email-preview.js';
import {compose, send, stopLink, settingsLink, addrOf} from '../../../shared/mail.js';
import {TEMPLATES} from '../../../shared/mail-templates.js';
import {createAccount} from '../../../shared/pro.js';
import {unsubscribe} from '../../../api/mail-unsub.js';
import {releaseView, reach} from '../../../admin/release-mail-page.js';
import {audienceRows, audienceCard} from '../../../admin/email-audience.js';
import {testSend} from '../../../admin/email-test-send.js';
import {view as emailView} from '../../../admin/email.js';

const sql = file => readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0079_pro.sql', '0082_pro_trial.sql', '0083_mail.sql', '0093_changelog.sql', '0105_changelog_plain.sql', '0117_release_mail.sql', '0135_mail_on.sql']) db.exec(sql(file));
  const statement = (text, args = []) => ({bind: (...values) => statement(text, values),
    run: async () => { const r = db.prepare(text).run(...args); return {meta: {changes: Number(r.changes)}}; },
    all: async () => ({results: db.prepare(text).all(...args)}), first: async () => db.prepare(text).get(...args) ?? null});
  return {db, prepare: text => statement(text), batch: async list => { for (const item of list) await item.run(); }};
}
const meta = value => { try { return JSON.parse(value); } catch { return undefined; } };
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); },
  list: async ({prefix}) => ({keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({name, metadata: meta(m.get(name))})), list_complete: true})}; };   // the Worker puts the entry and its metadata together (workers/www/index.js)
const now = new Date('2026-10-28T10:00:00Z');
const WEB = JSON.stringify({source: 'web'});   // a signup from the website form (shared/mail-lists.js signupKind)
const answered = async (e, ...emails) => { for (const email of emails) e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES (?, 'releases', 'card', 'x')").run(await addrOf(email)); };   // the person saved the card in the app
const confirm = (e, ...emails) => e.STATS.db.prepare(`UPDATE pro_accounts SET email_confirmed_at = 'x' WHERE email IN (${emails.map(() => '?').join(',')})`).run(...emails);
const groups = [{kind: 'features', items: [{lead: 'Faster jobs', text: 'Open a job and see why it fits.'}, {lead: 'Calendar', text: 'Interviews show on a calendar.'}]}, {kind: 'fixes', items: [{lead: 'A fix', text: 'Something works.'}]}];
function setup(extra = {}) {
  const sent = [], e = {MAIL: 'on', MARKETING_MAIL: 'on', STATS: d1(), WAITLIST: kv(), STATS_SALT: 'salt', SELFHEAL_PUBLISH_KEY: 'k', EMAIL: {send: async m => { sent.push(m); return {messageId: `m${sent.length}`}; }}, ...extra};
  e.STATS.db.prepare('INSERT INTO changelog_entries (version, date, channel, hidden, body, at) VALUES (?, ?, ?, 0, ?, ?)').run('0.8.42', '2026-10-27', 'stable', JSON.stringify(groups), 'x');
  return {e, sent};
}

test('the draft comes from the changelog entry: keeps new, improved and fixed changes', () => {
  const data = dataFrom({version: '0.8.42', date: '2026-10-27', groups});
  assert.equal(data.headline, 'Open a job and see why it fits');
  assert.equal(data.month, 'October 2026');
  assert.deepEqual(data.sections.map(s => s.title), ['Faster jobs', 'Calendar', 'A fix']);
  assert.deepEqual(data.sections.map(s => s.kind), ['features', 'features', 'fixes']);
});

test('a version is drafted once; a second promotion call changes nothing; an unknown version drafts nothing', async () => {
  const {e} = setup();
  assert.deepEqual(await draft(e, '0.8.42', now), {drafted: true});
  assert.deepEqual(await draft(e, '0.8.42', now), {exists: true});
  assert.deepEqual(await draft(e, '9.9.9', now), {refused: 'not stable'});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) n FROM release_mail').get().n, 1);
});

test('the trigger from a fake promotion: wrong key is a 404, right key drafts', async () => {
  const {e} = setup();
  const call = key => ingest(new Request('https://x/release-mail/draft', {method: 'POST', headers: {Authorization: `Bearer ${key}`}, body: JSON.stringify({version: '0.8.42'})}), e);
  assert.equal((await call('wrong')).status, 404);
  assert.deepEqual(await (await call('k')).json(), {drafted: true});
});

test('the audience is every confirmed account and website waitlist address, once; an unconfirmed account is out; sending reaches the rest and never mails a version twice', async () => {
  // Why (owner, 5 Nov 2026: "this should be on by default"; "After confirming"): New releases is on for a confirmed address until it stops them.
  const {e, sent} = setup();
  await createAccount(e, 'trial@example.com', now, {plan: 'trial'});
  await createAccount(e, 'stop@example.com', now, {plan: 'trial'});
  await createAccount(e, 'bounced@example.com', now, {plan: 'trial'});
  await createAccount(e, 'never@example.com', now, {plan: 'trial'});
  confirm(e, 'trial@example.com', 'stop@example.com', 'bounced@example.com');
  await answered(e, 'trial@example.com', 'stop@example.com', 'bounced@example.com');
  await e.WAITLIST.put('signup:wait@example.com', WEB);
  await e.WAITLIST.put('signup:trial@example.com', WEB);   // on both lists: once
  assert.equal((await audience(e)).length, 4);
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'releases', 'unsubscribe', 'x')").run(await addrOf('stop@example.com'));
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'all', 'bounce', 'x')").run(await addrOf('bounced@example.com'));
  assert.equal((await audience(e)).length, 2, 'the stopped are out of the audience itself');
  await draft(e, '0.8.42', now);
  assert.deepEqual(await sendAll(e, '0.8.42', {now}), {sent: 2, skipped: 0});
  assert.deepEqual(sent.map(m => m.to).sort(), ['trial@example.com', 'wait@example.com']);
  assert.ok(sent.every(m => m.from.startsWith('Igor from Jobadabra <')));
  assert.deepEqual(await sendAll(e, '0.8.42', {now}), {refused: 'not a draft'});
  assert.equal(sent.length, 2);
});

test('with MARKETING_MAIL off nothing is sent', async () => {
  const {e, sent} = setup({MARKETING_MAIL: 'off'});
  await e.WAITLIST.put('signup:wait@example.com', WEB);
  await draft(e, '0.8.42', now);
  await sendAll(e, '0.8.42', {now});
  assert.equal(sent.length, 0);
});

test('every promotional template carries the unsubscribe link in its html and text, and the one-click header', () => {
  const links = {stop: 'https://www.jobadabra.top/unsubscribe?stop', settings: 'https://www.jobadabra.top/email-settings?x'};
  for (const [name, spec] of Object.entries(TEMPLATES).filter(([, spec]) => spec.list === 'marketing')) {
    const mail = compose(name, SAMPLES[name], links);
    assert.ok(mail.html.includes(links.stop) && mail.text.includes(links.stop), `${name}: no stop link in the footer`);
    assert.equal(mail.headers['List-Unsubscribe'], `<${links.stop}>`, name);
  }
});

test('the release mail renders: emphasis, categorized changes, the stop link', () => {
  const mail = compose('release', SAMPLES.release, {stop: 'https://s/stop', settings: 'https://s/set'});
  assert.equal(mail.subject, `Jobadabra ${SAMPLES.release.version} · What's new`);
  assert.ok(mail.html.includes('Improved') && mail.html.includes('Open Jobadabra App') && mail.html.includes('https://s/stop'));
  assert.match(mail.html, /<strong[^>]*>Jobs<\/strong>/);
  assert.ok(!mail.text.includes('*'));
});

test('the stable promotion starts the draft: CI marking a stored beta version stable drafts its mail once; a beta alone drafts nothing', async () => {
  const {e} = setup();
  e.STATS.db.prepare("UPDATE changelog_entries SET channel = 'beta' WHERE version = '0.8.42'").run();
  const put = body => changelogIngest(new Request('https://x/changelog/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify(body)}), e);
  assert.equal((await put({channels: {}})).status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) n FROM release_mail').get().n, 0);
  assert.equal((await put({channels: {'0.8.42': 'stable'}})).status, 200);
  assert.equal((await put({channels: {'0.8.42': 'stable'}})).status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) n FROM release_mail').get().n, 1);
});

test('a new draft sends the owner one Telegram message with the link to check and send it; a second call sends none', async () => {
  const {e} = setup({BUILDLOG_TELEGRAM_TOKEN: 't', BUILDLOG_TELEGRAM_CHAT: 'c'}), told = [];
  const fetch = async (url, init) => { told.push(JSON.parse(init.body).text); return {ok: true}; };
  await draft(e, '0.8.42', now, {fetch});
  await draft(e, '0.8.42', now, {fetch});
  assert.equal(told.length, 1);
  assert.match(told[0], /0\.8\.42/);
  assert.ok(told[0].includes('https://www.jobadabra.top/admin/growth/email?release=0.8.42'));
});

test('the review page shows the mail and "Send to N people" (N = who would get it now); the button sends once and saves a headline', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await createAccount(e, 'a@example.com', now, {plan: 'trial'});
  await createAccount(e, 'stop@example.com', now, {plan: 'trial'});
  await createAccount(e, 'never@example.com', now, {plan: 'trial'});
  confirm(e, 'a@example.com', 'stop@example.com');
  await answered(e, 'a@example.com', 'stop@example.com');
  await e.WAITLIST.put('signup:w@example.com', WEB);
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'releases', 'unsubscribe', 'x')").run(await addrOf('stop@example.com'));
  await draft(e, '0.8.42', now);
  assert.equal(await reach(e), 2);
  const owner = {Authorization: 'Bearer owner-key'};
  const get = await releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {headers: owner}), e);
  const html = await get.text();
  assert.equal(get.status, 200);
  assert.match(html, /Send to 2 people/);
  assert.match(html, /srcdoc=/);
  assert.equal((await releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42'), e)).status, 404, 'not signed in: not found');
  const post = (action, extra = {}) => releaseView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {method: 'POST', headers: {...owner, Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams({action, ...extra})}), e);
  assert.equal((await post('headline', {headline: 'A better headline'})).status, 303);
  assert.equal(JSON.parse(e.STATS.db.prepare('SELECT data FROM release_mail').get().data).headline, 'A better headline');
  await post('send'); await post('send');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].subject, "Jobadabra 0.8.42 · What's new");
  assert.match(sent[0].html, /A better headline/);
});

test('the news list shows every address with its source and what each type does for it; only the owner sees addresses', async () => {
  const {e} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  e.STATS.db.exec('CREATE TABLE IF NOT EXISTS test_mail (received_at TEXT, to_addr TEXT, subject TEXT)');
  await createAccount(e, 'a@example.com', now, {plan: 'trial'});
  await createAccount(e, 'stop@example.com', now, {plan: 'trial'});
  await createAccount(e, 'never@example.com', now, {plan: 'trial'});
  confirm(e, 'a@example.com', 'stop@example.com', 'never@example.com');
  await answered(e, 'a@example.com', 'stop@example.com');
  await e.WAITLIST.put('signup:a@example.com', WEB);
  await e.WAITLIST.put('signup:w@example.com', WEB);
  await e.WAITLIST.put('signup:app@example.com', JSON.stringify({source: 'app'}));
  e.STATS.db.prepare("INSERT INTO mail_off (addr, list, reason, at) VALUES (?, 'releases', 'unsubscribe', 'x')").run(await addrOf('stop@example.com'));
  e.STATS.db.prepare("INSERT INTO mail_on (addr, list, via, at) VALUES (?, 'tips', 'card', 'x')").run(await addrOf('a@example.com'));
  const rows = await audienceRows(e), by = Object.fromEntries(rows.map(r => [r.email, r]));
  assert.deepEqual(rows.map(r => [r.email, r.source, r.releases]).sort(), [['a@example.com', 'both', true], ['app@example.com', 'waitlist', false], ['never@example.com', 'account', false], ['stop@example.com', 'account', false], ['w@example.com', 'waitlist', true]]);
  assert.deepEqual([by['a@example.com'].tips, by['w@example.com'].tips, by['w@example.com'].launch, by['app@example.com'].launch, by['never@example.com'].launch], [true, false, true, true, false], 'tips need a tick; the Pro launch also reaches every waitlist signup');
  assert.deepEqual([by['never@example.com'].releasesWhy, by['stop@example.com'].releasesWhy, by['app@example.com'].releasesWhy], ['not ticked', 'stopped', 'not ticked'], 'What\'s new needs a yes');
  assert.match(audienceCard(rows), /2 What's new, 1 News and tips, 0 Job digest, 5 addresses/);
  const page = async headers => (await emailView(new Request('https://www.jobadabra.top/admin/growth/email?tab=people', {headers}), e)).text();
  assert.match(await page({Authorization: 'Bearer owner-key'}), /w@example\.com/);
  assert.doesNotMatch(await page({}), /w@example\.com/);
});

test('"Send to my email" mails the real release to the typed address; invalid input and non-owners get nothing', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  const post = (fields, headers = {Authorization: 'Bearer owner-key'}) => testSend(new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers: {...headers, Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams(fields)}), e);
  assert.equal((await post({template: 'release', mine: '1', to: 'me@example.com'})).status, 303);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.equal(sent[0].subject, "[TEST] Jobadabra 0.8.42 · What's new");
  assert.equal((await post({template: 'release', mine: '1', to: 'not-an-address'})).status, 400);
  assert.equal((await post({template: 'release', to: 'me@example.com'})).status, 400, 'without "mine" only test inboxes');
  assert.equal((await post({template: 'release', mine: '1', to: 'me@example.com'}, {})).status, 404);
  assert.equal(sent.length, 1);
});

test('the news list costs a fixed number of queries however many addresses there are (Gitar on #218: 2N+1 per page load)', async () => {
  const {e} = setup();
  let queries = 0;
  const prepare = e.STATS.prepare;
  e.STATS = {...e.STATS, prepare: text => { queries++; return prepare(text); }};
  for (let n = 0; n < 30; n++) await e.WAITLIST.put(`signup:person${n}@example.com`, '1');
  const before = queries;
  assert.equal((await audienceRows(e)).length, 30);
  assert.ok(queries - before <= 3, `${queries - before} queries for 30 addresses`);
});

test('the draft ping uses the Brain bot the site Worker already has when no build-log bot is set (no new secret)', async () => {
  const {e} = setup({BRAIN_BOT_TOKEN: 'brain-token', BRAIN_CHAT_ID: '42'}), urls = [], chats = [];
  await draft(e, '0.8.42', now, {fetch: async (url, init) => { urls.push(url); chats.push(JSON.parse(init.body).chat_id); return {ok: true}; }});
  assert.deepEqual([urls.length, urls[0].includes('botbrain-token'), chats[0]], [1, true, '42']);
});


test('release test sends the selected edited draft to one address, labels it as a test and leaves the broadcast pending', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  await e.WAITLIST.put('signup:audience@example.com', WEB);
  const post = fields => emailView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {
    method: 'POST', headers: {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams(fields),
  }), e);
  await post({action: 'headline', headline: 'The edited release headline'});
  const response = await post({action: 'test', to: 'reviewer@example.com'});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'reviewer@example.com');
  assert.equal(sent[0].subject, "[TEST] Jobadabra 0.8.42 · What's new");
  assert.match(sent[0].html, /Test email/);
  assert.match(sent[0].html, /Faster jobs/);
  assert.match(sent[0].text, /Test email/);
  const notice = new URL(response.headers.get('Location'), 'https://www.jobadabra.top').searchParams.get('done');
  assert.match(notice, /0\.8\.42/);
  assert.match(notice, /reviewer@example\.com/);
  assert.match(notice, /Subject: \[TEST\] Jobadabra/);
  assert.match(sent[0].html, /The edited release headline/);
  assert.equal(e.STATS.db.prepare('SELECT status FROM release_mail').get().status, 'draft');
  assert.equal(e.STATS.db.prepare('SELECT sent_count FROM release_mail').get().sent_count, 0);
  await post({action: 'send'});
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject, "Jobadabra 0.8.42 · What's new");
  assert.doesNotMatch(sent[1].html, /Test email/);
});


test('a saved old draft picks up the complete changelog in preview, test and broadcast', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  const old = {version: '0.8.42', month: 'October 2026', headline: 'An old long headline', sections: [{title: 'Faster jobs', text: 'Open a job and see why it fits.'}]};
  e.STATS.db.prepare('INSERT INTO release_mail (version, data, created_at) VALUES (?, ?, ?)').run('0.8.42', JSON.stringify(old), 'x');
  await e.WAITLIST.put('signup:audience@example.com', WEB);
  const request = (fields) => new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {headers: {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'}, ...(fields ? {method: 'POST', body: new URLSearchParams(fields)} : {})});
  const html = await (await emailView(request(), e)).text();
  assert.match(html, /version 0\.8\.42/i);
  assert.match(html, /A fix/);
  await emailView(request({action: 'test', to: 'reviewer@example.com'}), e);
  await emailView(request({action: 'send'}), e);
  for (const mail of sent) {
    assert.match(mail.html, /version 0\.8\.42/i);
    for (const label of ['New', 'Fixed', 'A fix', 'Calendar']) assert.ok(mail.html.includes(label));
    assert.match(mail.text, /Fixed: A fix/);
  }
  assert.equal(sent.length, 2);
});


test('an interrupted broadcast is shown as sending rather than completed', async () => {
  const {e} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  e.STATS.db.exec("UPDATE release_mail SET status = 'sending'");
  const response = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {headers: {Authorization: 'Bearer owner-key'}}), e);
  const html = await response.text();
  assert.match(html, /Sending is in progress/);
  assert.doesNotMatch(html, /already been sent|Sent to 0 on/);
});


test('the owner API introduction edit appears in the versioned email', async () => {
  const {e} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  const response = await releaseRoute(new Request('https://www.jobadabra.top/admin/mail/release?version=0.8.42&headline=An%20owner%20introduction', {method: 'POST', headers: {Authorization: 'Bearer owner-key'}}), e);
  assert.equal(response.status, 200);
  const data = JSON.parse(e.STATS.db.prepare('SELECT data FROM release_mail').get().data);
  assert.match(compose('release', data).html, /An owner introduction/);
});


test('release emails always offer a download link even without an update URL', () => {
  const mail = compose('release', {version: '0.9.9', month: 'November 2026', sections: []});
  assert.match(mail.html, /Don't have the app/);
  assert.match(mail.html, /href="https:\/\/www\.jobadabra\.top\/download"/);
  assert.match(mail.text, /Don't have the app\? Download Jobadabra: https:\/\/www\.jobadabra\.top\/download/);
});

test('direct draft, test and broadcast calls refuse a beta, even if a draft row already exists', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  e.STATS.db.exec("UPDATE changelog_entries SET channel = 'beta' WHERE version = '0.8.42'");
  assert.deepEqual(await draft(e, '0.8.42', now), {refused: 'not stable'});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) n FROM release_mail').get().n, 0);
  e.STATS.db.prepare('INSERT INTO release_mail (version, data, created_at) VALUES (?, ?, ?)').run('0.8.42', JSON.stringify(dataFrom({version: '0.8.42', date: '2026-10-27', groups})), 'x');
  await e.WAITLIST.put('signup:audience@example.com', WEB);
  assert.deepEqual(await sendAll(e, '0.8.42', {now}), {refused: 'not stable'});
  assert.equal(e.STATS.db.prepare('SELECT status FROM release_mail').get().status, 'draft');
  const response = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.8.42', {method: 'POST', headers: {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams({action: 'test', to: 'reviewer@example.com'})}), e);
  assert.equal(response.status, 409);
  assert.equal(sent.length, 0);
});

test('stable mail includes all intervening beta changes, excludes both boundaries and later versions, and removes exact duplicates', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  e.STATS.db.exec('DELETE FROM changelog_entries');
  const add = (version, channel, title, hidden = 0) => e.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,?,?,?)')
    .run(version, '2026-11-05', channel, hidden, JSON.stringify([{kind: 'fixes', items: [{lead: title, text: `${title} works.`}]}]), 'x');
  add('0.9.4', 'stable', 'Old stable');
  add('0.9.6', 'stable', 'Previous stable');
  add('0.9.7', 'beta', 'Beta one');
  add('0.9.8', 'beta', 'Beta two');
  add('0.9.9', 'stable', 'Beta two');
  e.STATS.db.prepare("UPDATE changelog_entries SET body=? WHERE version='0.9.9'").run(JSON.stringify([{kind: 'fixes', items: [{lead: 'Beta two', text: 'Beta two works.'}, {lead: 'Target stable change', text: 'The stable build adds this change.'}]}]));
  add('0.9.10', 'beta', 'Future beta');
  await draft(e, '0.9.9', now);
  const data = JSON.parse(e.STATS.db.prepare("SELECT data FROM release_mail WHERE version='0.9.9'").get().data);
  assert.equal(data.previousStable, '0.9.6');
  assert.deepEqual(data.sections.map(s => s.title), ['Beta one', 'Beta two', 'Target stable change']);
  await e.WAITLIST.put('signup:audience@example.com', WEB);
  const post = fields => emailView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.9.9', {method: 'POST', headers: {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'}, body: new URLSearchParams(fields)}), e);
  // Already stored drafts with category metadata must also be rebuilt from the stable window.
  e.STATS.db.prepare("UPDATE release_mail SET data=? WHERE version='0.9.9'").run(JSON.stringify({...data, sections: [{kind: 'fixes', title: 'Beta two', text: 'Beta two works.'}]}));
  const view = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?release=0.9.9', {headers: {Authorization: 'Bearer owner-key'}}), e);
  assert.match(await view.text(), /Beta one/);
  await post({action: 'test', to: 'reviewer@example.com'});
  await post({action: 'send'});
  assert.equal(sent.length, 2);
  for (const mail of sent) {
    assert.match(mail.html, /Beta one/);
    assert.match(mail.text, /Beta two/);
    assert.match(mail.text, /Target stable change/);
    assert.match(mail.text, /since.*0\.9\.6/i);
    assert.doesNotMatch(mail.text, /Previous stable|Old stable|Future beta/);
  }
});

test('a stable with no final-build notes still includes beta changes; a hidden previous stable is the boundary', async () => {
  const {e} = setup();
  e.STATS.db.exec('DELETE FROM changelog_entries');
  const put = (version, channel, hidden, body) => e.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,?,?,?)').run(version, '2026-11-05', channel, hidden, JSON.stringify(body), 'x');
  put('0.9.6', 'stable', 1, []);
  put('0.9.7', 'beta', 0, groups);
  const response = await changelogIngest(new Request('https://x/changelog/data', {method: 'PUT', headers: {Authorization: 'Bearer k'}, body: JSON.stringify({hidden: [{version: '0.9.9', date: '2026-11-05', channel: 'stable'}]})}), e);
  assert.equal(response.status, 200);
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) n FROM release_mail').get().n, 1);
  const data = JSON.parse(e.STATS.db.prepare('SELECT data FROM release_mail').get().data);
  assert.equal(data.previousStable, '0.9.6');
  assert.deepEqual(data.sections.map(s => s.title), ['Faster jobs', 'Calendar', 'A fix']);
});


test('sent release previews and test copies retain the sent snapshot after changelog edits', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await e.WAITLIST.put('signup:audience@example.com', WEB);
  await draft(e, '0.8.42', now); await sendAll(e, '0.8.42', {now});
  e.STATS.db.prepare('UPDATE changelog_entries SET body=?').run(JSON.stringify([{kind: 'fixes', items: [{lead: 'Replacement notes', text: 'Later edited words.'}]}]));
  const url = 'https://www.jobadabra.top/admin/growth/email?release=0.8.42', headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'};
  const html = await (await emailView(new Request(url, {headers}), e)).text();
  assert.match(html, /Faster jobs/); assert.doesNotMatch(html, /Replacement notes/);
  await emailView(new Request(url, {method: 'POST', headers, body: new URLSearchParams({action: 'test', to: 'reviewer@example.com'})}), e);
  assert.equal(sent.length, 2);
  assert.match(sent[1].html, /Faster jobs/); assert.doesNotMatch(sent[1].html, /Replacement notes/);
});


test('the release action opens the installed app even for an older saved download URL', () => {
  const mail = compose('release', {...SAMPLES.release, updateUrl: 'https://www.jobadabra.top/download'});
  assert.match(mail.html, /href="https:\/\/www\.jobadabra\.top\/open\?view=jobs&amp;utm_source=mail-release"[^>]*>Open Jobadabra App<\/a>/);
  assert.match(mail.text, /Open Jobadabra App: https:\/\/www\.jobadabra\.top\/open\?view=jobs&utm_source=mail-release/);
  assert.doesNotMatch(mail.html, /Download latest version/);
  assert.match(mail.html, /Download Jobadabra/);
  assert.match(mail.html, /<ol[^>]*>/);
  assert.match(mail.text, /1\. Open Jobs\./);
  assert.match(mail.text, /2\. Click any row/);
});

test('the release template opens the newest real stable draft, while gallery and test use its complete interval', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  e.STATS.db.exec('DELETE FROM changelog_entries');
  for (const [version, channel, lead] of [['0.9.6', 'stable', 'Previous stable'], ['0.9.8', 'stable', 'Older stable'], ['0.9.9', 'beta', 'Beta change'], ['0.9.10', 'stable', 'Latest stable change'], ['0.9.11', 'beta', 'Future beta']]) {
    e.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,?,?,?)').run(version, '2026-11-05', channel, 0, JSON.stringify([{kind: 'fixes', items: [{lead, text: `${lead} works.`}]}]), 'x');
  }
  await draft(e, '0.9.8', now); await draft(e, '0.9.10', now);
  e.STATS.db.exec('CREATE TABLE IF NOT EXISTS test_mail (received_at TEXT, to_addr TEXT, subject TEXT)');
  const headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'};
  const response = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?template=release', {headers}), e);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/admin/growth/email?release=0.9.10');
  const page = await (await emailView(new Request('https://www.jobadabra.top/admin/growth/email?tab=templates', {headers}), e)).text();
  assert.match(page, /Latest stable release/);
  assert.match(page, /Latest stable change/);
  assert.doesNotMatch(page, /new in version 0\.8\.42|See why each job fits/);
  await emailView(new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers, body: new URLSearchParams({template: 'release', mine: '1', to: 'reviewer@example.com', release: '0.9.10'})}), e);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "[TEST] Jobadabra 0.9.10 · What's new");
  assert.match(sent[0].text, /Changes since version 0\.9\.8/);
  assert.match(sent[0].text, /Beta change/);
  assert.match(sent[0].html, /Latest stable change/);
  assert.doesNotMatch(sent[0].html, /Future beta|See why each job fits/);
  assert.equal(e.STATS.db.prepare("SELECT status FROM release_mail WHERE version='0.9.10'").get().status, 'draft');
});


test('a missing real stable draft never falls back to the sample release or sends it', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  e.STATS.db.exec('DELETE FROM changelog_entries');
  const headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'};
  const view = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?template=release', {headers}), e);
  assert.equal(view.status, 404);
  assert.doesNotMatch(await view.text(), /0\.8\.42|See why each job fits/);
  const response = await testSend(new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers, body: new URLSearchParams({template: 'release', mine: '1', to: 'reviewer@example.com'})}), e);
  assert.match(response.headers.get('Location'), /release:no_release/);
  assert.equal(sent.length, 0);
});

test('a release test from an already open template page returns visible feedback on the pinned real draft', async () => {
  const {e} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  const headers = {Authorization: 'Bearer owner-key', Origin: 'https://www.jobadabra.top'};
  const response = await testSend(new Request('https://www.jobadabra.top/admin/growth/email', {method: 'POST', headers, body: new URLSearchParams({template: 'release', detail: '1', mine: '1', to: 'reviewer@example.com'})}), e);
  const destination = new URL(response.headers.get('Location'), 'https://www.jobadabra.top');
  assert.equal(destination.searchParams.get('release'), '0.8.42');
  const html = await (await emailView(new Request(destination, {headers}), e)).text();
  assert.match(html, /Test of release 0\.8\.42 sent to reviewer@example\.com/);
});

test('latest stable without a draft shows its real changelog as pending instead of an older draft or 404', async () => {
  const {e, sent} = setup({STATS_API_KEY: 'owner-key', STATS_KEY: 'stats-key'});
  await draft(e, '0.8.42', now);
  e.STATS.db.prepare('INSERT INTO changelog_entries (version,date,channel,hidden,body,at) VALUES (?,?,?,?,?,?)').run('0.8.43', '2026-11-05', 'stable', 0, JSON.stringify([{kind: 'fixes', items: [{lead: 'Newest real change', text: 'The newest stable works.'}]}]), 'x');
  const response = await emailView(new Request('https://www.jobadabra.top/admin/growth/email?template=release', {headers: {Authorization: 'Bearer owner-key'}}), e);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /0\.8\.43/); assert.match(html, /Newest real change/);
  assert.match(html, /draft is not ready yet/i);
  assert.doesNotMatch(html, /<form|Sample preview|See why each job fits/);
  assert.equal(e.STATS.db.prepare("SELECT COUNT(*) n FROM release_mail WHERE version='0.8.43'").get().n, 0, 'view never creates a draft');
  assert.equal(sent.length, 0);
  e.STATS.db.prepare("UPDATE changelog_entries SET hidden=1, body='[]' WHERE version='0.8.43'").run();
  const empty = await (await emailView(new Request('https://www.jobadabra.top/admin/growth/email?template=release', {headers: {Authorization: 'Bearer owner-key'}}), e)).text();
  assert.match(empty, /No user-visible changes since the previous stable/);
  assert.match(empty, /November 2026/);
  assert.doesNotMatch(empty, /<form/);

});

test('a stopped "What\'s new" refuses before it spends the draft, and goes once turned back on; the owner can still test it (review of hr-29)', async () => {
  resetRuleCache();
  const {e, sent} = setup();
  e.STATS.db.exec(sql('0138_mail_rule.sql'));
  await e.WAITLIST.put('signup:wait@example.com', WEB);   // a website signup: in the audience from the start
  await draft(e, '0.8.42', now);
  await setRule(e, 'release', false, now);
  assert.deepEqual(await sendAll(e, '0.8.42', {now}), {refused: 'stopped in Admin → E-mail → Mails'});
  assert.equal(e.STATS.db.prepare('SELECT status FROM release_mail').get().status, 'draft');
  assert.equal(sent.length, 0);
  assert.equal((await send(e, 'release', 'me@example.com', {...(await releaseData(e, {...JSON.parse(e.STATS.db.prepare('SELECT data FROM release_mail').get().data), version: '0.8.42'})), name: '', test: true}, {test: true, ownerTest: true})).ok, true, 'the owner checks a stopped mail in the test inbox');
  await setRule(e, 'release', true, now);
  assert.deepEqual(await sendAll(e, '0.8.42', {now}), {sent: 1, skipped: 0});
  resetRuleCache();
});
